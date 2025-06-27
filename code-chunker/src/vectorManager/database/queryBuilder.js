const Logger = require('../utils/logger');

class QueryBuilder {
    constructor(config) {
        this.config = config;
        this.logger = new Logger('QueryBuilder', config.logLevel);
        
        // 默认查询参数
        this.defaultParams = {
            topK: config.defaultTopK || 10,
            minScore: config.defaultMinScore || 0.7,
            maxResults: config.defaultMaxResults || 100,
            timeout: config.defaultTimeout || 5000
        };
    }

    buildSearchQuery(params) {
        try {
            const {
                collection,
                vector,
                topK = this.defaultParams.topK,
                minScore = this.defaultParams.minScore,
                filter = {},
                outputFields = ['*'],
                timeout = this.defaultParams.timeout
            } = params;

            // 验证必要参数
            if (!collection) {
                throw new Error('Collection name is required');
            }
            if (!vector || !Array.isArray(vector)) {
                throw new Error('Valid vector is required');
            }

            // 构建腾讯云向量数据库搜索查询
            const query = {
                database: this.config.database || this.config.defaultDatabase,
                collection: collection,
                vectors: [vector],  // 腾讯云API需要向量数组格式
                limit: Math.min(topK, this.defaultParams.maxResults),
                filter: this._buildTencentFilter(filter),
                outputFields: outputFields.length === 1 && outputFields[0] === '*' ? undefined : outputFields
            };

            this.logger.debug('Built search query:', query);
            return query;

        } catch (error) {
            this.logger.error('Error building search query:', error);
            throw error;
        }
    }

    buildUpsertQuery(params) {
        try {
            const {
                collection,
                documents,
                timeout = this.defaultParams.timeout
            } = params;

            // 验证必要参数
            if (!collection) {
                throw new Error('Collection name is required');
            }
            if (!documents || !Array.isArray(documents) || documents.length === 0) {
                throw new Error('Valid documents array is required');
            }

            // 构建腾讯云向量数据库API格式的查询
            const query = {
                database: this.config.database || this.config.defaultDatabase,
                collection: collection,
                documents: documents.map(doc => ({
                    // 主键
                    id: doc.id,
                    // 向量数据
                    vector: doc.vector,
                    // 腾讯云向量数据库测试规范字段
                    user_id: doc.user_id,
                    device_id: doc.device_id,
                    workspace_path: doc.workspace_path,
                    file_path: doc.file_path,
                    start_line: doc.start_line,
                    end_line: doc.end_line,
                    code: doc.code,
                    vector_model: doc.vector_model,
                    // 兼容字段
                    filePath: doc.filePath,
                    fileName: doc.fileName,
                    offset: doc.offset,
                    timestamp: doc.timestamp,
                    // 其他字段
                    ...this._buildMetadata(doc)
                })),
                buildIndex: true  // 根据API文档，默认为true
            };

            this.logger.debug('Built upsert query:', query);
            return query;

        } catch (error) {
            this.logger.error('Error building upsert query:', error);
            throw error;
        }
    }

    buildDeleteQuery(params) {
        try {
            const {
                collection,
                ids,
                filter = {},
                timeout = this.defaultParams.timeout
            } = params;

            // 验证必要参数
            if (!collection) {
                throw new Error('Collection name is required');
            }
            if ((!ids || !Array.isArray(ids) || ids.length === 0) && 
                Object.keys(filter).length === 0) {
                throw new Error('Either ids array or filter is required');
            }

            // 构建查询
            const query = {
                database: this.config.database,
                collection: collection,
                ids: ids,
                filter: this._buildFilter(filter),
                timeout: timeout
            };

            this.logger.debug('Built delete query:', query);
            return query;

        } catch (error) {
            this.logger.error('Error building delete query:', error);
            throw error;
        }
    }

    // 内部方法
    _buildFilter(filter) {
        if (!filter || Object.keys(filter).length === 0) {
            return {};
        }

        const conditions = [];
        
        for (const [field, value] of Object.entries(filter)) {
            if (typeof value === 'object' && value !== null) {
                // 处理范围查询
                if (value.$gt !== undefined || value.$gte !== undefined ||
                    value.$lt !== undefined || value.$lte !== undefined) {
                    const rangeCondition = {};
                    
                    if (value.$gt !== undefined) rangeCondition.$gt = value.$gt;
                    if (value.$gte !== undefined) rangeCondition.$gte = value.$gte;
                    if (value.$lt !== undefined) rangeCondition.$lt = value.$lt;
                    if (value.$lte !== undefined) rangeCondition.$lte = value.$lte;
                    
                    conditions.push({
                        field: field,
                        ...rangeCondition
                    });
                }
                // 处理数组查询
                else if (value.$in !== undefined) {
                    conditions.push({
                        field: field,
                        $in: value.$in
                    });
                }
            } else {
                // 处理精确匹配
                conditions.push({
                    field: field,
                    $eq: value
                });
            }
        }

        return conditions.length > 0 ? { conditions } : {};
    }

    // 腾讯云向量数据库专用过滤器构建
    _buildTencentFilter(filter) {
        if (!filter || Object.keys(filter).length === 0) {
            return undefined;
        }

        // 腾讯云向量数据库使用简单的键值对过滤格式
        const tencentFilter = {};
        
        for (const [field, value] of Object.entries(filter)) {
            if (typeof value === 'object' && value !== null) {
                // 腾讯云暂时只支持基本过滤，复杂查询可能需要转换
                if (value.$eq !== undefined) {
                    tencentFilter[field] = value.$eq;
                } else if (value.$in !== undefined && Array.isArray(value.$in) && value.$in.length > 0) {
                    tencentFilter[field] = value.$in[0]; // 取第一个值作为示例
                }
            } else {
                tencentFilter[field] = value;
            }
        }

        return Object.keys(tencentFilter).length > 0 ? tencentFilter : undefined;
    }

    _buildMetadata(vector) {
        const metadata = {};
        
        // 添加基本字段
        if (vector.filePath) metadata.filePath = vector.filePath;
        if (vector.fileName) metadata.fileName = vector.fileName;
        if (vector.offset !== undefined) metadata.offset = vector.offset;
        if (vector.timestamp) metadata.timestamp = vector.timestamp;
        
        // 添加自定义字段
        if (vector.metadata) {
            Object.assign(metadata, vector.metadata);
        }
        
        return metadata;
    }
}

module.exports = QueryBuilder;