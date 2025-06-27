/**
 * 腾讯云向量数据库适配器
 * 将TencentVectorDB的接口适配为VectorManager期望的标准接口
 */

const TencentVectorDB = require('./tencentVectorDB');
const crypto = require('crypto');

class TencentVectorDBAdapter {
    constructor(config = {}) {
        this.config = config;
        
        // 适配配置格式
        const tencentConfig = {
            username: config.username,
            apiKey: config.password, // 将password映射为apiKey
            host: this._extractHost(config.endpoint),
            port: this._extractPort(config.endpoint),
            useHttps: config.endpoint?.startsWith('https'),
            timeout: config.connectionTimeout || 30000,
            logLevel: config.logLevel || 'info'
        };
        
        this.tencentDB = new TencentVectorDB(tencentConfig);
        this.defaultDatabase = 'code_chunker_db';
        this.isInitialized = false;
    }

    _extractHost(endpoint) {
        if (!endpoint) return 'localhost';
        const url = new URL(endpoint);
        return url.hostname;
    }

    _extractPort(endpoint) {
        if (!endpoint) return 8100;
        const url = new URL(endpoint);
        return parseInt(url.port) || (endpoint.startsWith('https') ? 443 : 80);
    }

    async initialize() {
        if (this.isInitialized) {
            return;
        }

        try {
            // 初始化底层数据库连接
            await this.tencentDB.initialize();
            
            // 确保默认数据库存在
            await this._ensureDatabase(this.defaultDatabase);
            
            this.isInitialized = true;
            console.log('TencentVectorDB Adapter initialized successfully');
            
        } catch (error) {
            console.error('Failed to initialize TencentVectorDB Adapter:', error);
            throw error;
        }
    }

    async _ensureDatabase(databaseName) {
        try {
            // 尝试列出数据库，检查是否存在
            const response = await this.tencentDB.listDatabases();
            const databases = response.data?.databases || [];
            
            const exists = databases.some(db => db.database === databaseName);
            
            if (!exists) {
                console.log(`Creating database: ${databaseName}`);
                await this.tencentDB.createDatabase(databaseName);
            }
            
        } catch (error) {
            console.warn(`Error ensuring database ${databaseName}:`, error.message);
            // 不抛出错误，因为数据库可能已存在
        }
    }

    async ensureCollection(collectionName) {
        if (!this.isInitialized) {
            throw new Error('TencentVectorDB Adapter not initialized');
        }

        try {
            // 检查集合是否存在
            const response = await this.tencentDB.listCollections(this.defaultDatabase);
            const collections = response.data?.collections || [];
            
            const existingCollection = collections.find(col => col.collection === collectionName);
            
            if (!existingCollection) {
                console.log(`Creating collection: ${collectionName}`);
                
                // 创建集合，使用代码向量化的标准配置
                const createParams = {
                    replicaNum: 0, // 腾讯云要求
                    shardNum: this.config.collections?.shards || 1,
                    description: `Code chunker collection: ${collectionName}`,
                    indexes: [
                        {
                            fieldName: "id",
                            fieldType: "string",
                            indexType: "primaryKey"
                        },
                        {
                            fieldName: "vector",
                            fieldType: "vector",
                            indexType: this.config.collections?.indexType || "IVF_FLAT",
                            dimension: this.config.collections?.defaultDimension || 768,
                            metricType: this.config.collections?.metric?.toUpperCase() || "COSINE",
                            params: {
                                nlist: 1024
                            }
                        }
                    ]
                };
                
                await this.tencentDB.createCollection(this.defaultDatabase, collectionName, createParams);
                
                // 等待索引构建完成
                await this._waitForIndexReady(collectionName);
            } else {
                // 即使集合已存在，也要检查索引是否准备好
                await this._waitForIndexReady(collectionName);
            }
            
        } catch (error) {
            console.warn(`Error ensuring collection ${collectionName}:`, error.message);
            // 不抛出错误，因为集合可能已存在
        }
    }

    async _waitForIndexReady(collectionName, maxWaitTime = 30000) {
        const startTime = Date.now();
        const checkInterval = 2000; // 2秒检查一次
        let initialStateCount = 0; // 计算处于initial状态的次数
        
        console.log(`⏳ 等待集合 ${collectionName} 的索引构建完成...`);
        
        while (Date.now() - startTime < maxWaitTime) {
            try {
                // 尝试描述集合以检查状态
                const response = await this.tencentDB.describeCollection(this.defaultDatabase, collectionName);
                
                if (response.success && response.data && response.data.collection) {
                    // 检查索引状态 - 修正路径
                    const indexStatus = response.data.collection.indexStatus?.status || 'unknown';
                    console.log(`📊 索引状态: ${indexStatus}`);
                    
                    // 腾讯云索引状态：initial -> building -> ready
                    if (indexStatus === 'ready' || indexStatus === 'normal') {
                        console.log(`✅ 集合 ${collectionName} 索引已准备就绪`);
                        return true;
                    } else if (indexStatus === 'initial') {
                        initialStateCount++;
                        console.log(`🔄 索引状态为初始状态 (${initialStateCount}/${Math.floor(maxWaitTime/checkInterval)})`);
                        
                        // 如果长时间处于initial状态，可能需要数据才能触发索引构建
                        if (initialStateCount >= 5) { // 等待10秒后
                            console.log(`💡 索引长时间处于初始状态，可能需要插入数据后才会开始构建`);
                            console.log(`✅ 继续执行，将在数据插入时触发索引构建`);
                            return true; // 允许继续执行
                        }
                    } else if (indexStatus === 'building') {
                        console.log(`🏗️ 索引正在构建中...`);
                        initialStateCount = 0; // 重置计数器
                    }
                }
                
                // 等待后再次检查
                await new Promise(resolve => setTimeout(resolve, checkInterval));
                
            } catch (error) {
                console.warn(`检查索引状态时出错: ${error.message}`);
                // 继续等待
                await new Promise(resolve => setTimeout(resolve, checkInterval));
            }
        }
        
        console.warn(`⚠️ 等待索引构建超时 (${maxWaitTime}ms)，继续执行`);
        return false;
    }

    async batchUpsert(collectionName, vectors) {
        if (!this.isInitialized) {
            throw new Error('TencentVectorDB Adapter not initialized');
        }

        try {
            // 确保集合存在且索引准备完成
            await this.ensureCollection(collectionName);
            
            // 转换向量格式为腾讯云期望的格式，包含完整的元数据
            const documents = vectors.map(vector => ({
                id: vector.id,
                vector: vector.vector,
                
                // 基础文件信息
                filePath: vector.filePath || '',
                fileName: vector.fileName || '',
                offset: typeof vector.offset === 'number' ? vector.offset : 0,
                timestamp: typeof vector.timestamp === 'number' ? vector.timestamp : Date.now(),
                
                // 用户信息 - 关键的映射修复
                userId: vector.userId || 'unknown',
                deviceId: vector.deviceId || 'unknown', 
                workspacePath: vector.workspacePath || 'unknown',
                
                // 代码块元数据 - 从nested metadata中提取
                language: vector.language || vector.metadata?.language || 'unknown',
                startLine: vector.startLine || vector.metadata?.startLine || 0,
                endLine: vector.endLine || vector.metadata?.endLine || 0,
                content: vector.content || vector.metadata?.content || '',
                parser: vector.parser || vector.metadata?.parser || 'unknown',
                type: vector.type || vector.metadata?.type || 'code',
                
                // 向量处理信息
                vectorModel: vector.vectorModel || vector.metadata?.vectorModel || 'CoCoSoDa-v1.0',
                processingTimeMs: vector.processingTimeMs || vector.metadata?.processingTimeMs || 0,
                createdAt: vector.createdAt || vector.metadata?.createdAt || new Date().toISOString()
            }));
            
            // 智能重试机制
            const maxRetries = 3;
            let lastError = null;
            
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    // 批量上传到腾讯云
                    const response = await this.tencentDB.upsertDocuments(
                        this.defaultDatabase,
                        collectionName,
                        documents
                    );
                    
                    if (response.success) {
                        if (attempt > 1) {
                            console.log(`✅ 第${attempt}次重试成功，上传了${vectors.length}个向量`);
                        }
                        return {
                            success: true,
                            count: vectors.length,
                            collectionName: collectionName
                        };
                    } else {
                        lastError = new Error(response.error || 'Batch upsert failed');
                    }
                    
                } catch (error) {
                    lastError = error;
                    
                    // 检查是否是索引未准备好的错误
                    if (error.message.includes('current index is not ready')) {
                        console.log(`⏳ 第${attempt}次尝试：索引未准备好，等待${attempt * 2}秒后重试...`);
                        await new Promise(resolve => setTimeout(resolve, attempt * 2000));
                        continue;
                    } else {
                        // 其他类型的错误，直接失败
                        break;
                    }
                }
            }
            
            // 所有重试都失败了
            console.warn(`⚠️ 向量上传失败，已重试${maxRetries}次: ${lastError.message}`);
            return {
                success: false,
                error: lastError.message,
                count: 0
            };
            
        } catch (error) {
            console.error(`Batch upsert failed for collection ${collectionName}:`, error);
            return {
                success: false,
                error: error.message,
                count: 0
            };
        }
    }

    async search(queryVector, topK = 10, collectionName, options = {}) {
        if (!this.isInitialized) {
            throw new Error('TencentVectorDB Adapter not initialized');
        }

        try {
            // 构建搜索参数 - 包含所有重要字段
            const searchParams = {
                limit: topK,
                outputFields: [
                    'id', 'filePath', 'fileName', 'offset', 'timestamp',
                    'userId', 'deviceId', 'workspacePath',
                    'language', 'startLine', 'endLine', 'content', 'parser', 'type',
                    'vectorModel', 'processingTimeMs', 'createdAt'
                ],
                searchParams: {
                    ef: 64  // HNSW搜索参数
                }
            };
            
            // 添加过滤条件
            if (options.filter) {
                searchParams.filter = options.filter;
            }
            
            // 执行向量搜索
            const response = await this.tencentDB.searchVectors(
                this.defaultDatabase,
                collectionName,
                queryVector, // 直接传递向量，不使用数组
                searchParams
            );
            
            if (response.success && response.data?.results) {
                // 转换结果格式，保持与VectorManager期望的格式一致
                return response.data.results.map(result => ({
                    chunkId: result.id,
                    id: result.id,
                    score: result.score,
                    similarity: result.score, // 向后兼容
                    filePath: result.filePath || '',
                    fileName: result.fileName || '',
                    startLine: result.startLine || 0,
                    endLine: result.endLine || 0,
                    content: result.content || '',
                    
                    metadata: {
                        userId: result.userId || 'unknown',
                        deviceId: result.deviceId || 'unknown',  
                        workspacePath: result.workspacePath || 'unknown',
                        language: result.language || 'unknown',
                        parser: result.parser || 'unknown',
                        type: result.type || 'code',
                        vectorModel: result.vectorModel || 'CoCoSoDa-v1.0',
                        processingTimeMs: result.processingTimeMs || 0,
                        createdAt: result.createdAt || '',
                        timestamp: result.timestamp || Date.now(),
                        offset: result.offset || 0,
                        originalScore: result.score // 原始分数
                    }
                }));
            } else {
                console.warn('Search returned no results or failed:', response);
                return [];
            }
            
        } catch (error) {
            console.error(`Search failed for collection ${collectionName}:`, error);
            return [];
        }
    }

    async deleteCollection(collectionName) {
        if (!this.isInitialized) {
            throw new Error('TencentVectorDB Adapter not initialized');
        }

        try {
            const response = await this.tencentDB.dropCollection(this.defaultDatabase, collectionName);
            return response.success;
        } catch (error) {
            console.error(`Delete collection failed:`, error);
            return false;
        }
    }

    async getCollectionStats(collectionName) {
        if (!this.isInitialized) {
            throw new Error('TencentVectorDB Adapter not initialized');
        }

        try {
            const response = await this.tencentDB.describeCollection(this.defaultDatabase, collectionName);
            
            if (response.success && response.data) {
                return {
                    name: collectionName,
                    vectorCount: response.data.documentCount || 0,
                    dimension: this.config.collections?.defaultDimension || 768,
                    metric: this.config.collections?.metric || 'cosine'
                };
            } else {
                return null;
            }
        } catch (error) {
            console.error(`Get collection stats failed:`, error);
            return null;
        }
    }

    async shutdown() {
        try {
            if (this.tencentDB && typeof this.tencentDB.close === 'function') {
                await this.tencentDB.close();
            }
            this.isInitialized = false;
            console.log('TencentVectorDB Adapter shutdown completed');
        } catch (error) {
            console.error('Error during shutdown:', error);
        }
    }
}

module.exports = TencentVectorDBAdapter; 