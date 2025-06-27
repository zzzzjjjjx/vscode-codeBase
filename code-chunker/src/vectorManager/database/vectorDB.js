const DBConnection = require('./dbConnection');
const CollectionManager = require('./collectionManager');
const QueryBuilder = require('./queryBuilder');
const TencentVectorDB = require('./tencentVectorDB');
const Logger = require('../utils/logger');
const { createCollectionName } = require('../../utils/collectionNameUtils');
const RetryHelper = require('../utils/retry');

class VectorDB {
    constructor(config) {
        this.config = config;
        this.logger = new Logger('VectorDB', config.logLevel);
        this.retryHelper = new RetryHelper(config.retry);

        // 调试：检查配置类型
        this.logger.debug('VectorDB配置检查:', {
            configType: config.type,
            isTencentCloud: config.type === 'tencent_cloud',
            connectionType: config.connection?.type
        });

        // 根据数据库类型选择实现
        if (config.type === 'tencent_cloud') {
            this.logger.info('使用腾讯云向量数据库实现');
            // 为TencentVectorDB准备正确的配置格式
            const tencentConfig = {
                ...config.connection,  // 将connection下的配置提升到顶级
                logLevel: config.logLevel || 'info',
                database: config.connection.database || config.query?.defaultDatabase,
                ...config  // 保留其他顶级配置
            };
            this.implementation = new TencentVectorDB(tencentConfig);
            this.useTencentCloud = true;
        } else {
            // 原有的实现逻辑
            this.logger.info('使用原始数据库实现');
            this.useTencentCloud = false;
            this._initOriginalImplementation(config);
        }
        
        // 连接状态
        this.isConnected = false;
        this.connectionAttempts = 0;
        this.maxConnectionAttempts = config.maxConnectionAttempts || 3;
        
        // 性能优化
        this.batchSize = config.batchSize || 100;
        this.requestTimeout = config.requestTimeout || 30000;
    }

    _initOriginalImplementation(config) {
        // 保证连接配置存在且有 logLevel
        if (!this.config.connection) {
            this.config.connection = {
                logLevel: 'info',
                host: 'localhost',
                database: 'test_db',
                username: 'test_user',
                apiKey: 'test_key'
            };
        } else {
            if (!this.config.connection.logLevel) this.config.connection.logLevel = 'info';
            if (!this.config.connection.host) this.config.connection.host = 'localhost';
            if (!this.config.connection.database) this.config.connection.database = 'test_db';
            if (!this.config.connection.username) this.config.connection.username = 'test_user';
            if (!this.config.connection.apiKey) this.config.connection.apiKey = 'test_key';
        }
        
        // 核心组件
        this.connection = null;
        this.collectionManager = null;
        this.queryBuilder = null;
    }

    async initialize() {
        if (this.useTencentCloud) {
            // 使用腾讯云向量数据库
            await this.implementation.initialize();
            this.isConnected = true;
            this.logger.info('VectorDB initialized with Tencent Cloud');
            return;
        }

        // 原有的初始化逻辑
        try {
            this.logger.info('Initializing VectorDB...');
            
            // 1. 初始化连接管理器
            this.connection = new DBConnection(this.config.connection);
            await this.connection.initialize();
            
            // 2. 初始化集合管理器
            this.collectionManager = new CollectionManager(this.connection, this.config.collections);
            
            // 3. 初始化查询构建器
            this.queryBuilder = new QueryBuilder(this.config.query);
            
            // 4. 测试连接
            await this._testConnection();
            
            this.isConnected = true;
            this.logger.info('VectorDB initialized successfully');
            
        } catch (error) {
            this.logger.error('Failed to initialize VectorDB:', error);
            throw error;
        }
    }

    async batchUpsert(comboKey, vectors) {
        if (!this.isConnected) {
            throw new Error('Database not connected');
        }
        
        if (this.useTencentCloud) {
            // 使用腾讯云向量数据库
            return await this.implementation.batchUpsert(comboKey, vectors);
        }

        // 原有的逻辑
        try {
            this.logger.info(`Starting batch upsert for ${comboKey}: ${vectors.length} vectors`);
            
            // 1. 确保目标集合存在
            const collectionName = this._getCollectionName(comboKey);
            await this.collectionManager.ensureCollection(collectionName);
            
            // 2. 分批处理大量数据
            const batches = this._splitIntoBatches(vectors, this.batchSize);
            let totalUploaded = 0;
            const uploadResults = [];
            
            for (let i = 0; i < batches.length; i++) {
                const batch = batches[i];
                this.logger.debug(`Uploading batch ${i + 1}/${batches.length}: ${batch.length} vectors`);
                
                try {
                    const batchResult = await this._uploadBatch(collectionName, batch);
                    totalUploaded += batchResult.count;
                    uploadResults.push(batchResult);
                    
                } catch (error) {
                    this.logger.error(`Failed to upload batch ${i + 1}:`, error);
                    
                    // 根据配置决定是否继续处理剩余批次
                    if (this.config.stopOnBatchError) {
                        throw error;
                    } else {
                        uploadResults.push({ success: false, error: error.message, count: 0 });
                    }
                }
            }
            
            // 3. 汇总结果
            const result = {
                success: totalUploaded > 0,
                count: totalUploaded,
                totalBatches: batches.length,
                successfulBatches: uploadResults.filter(r => r.success).length,
                failedBatches: uploadResults.filter(r => !r.success).length,
                details: uploadResults
            };
            
            if (result.success) {
                this.logger.info(`Batch upsert completed for ${comboKey}: ${totalUploaded}/${vectors.length} vectors uploaded`);
            } else {
                this.logger.error(`Batch upsert failed for ${comboKey}: no vectors uploaded`);
            }
            
            return result;
            
        } catch (error) {
            this.logger.error(`Error in batch upsert for ${comboKey}:`, error);
            throw error;
        }
    }

    async search(queryVector, topK, comboKey, options = {}) {
        if (!this.isConnected) {
            throw new Error('Database not connected');
        }
        
        if (this.useTencentCloud) {
            // 使用腾讯云向量数据库
            return await this.implementation.search(queryVector, topK, comboKey, options);
        }

        // 原有的搜索逻辑
        try {
            // 1. 构建搜索查询
            const collectionName = this._getCollectionName(comboKey);
            const searchQuery = this.queryBuilder.buildSearchQuery({
                vector: queryVector,
                topK: topK,
                collection: collectionName,
                ...options
            });
            
            this.logger.debug(`Executing search in collection ${collectionName} with topK=${topK}`);
            
            // 2. 执行搜索
            const response = await this.retryHelper.executeWithRetry(
                () => this.connection.post('/document/search', searchQuery),
                `Search in collection ${collectionName}`
            );
            
            // 3. 处理搜索结果
            const results = this._processSearchResponse(response);
            
            this.logger.info(`Search completed: found ${results.length} results in collection ${collectionName}`);
            
            return results;
            
        } catch (error) {
            this.logger.error(`Error in vector search:`, error);
            throw error;
        }
    }

    async deleteVectors(comboKey, vectorIds) {
        if (!this.isConnected) {
            throw new Error('Database not connected');
        }
        
        if (this.useTencentCloud) {
            // 腾讯云删除功能暂不实现
            this.logger.warn('Delete vectors not implemented for Tencent Cloud yet');
            return 0;
        }

        try {
            const collectionName = this._getCollectionName(comboKey);
            
            // 分批删除
            const batches = this._splitIntoBatches(vectorIds, this.batchSize);
            let totalDeleted = 0;
            
            for (const batch of batches) {
                const deleteQuery = this.queryBuilder.buildDeleteQuery({
                    collection: collectionName,
                    ids: batch
                });
                
                const response = await this.retryHelper.executeWithRetry(
                    () => this.connection.post('/document/delete', deleteQuery),
                    `Delete vectors from collection ${collectionName}`
                );
                
                totalDeleted += this._getDeletedCount(response);
            }
            
            this.logger.info(`Deleted ${totalDeleted} vectors from collection ${collectionName}`);
            return totalDeleted;
            
        } catch (error) {
            this.logger.error(`Error deleting vectors:`, error);
            throw error;
        }
    }

    // 内部方法
    async _testConnection() {
        try {
            // 对于腾讯云向量数据库，跳过健康检查（连接测试已在DBConnection中完成）
            if (this.config.connection.type === 'tencent') {
                this.logger.debug('Skipping health check for Tencent VectorDB - connection already tested');
                return;
            }
            
            // 测试基本连接
            const response = await this.connection.get('/health');
            this.logger.debug('Database connection test successful');
            
        } catch (error) {
            throw new Error(`Database connection test failed: ${error.message}`);
        }
    }

    _getCollectionName(comboKey) {
        // 直接使用组合键作为集合名称（已包含user_id+device_id+workspace_path）
        return comboKey;
    }

    /**
     * 创建符合腾讯云限制的集合名称
     * 基于用户ID、设备ID和工作空间路径生成
     * 
     * @param {string} user_id - 用户标识符
     * @param {string} device_id - 设备标识符
     * @param {string} workspace_path - 工作空间路径
     * @returns {string} 集合名称字符串
     */
    _createCollectionName(user_id, device_id, workspace_path) {
        return createCollectionName(user_id, device_id, workspace_path);
    }

    _splitIntoBatches(items, batchSize) {
        const batches = [];
        for (let i = 0; i < items.length; i += batchSize) {
            batches.push(items.slice(i, i + batchSize));
        }
        return batches;
    }

    async _uploadBatch(collectionName, vectors) {
        try {
            // 构建腾讯云向量数据库上传请求
            const upsertQuery = this.queryBuilder.buildUpsertQuery({
                collection: collectionName,
                documents: vectors.map(vector => ({
                    // 必需字段
                    id: vector.id,
                    vector: vector.vector,
                    // 腾讯云向量数据库测试规范字段
                    user_id: vector.user_id,
                    device_id: vector.device_id, 
                    workspace_path: vector.workspace_path,
                    file_path: vector.file_path,
                    start_line: vector.start_line,
                    end_line: vector.end_line,
                    code: vector.code,
                    vector_model: vector.vector_model,
                    // 兼容旧格式
                    filePath: vector.filePath,
                    fileName: vector.fileName,
                    offset: vector.offset,
                    timestamp: vector.metadata?.timestamp || new Date().toISOString(),
                    // 其他元数据字段
                    ...vector.metadata
                }))
            });
            
            // 执行上传
            const response = await this.connection.post('/document/upsert', upsertQuery);
            
            // 验证响应
            if (response.code !== 0) {
                throw new Error(`Upload failed: ${response.msg || 'Unknown error'}`);
            }
            
            return {
                success: true,
                count: response.affectedCount || response.count || vectors.length,
                response: response
            };
            
        } catch (error) {
            return {
                success: false,
                count: 0,
                error: error.message
            };
        }
    }

    _processSearchResponse(response) {
        if (response.code !== 0) {
            throw new Error(`Search failed: ${response.msg || 'Unknown error'}`);
        }
        
        if (!response.documents || !Array.isArray(response.documents)) {
            return [];
        }
        
        // 转换搜索结果格式
        return response.documents.map(doc => ({
            id: doc.id,
            score: doc.score,
            filePath: doc.filePath,
            fileName: doc.fileName,
            offset: doc.offset,
            timestamp: doc.timestamp,
            metadata: {
                // 提取其他元数据
                ...doc
            }
        }));
    }

    _getDeletedCount(response) {
        if (response.code !== 0) {
            throw new Error(`Delete failed: ${response.msg || 'Unknown error'}`);
        }
        
        return response.count || 0;
    }

    async close() {
        if (this.useTencentCloud) {
            await this.implementation.close();
        } else if (this.connection) {
            await this.connection.close();
        }
        this.isConnected = false;
        this.logger.info('VectorDB connection closed');
    }
}

module.exports = VectorDB;