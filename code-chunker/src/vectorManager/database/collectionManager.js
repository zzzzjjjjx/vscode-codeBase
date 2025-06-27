const Logger = require('../utils/logger');

class CollectionManager {
    constructor(connection, config) {
        this.connection = connection;
        this.config = config;
        this.logger = new Logger('CollectionManager', config.logLevel);
        
        // 集合缓存：collectionName -> collection info
        this.collectionCache = new Map();
        
        // 默认集合配置
        this.defaultConfig = {
            vectorDimension: config.vectorDimension || 768,
            metricType: config.metricType || 'COSINE',
            indexType: config.indexType || 'HNSW',
            ...config.defaultCollection
        };
    }

    async ensureCollection(collectionName) {
        try {
            // 检查缓存
            if (this.collectionCache.has(collectionName)) {
                const cachedInfo = this.collectionCache.get(collectionName);
                if (Date.now() - cachedInfo.lastChecked < 300000) { // 5分钟缓存
                    return cachedInfo;
                }
            }
            
            // 检查集合是否存在
            const exists = await this._checkCollectionExists(collectionName);
            
            if (!exists) {
                this.logger.info(`Collection ${collectionName} does not exist, creating...`);
                await this._createCollection(collectionName);
            }
            
            // 获取集合信息
            const collectionInfo = await this._getCollectionInfo(collectionName);
            
            // 更新缓存
            this.collectionCache.set(collectionName, {
                ...collectionInfo,
                lastChecked: Date.now()
            });
            
            return collectionInfo;
            
        } catch (error) {
            this.logger.error(`Error ensuring collection ${collectionName}:`, error);
            throw error;
        }
    }

    async createCollection(collectionName, customConfig = {}) {
        try {
            const collectionConfig = {
                ...this.defaultConfig,
                ...customConfig
            };
            
            this.logger.info(`Creating collection ${collectionName} with config:`, collectionConfig);
            
            const createQuery = {
                database: this.connection.database,
                collection: collectionName,
                description: collectionConfig.description || `Collection for ${collectionName}`,
                // 腾讯云向量数据库必需参数
                shardNum: collectionConfig.shardNum || 1,
                replicaNum: collectionConfig.replicaNum || 0,
                // 腾讯云向量数据库索引定义
                indexes: [
                    // 主键索引
                    {
                        fieldName: "id",
                        fieldType: "string",
                        indexType: "primaryKey"
                    },
                    // 向量索引
                    {
                        fieldName: "vector",
                        fieldType: "vector",
                        indexType: collectionConfig.indexType || "HNSW",
                        dimension: collectionConfig.vectorDimension || 768,
                        metricType: collectionConfig.metricType || "COSINE",
                        params: collectionConfig.indexParam || {
                            M: 16,
                            efConstruction: 200
                        }
                    },
                    // 元数据字段索引 - 符合腾讯云向量数据库测试规范
                    {
                        fieldName: "user_id",
                        fieldType: "string",
                        indexType: "filter"
                    },
                    {
                        fieldName: "device_id", 
                        fieldType: "string",
                        indexType: "filter"
                    },
                    {
                        fieldName: "workspace_path",
                        fieldType: "string",
                        indexType: "filter"
                    },
                    {
                        fieldName: "file_path",
                        fieldType: "string",
                        indexType: "filter"
                    },
                    {
                        fieldName: "start_line",
                        fieldType: "uint64",
                        indexType: "filter"
                    },
                    {
                        fieldName: "end_line",
                        fieldType: "uint64", 
                        indexType: "filter"
                    },
                    {
                        fieldName: "code",
                        fieldType: "string",
                        indexType: "filter"
                    },
                    {
                        fieldName: "vector_model",
                        fieldType: "string",
                        indexType: "filter"
                    }
                ]
            };
            
            const response = await this.connection.post('/collection/create', createQuery);
            
            if (response.code !== 0) {
                throw new Error(`Failed to create collection: ${response.msg}`);
            }
            
            // 清除缓存以强制重新获取
            this.collectionCache.delete(collectionName);
            
            this.logger.info(`Collection ${collectionName} created successfully`);
            
            return response;
            
        } catch (error) {
            this.logger.error(`Error creating collection ${collectionName}:`, error);
            throw error;
        }
    }

    async deleteCollection(collectionName) {
        try {
            this.logger.info(`Deleting collection ${collectionName}`);
            
            const deleteQuery = {
                database: this.connection.database,
                collection: collectionName
            };
            
            const response = await this.connection.post('/collection/drop', deleteQuery);
            
            if (response.code !== 0) {
                throw new Error(`Failed to delete collection: ${response.msg}`);
            }
            
            // 清除缓存
            this.collectionCache.delete(collectionName);
            
            this.logger.info(`Collection ${collectionName} deleted successfully`);
            
            return response;
            
        } catch (error) {
            this.logger.error(`Error deleting collection ${collectionName}:`, error);
            throw error;
        }
    }

    async listCollections() {
        try {
            const listQuery = {
                database: this.connection.database
            };
            
            const response = await this.connection.post('/collection/list', listQuery);
            
            if (response.code !== 0) {
                throw new Error(`Failed to list collections: ${response.msg}`);
            }
            
            return response.collections || [];
            
        } catch (error) {
            this.logger.error('Error listing collections:', error);
            throw error;
        }
    }

    async getCollectionStats(collectionName) {
        try {
            const statsQuery = {
                database: this.connection.database,
                collection: collectionName
            };
            
            const response = await this.connection.post('/collection/describe', statsQuery);
            
            if (response.code !== 0) {
                throw new Error(`Failed to get collection stats: ${response.msg}`);
            }
            
            return {
                documentCount: response.documentCount || 0,
                size: response.size || 0,
                dimension: response.dimension,
                metricType: response.metricType,
                indexType: response.indexType,
                ...response
            };
            
        } catch (error) {
            this.logger.error(`Error getting stats for collection ${collectionName}:`, error);
            throw error;
        }
    }

    // 内部方法
    async _checkCollectionExists(collectionName) {
        try {
            const collections = await this.listCollections();
            return collections.some(col => col.collection === collectionName);
            
        } catch (error) {
            // 如果列表操作失败，尝试直接描述集合
            try {
                await this._getCollectionInfo(collectionName);
                return true;
            } catch (describeError) {
                return false;
            }
        }
    }

    async _createCollection(collectionName) {
        return this.createCollection(collectionName);
    }

    async _getCollectionInfo(collectionName) {
        try {
            const describeQuery = {
                database: this.connection.database,
                collection: collectionName
            };
            
            const response = await this.connection.post('/collection/describe', describeQuery);
            
            if (response.code !== 0) {
                throw new Error(`Collection ${collectionName} not found`);
            }
            
            return {
                name: collectionName,
                dimension: response.dimension,
                metricType: response.metricType,
                indexType: response.indexType,
                documentCount: response.documentCount || 0,
                size: response.size || 0,
                status: response.status
            };
            
        } catch (error) {
            throw error;
        }
    }

    clearCache() {
        this.collectionCache.clear();
        this.logger.debug('Collection cache cleared');
    }
}

module.exports = CollectionManager;