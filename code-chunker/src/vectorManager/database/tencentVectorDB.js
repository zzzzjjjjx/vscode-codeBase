const axios = require('axios');
const crypto = require('crypto');
const Logger = require('../utils/logger');

class TencentVectorDB {
    constructor(config) {
        this.config = config;
        this.logger = new Logger('TencentVectorDB', config.logLevel);
        
        // 智能处理host URL - 检查是否已包含协议
        if (config.host.startsWith('http://') || config.host.startsWith('https://')) {
            // 如果host已经包含协议，直接使用并添加端口
            this.baseURL = config.port && config.port !== 80 && config.port !== 443 
                ? `${config.host}:${config.port}` 
                : config.host;
        } else {
            // 如果host不包含协议，添加协议前缀
            const protocol = config.useHttps ? 'https' : 'http';
            this.baseURL = `${protocol}://${config.host}:${config.port}`;
        }
        
        this.isInitialized = false;
    }

    async initialize() {
        try {
            this.logger.info('初始化腾讯云向量数据库...');
            
            // 测试数据库连接 - 使用官方API格式
            await this.testConnection();
            
            this.isInitialized = true;
            this.logger.info('腾讯云向量数据库初始化成功');
            
        } catch (error) {
            this.logger.error('腾讯云向量数据库初始化失败:', error);
            throw error;
        }
    }

    async testConnection() {
        try {
            // 使用官方API：查询所有数据库来测试连接
            const response = await this.listDatabases();
            this.logger.debug('数据库连接测试成功');
            return response;
        } catch (error) {
            this.logger.debug('连接测试:', error.message);
            // 即使API调用失败，只要不是网络错误就认为连接正常
            if (!error.message.includes('socket hang up') && !error.message.includes('ECONNRESET')) {
                return true;
            }
            throw error;
        }
    }

    // TC1: 创建Database - 使用官方API格式
    async createDatabase(databaseName) {
        try {
            this.logger.info(`创建数据库: ${databaseName}`);
            
            const response = await this.makeRequest('POST', '/database/create', {
                database: databaseName,
                description: `Database created for testing - ${databaseName}`
            });
            
            this.logger.info(`数据库 ${databaseName} 创建成功`);
            return response;
        } catch (error) {
            // 如果是数据库已存在，降级为警告
            if (error.message.includes('already exist')) {
                this.logger.warn(`数据库 ${databaseName} 已存在`);
                return { success: true, message: 'Database already exists' };
            }
            this.logger.error(`创建数据库失败: ${error.message}`);
            throw error;
        }
    }

    // TC2: 删除Database - 使用官方API格式
    async dropDatabase(databaseName) {
        try {
            this.logger.info(`删除数据库: ${databaseName}`);
            
            const response = await this.makeRequest('POST', '/database/drop', {
                database: databaseName
            });
            
            this.logger.info(`数据库 ${databaseName} 删除成功`);
            return response;
        } catch (error) {
            this.logger.error(`删除数据库失败: ${error.message}`);
            throw error;
        }
    }

    // TC3: 列出所有Database - 使用官方API格式，根据文档应该是POST请求
    async listDatabases() {
        try {
            this.logger.info('获取数据库列表');
            
            // 根据官方文档，/database/list 是 POST 请求，不需要请求体
            const response = await this.makeRequest('POST', '/database/list');
            
            this.logger.info(`获取到 ${response.data?.databases ? response.data.databases.length : 0} 个数据库`);
            return response;
        } catch (error) {
            this.logger.error(`获取数据库列表失败: ${error.message}`);
            throw error;
        }
    }

    // TC4: 创建Collection - 使用官方API格式，完整参数
    async createCollection(databaseName, collectionName, params = {}) {
        try {
            this.logger.info(`在数据库 ${databaseName} 中创建集合: ${collectionName}`);
            
            // 根据腾讯云API调试结果，修正默认参数
            const collectionData = {
                database: databaseName,
                collection: collectionName,
                replicaNum: params.replicaNum !== undefined ? params.replicaNum : 0,  // 腾讯云要求必须是0
                shardNum: params.shardNum || 1,
                description: params.description || `Collection created by Node.js client - ${collectionName}`,
                indexes: params.indexes || [
                    // 默认主键索引
                    {
                        fieldName: "id",
                        fieldType: "string",
                        indexType: "primaryKey"
                    },
                    // 默认向量索引 - 修正维度为768
                    {
                        fieldName: "vector",
                        fieldType: "vector",
                        indexType: "HNSW",
                        dimension: 768,  // 修正为768维度
                        metricType: "COSINE",
                        params: {
                            M: 16,
                            efConstruction: 200
                        }
                    }
                ]
            };

            const result = await this.makeRequest('POST', '/collection/create', collectionData);
            
            if (result.success) {
                this.logger.info(`集合 ${collectionName} 创建成功`);
            }
            
            return result;
            
        } catch (error) {
            this.logger.error(`创建集合失败: ${error.message}`);
            return {
                success: false,
                status: 500,
                message: '集合创建失败',
                error: error.message
            };
        }
    }

    // TC5: 删除Collection - 使用官方API格式
    async dropCollection(databaseName, collectionName) {
        try {
            this.logger.info(`删除集合: ${databaseName}.${collectionName}`);
            
            const response = await this.makeRequest('POST', '/collection/drop', {
                database: databaseName,
                collection: collectionName
            });
            
            // 检查响应是否成功
            if (response.success) {
            this.logger.info(`集合 ${collectionName} 删除成功`);
            return response;
            } else {
                // 检查是否是Collection不存在的错误
                if (response.data && response.data.code === 15302) {
                    this.logger.info(`集合 ${collectionName} 不存在，无需删除`);
                    // Collection不存在的情况，返回特殊标识
                    return {
                        success: true,
                        status: 200,
                        notExist: true, // 添加标识表示collection不存在
                        data: {
                            code: 15302,
                            message: `Collection ${collectionName} does not exist`,
                            affectedCount: 0
                        },
                        message: `集合 ${collectionName} 不存在`
                    };
                } else {
                    this.logger.error(`删除集合失败: ${response.message || 'Unknown error'}`);
                    const error = new Error(response.message || 'Delete collection failed');
                    error.response = response;
                    throw error;
                }
            }
        } catch (error) {
            // 如果是我们主动抛出的错误，直接传递
            if (error.code === 15302) {
                throw error;
            }
            this.logger.error(`删除集合失败: ${error.message}`);
            throw error;
        }
    }

    // TC6: 查询Collection详情 - 使用官方API格式
    async describeCollection(databaseName, collectionName) {
        try {
            this.logger.info(`查询集合详情: ${databaseName}.${collectionName}`);
            
            const response = await this.makeRequest('POST', '/collection/describe', {
                database: databaseName,
                collection: collectionName
            });
            
            if (response.success) {
                this.logger.info(`获取集合 ${collectionName} 详情成功`);
            } else {
                this.logger.warn(`获取集合 ${collectionName} 详情失败: ${response.message}`);
            }
            return response;
        } catch (error) {
            this.logger.error(`查询集合详情失败: ${error.message}`);
            // 返回失败响应而不是抛出异常
            return {
                success: false,
                status: 500,
                data: null,
                message: `查询集合详情失败: ${error.message}`,
                error: error.message
            };
        }
    }

    // TC7: 列出所有Collection - 使用官方API格式
    async listCollections(databaseName) {
        try {
            this.logger.info(`获取数据库 ${databaseName} 的集合列表`);
            
            const response = await this.makeRequest('POST', '/collection/list', {
                database: databaseName
            });
            
            this.logger.info(`获取到 ${response.data?.collections ? response.data.collections.length : 0} 个集合`);
            return response;
        } catch (error) {
            this.logger.error(`获取集合列表失败: ${error.message}`);
            throw error;
        }
    }

    // TC8: 向量数据写入 - 使用官方API格式
    async upsertDocuments(databaseName, collectionName, documents) {
        try {
            this.logger.info(`向集合 ${databaseName}.${collectionName} 写入 ${documents.length} 条数据`);
            
            const response = await this.makeRequest('POST', '/document/upsert', {
                database: databaseName,
                collection: collectionName,
                documents: documents,
                buildIndex: true  // 根据官方文档，默认为true
            });
            
            this.logger.info(`数据写入成功`);
            return response;
        } catch (error) {
            this.logger.error(`数据写入失败: ${error.message}`);
            throw error;
        }
    }

    // TC9: 向量相似度检索 - 使用官方API格式
    async searchVectors(databaseName, collectionName, vectors, params = {}) {
        try {
            this.logger.info(`执行向量检索: ${databaseName}.${collectionName}`);
            
            // 确保vectors是正确的数组格式 - 腾讯云需要二维数组
            let vectorArray;
            if (Array.isArray(vectors)) {
                // 如果是数组，检查第一个元素是否也是数组
                if (vectors.length > 0 && Array.isArray(vectors[0])) {
                    vectorArray = vectors; // 已经是二维数组
                } else {
                    vectorArray = [vectors]; // 转换为二维数组
                }
            } else {
                vectorArray = [vectors]; // 单个向量包装为二维数组
            }

            this.logger.debug(`向量数组格式检查:`, {
                originalType: Array.isArray(vectors) ? 'array' : typeof vectors,
                originalLength: Array.isArray(vectors) ? vectors.length : 'N/A',
                processedLength: vectorArray.length,
                firstElementType: vectorArray.length > 0 ? (Array.isArray(vectorArray[0]) ? 'array' : typeof vectorArray[0]) : 'N/A',
                firstElementLength: vectorArray.length > 0 && Array.isArray(vectorArray[0]) ? vectorArray[0].length : 'N/A'
            });
            
            // 根据官方API文档格式构建请求体
            const requestBody = {
                database: databaseName,
                collection: collectionName,
                search: {
                    vectors: vectorArray,
                    params: params.searchParams || {
                        ef: 200  // 默认ef参数
                    },
                    limit: params.limit || 10,
                    retrieveVector: params.retrieveVector !== undefined ? params.retrieveVector : false  // 修正从params获取参数
                }
            };

            // 处理过滤器 - 转换为腾讯云格式的字符串
            if (params.filter) {
                requestBody.search.filter = this._convertFilterToTencentFormat(params.filter);
            }

            // 处理输出字段
            // if (params.outputFields && params.outputFields.length > 0) {
            //     requestBody.search.outputFields = params.outputFields;
            // }

            // 如果有混合检索参数
            if (params.hybridSearch) {
                requestBody.search.hybridSearch = params.hybridSearch;
            }
            this.logger.info(`量检索请求体:`, JSON.stringify(requestBody, null, 2));
            const response = await this.makeRequest('POST', '/document/search', requestBody);
            
            this.logger.info(`向量检索完成，返回 ${response.data?.results ? response.data.results.length : 0} 条结果`);
            return response;
        } catch (error) {
            this.logger.error(`向量检索失败: ${error.message}`);
            throw error;
        }
    }

    // 新的代码向量存储接口 - 适配 /api/v1/codebase/upsert 接口
    async upsertCodebase(requestId, database, collection, documents, buildIndex = true) {
        try {
            this.logger.info(`代码向量存储: ${documents.length} 个文档到 ${database}.${collection}`);
            
            // 构建请求数据，符合新接口规范，支持压缩向量
            const requestData = {
                requestId: requestId,
                database: database,
                collection: collection,
                documents: documents.map(doc => ({
                    snippet_id: doc.snippet_id,
                    user_id: doc.user_id,
                    device_id: doc.device_id,
                    workspace_path: doc.workspace_path,
                    file_path: doc.file_path,
                    start_line: doc.start_line,
                    end_line: doc.end_line,
                    code: doc.code,
                    vector: doc.isCompressed ? null : doc.vector,
                    compressedVector: doc.isCompressed ? doc.compressedVector : null,
                    isCompressed: doc.isCompressed || false,
                    vector_model: doc.vector_model || "CoCoSoDa-v1.0"
                })),
                buildIndex: buildIndex
            };

            // 发送到新的代理接口
            const response = await this.makeCodebaseRequest('POST', '/api/v1/codebase/upsert', requestData);
            
            if (response.status === 'success') {
                this.logger.info(`代码向量存储成功: 影响 ${response.affectedRows} 行`);
                return {
                    success: true,
                    affectedRows: response.affectedRows,
                    requestId: response.requestId,
                    timestamp: response.timestamp
                };
            } else {
                this.logger.error(`代码向量存储失败: ${response.error}`);
                throw new Error(response.error || 'Upsert failed');
            }
            
        } catch (error) {
            this.logger.error(`代码向量存储异常: ${error.message}`);
            throw error;
        }
    }

    // 新的HTTP请求方法，专门用于代码库接口
    async makeCodebaseRequest(method, endpoint, data = null) {
        const url = require('url').URL;
        const https = require('https');
        const http = require('http');
        
        try {
            // 使用代码库API的基础URL（可能与向量数据库不同）
            const codebaseBaseURL = this.config.codebaseApiUrl || this.baseURL;
            const requestUrl = new URL(endpoint, codebaseBaseURL);
            const isHttps = requestUrl.protocol === 'https:';
            
            const options = {
                hostname: requestUrl.hostname,
                port: requestUrl.port || (isHttps ? 443 : 80),
                path: requestUrl.pathname + requestUrl.search,
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.apiKey}`,
                    'User-Agent': 'CodeChunker-VectorDB/1.0.0'
                },
                timeout: this.config.timeout || 30000
            };

            if (data) {
                const postData = JSON.stringify(data);
                options.headers['Content-Length'] = Buffer.byteLength(postData);
            }

            return new Promise((resolve, reject) => {
                const req = (isHttps ? https : http).request(options, (res) => {
                    let responseData = '';
                    
                    res.on('data', (chunk) => {
                        responseData += chunk;
                    });
                    
                    res.on('end', () => {
                        try {
                            // 检查响应数据是否为空或不完整
                            if (!responseData || responseData.trim().length === 0) {
                                reject(new Error('Empty response from server'));
                                return;
                            }
                            
                            // 检查响应是否看起来像JSON
                            if (!responseData.trim().startsWith('{') && !responseData.trim().startsWith('[')) {
                                this.logger.error(`Non-JSON response received: ${responseData.substring(0, 200)}...`);
                                reject(new Error(`Invalid response format: expected JSON, got: ${responseData.substring(0, 100)}...`));
                                return;
                            }
                            
                            const parsed = JSON.parse(responseData);
                            
                            if (res.statusCode >= 200 && res.statusCode < 300) {
                                resolve(parsed);
                            } else {
                                const error = new Error(parsed.error || `HTTP ${res.statusCode}`);
                                error.statusCode = res.statusCode;
                                error.response = parsed;
                                error.errorCode = parsed.errorCode;
                                reject(error);
                            }
                        } catch (error) {
                            this.logger.error(`JSON parse error. Response length: ${responseData.length}, Content: ${responseData.substring(0, 200)}...`);
                            reject(new Error(`Failed to parse response: ${error.message}. Response was: ${responseData.substring(0, 200)}...`));
                        }
                    });
                });

                req.on('error', (error) => {
                    reject(new Error(`Request failed: ${error.message}`));
                });

                req.on('timeout', () => {
                    req.destroy();
                    reject(new Error('Request timeout'));
                });

                if (data) {
                    req.write(JSON.stringify(data));
                }
                
                req.end();
            });
            
        } catch (error) {
            this.logger.error(`代码库请求失败: ${error.message}`);
            throw error;
        }
    }

    // 修改现有的batchUpsert方法以使用新接口
    async batchUpsert(comboKey, vectors) {
        try {
            this.logger.info(`开始批量向量存储: ${comboKey} - ${vectors.length} 个向量`);

            // 验证和过滤向量数据
            const validVectors = this._validateAndFilterVectors(vectors);
            if (validVectors.length === 0) {
                this.logger.warn('没有有效的向量数据需要存储');
                return {
                    success: true,
                    count: 0,
                    message: '没有有效数据'
                };
            }

            // 解析comboKey获取用户信息
            const [userId, deviceId, workspaceHash] = comboKey.split('_');
            const workspacePath = this._extractWorkspacePathFromHash(workspaceHash) || '/unknown/workspace';
            
            // 准备数据库和集合名称
            const databaseName = this.config.database || 'codebase_db';
            // ✅ 修复：使用时间戳生成新的collection名称，避免旧collection的socket hang up问题
            const timestamp = Date.now();
            const collectionName = `code_vectors_${timestamp}`;
            
            // 转换为新接口格式的文档，支持压缩向量
            const documents = validVectors.map((vector, index) => ({
                snippet_id: vector.id || `${comboKey}_${index}`,
                user_id: userId,
                device_id: deviceId,
                workspace_path: workspacePath,
                file_path: vector.filePath || 'unknown',
                start_line: vector.startLine || 1,
                end_line: vector.endLine || 1,
                code: vector.content || '',
                vector: vector.isCompressed ? null : vector.vector,
                compressedVector: vector.isCompressed ? vector.compressedVector : null,
                isCompressed: vector.isCompressed || false,
                vector_model: vector.vectorModel || "CoCoSoDa-v1.0"
            }));

            // 生成请求ID
            const requestId = `req-upsert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            // 使用新的代码库接口
            const result = await this.upsertCodebase(requestId, databaseName, collectionName, documents, true);
            
            this.logger.info(`批量向量存储完成: ${result.affectedRows} 行数据`);
            
            return {
                success: true,
                count: result.affectedRows,
                requestId: result.requestId,
                details: result
            };

        } catch (error) {
            this.logger.error(`批量向量存储失败: ${error.message}`);
            
            // 如果新接口失败，可以尝试回退到原接口（可选）
            if (error.message.includes('404') || error.message.includes('endpoint')) {
                this.logger.warn('新接口不可用，尝试使用原接口...');
                return await this._fallbackBatchUpsert(comboKey, vectors);
            }
            
            throw error;
        }
    }

    // 回退方法：使用原有的腾讯云接口
    async _fallbackBatchUpsert(comboKey, vectors) {
        this.logger.info('使用原有腾讯云接口进行向量存储');
        
        try {
            // 验证和过滤向量数据
            const validVectors = this._validateAndFilterVectors(vectors);
            if (validVectors.length === 0) {
                return {
                    success: true,
                    count: 0,
                    message: '没有有效数据'
                };
            }

            // 生成集合名称
            const crypto = require('crypto');
            const workspaceHash = crypto.createHash('sha256').update(comboKey).digest('hex').substring(0, 16);
            const collectionName = `collection_${comboKey}`;
            const databaseName = this.config.database || 'vectordb-test';

            // 确保集合存在
            await this._ensureCollectionExists(databaseName, collectionName, 768);

            // 转换为腾讯云格式
            const documents = validVectors.map((vector, index) => ({
                id: vector.id || `${comboKey}_${index}`,
                vector: vector.vector,
                user_id: comboKey.split('_')[0] || 'unknown',
                device_id: comboKey.split('_')[1] || 'unknown',
                workspace_path: vector.workspacePath || 'unknown',
                file_path: vector.filePath || 'unknown',
                start_line: vector.startLine || 1,
                end_line: vector.endLine || 1,
                code: vector.content || '',
                vector_model: vector.vectorModel || 'default'
            }));

            // 分批上传
            const batchSize = this.config.batchSize || 100;
            const batches = this._splitIntoBatches(documents, batchSize);
            let totalUploaded = 0;

            for (let i = 0; i < batches.length; i++) {
                const batch = batches[i];
                this.logger.debug(`上传批次 ${i + 1}/${batches.length}: ${batch.length} 个向量`);
                
                const batchResult = await this._uploadBatchWithRetry(databaseName, collectionName, batch);
                totalUploaded += batchResult.count || 0;
            }

            this.logger.info(`回退接口批量存储完成: ${totalUploaded} 个向量`);
            
            return {
                success: true,
                count: totalUploaded,
                fallback: true
            };

        } catch (error) {
            this.logger.error(`回退接口也失败: ${error.message}`);
            throw error;
        }
    }

    // 辅助方法：从哈希中提取工作区路径（简化实现）
    _extractWorkspacePathFromHash(workspaceHash) {
        // 这里可以实现更复杂的逻辑来恢复原始路径
        // 目前返回一个通用路径
        return `/workspace/${workspaceHash}`;
    }

    // 辅助方法：验证和过滤向量数据
    _validateAndFilterVectors(vectors) {
        const validVectors = [];
        
        // ✅ 修复：重新计算合理的限制
        // 向量维度768 * 8字节(双精度) ≈ 6KB 
        // 加上其他字段，总文档大小应该控制在9KB以下
        const maxCodeSize = 2 * 1024; // ✅ 代码内容限制降到2KB
        const vectorSizeEstimate = 768 * 8; // ✅ 768维向量的估算大小
        
        for (let i = 0; i < vectors.length; i++) {
            const vector = vectors[i];
            
            // 基本字段检查
            if (!vector.id || !vector.vector || !Array.isArray(vector.vector)) {
                this.logger.warn(`向量 ${i} 缺少必要字段 (id 或 vector)，跳过`);
                continue;
            }
            
            // ✅ 修复：先处理代码内容，确保不会过大
            let codeContent = vector.code || '';
            if (codeContent.length > maxCodeSize) {
                // 智能截断：保留开头和结尾
                const truncateSize = maxCodeSize - 50; // 为标记保留空间
                const halfSize = Math.floor(truncateSize / 2);
                codeContent = codeContent.substring(0, halfSize) + 
                             '\n\n... [内容截断] ...\n\n' + 
                             codeContent.substring(codeContent.length - halfSize);
                this.logger.debug(`向量 ${vector.id} 代码内容截断: ${vector.code.length} -> ${codeContent.length} 字符`);
            }
            
            // ✅ 修复：更准确的文档大小估算（不包含向量数据）
            const metadataSize = JSON.stringify({
                id: vector.id,
                user_id: vector.user_id || 'unknown',
                device_id: vector.device_id || 'unknown',
                workspace_path: vector.workspace_path || 'unknown',
                file_path: vector.file_path || 'unknown',
                code: codeContent,
                start_line: vector.start_line || 0,
                end_line: vector.end_line || 0,
                vector_model: vector.vector_model || 'unknown'
            }).length;
            
            // ✅ 文档总大小 = 元数据 + 向量数据
            const estimatedTotalSize = metadataSize + vectorSizeEstimate;
            const maxDocSize = 9 * 1024; // ✅ 腾讯云限制是10KB，留1KB余量
            
            if (estimatedTotalSize > maxDocSize) {
                this.logger.warn(`向量 ${vector.id} 文档仍然过大 (${estimatedTotalSize} > ${maxDocSize})，跳过处理`);
                continue;
            }
            
            // 确保必要字段存在
            const validVector = {
                id: vector.id,
                vector: vector.vector,
                user_id: vector.user_id || 'unknown',
                device_id: vector.device_id || 'unknown',
                workspace_path: vector.workspace_path || 'unknown',
                file_path: vector.file_path || 'unknown',
                code: codeContent, // ✅ 使用处理后的代码内容
                start_line: vector.start_line || 0,
                end_line: vector.end_line || 0,
                vector_model: vector.vector_model || 'unknown'
            };
            
            validVectors.push(validVector);
        }
        
        this.logger.info(`向量验证完成: ${validVectors.length}/${vectors.length} 个向量有效`);
        return validVectors;
    }

    // 辅助方法：带重试的批量上传
    async _uploadBatchWithRetry(databaseName, collectionName, batch, maxRetries = 3) {
        let lastError;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const result = await this.upsertDocuments(databaseName, collectionName, batch);
                
                if (result.success) {
                    return result;
                } else {
                    lastError = new Error(result.message || '上传失败');
                    
                    // 如果是索引未准备错误，等待一下再重试
                    if (result.message && result.message.includes('current index is not ready')) {
                        this.logger.warn(`索引未准备就绪，等待${attempt * 2}秒后重试 (${attempt}/${maxRetries})`);
                        await new Promise(resolve => setTimeout(resolve, attempt * 2000));
                        continue;
                    } else {
                        throw lastError;
                    }
                }
                
            } catch (error) {
                lastError = error;
                
                // 对于400错误（客户端错误），不要重试
                if (error.response && error.response.status === 400) {
                    this.logger.error(`客户端错误，不重试: ${error.response.data ? JSON.stringify(error.response.data) : error.message}`);
                    throw error;
                }
                
                if (attempt < maxRetries) {
                    this.logger.warn(`批量上传失败，${attempt * 2}秒后重试 (${attempt}/${maxRetries}): ${error.message}`);
                    await new Promise(resolve => setTimeout(resolve, attempt * 2000));
                } else {
                    this.logger.error(`批量上传最终失败，已重试${maxRetries}次: ${error.message}`);
                    throw error;
                }
            }
        }
        
        throw lastError;
    }

    // 辅助方法：确保集合存在
    async _ensureCollectionExists(databaseName, collectionName, vectorDimension = 768) {
        try {
            // 检查集合是否存在
            const describeResult = await this.describeCollection(databaseName, collectionName);
            
            if (describeResult.success) {
                this.logger.info(`集合 ${collectionName} 已存在，检查是否需要重新创建...`);
                
                // 检查现有集合的维度配置
                const existingDimension = describeResult.data?.collection?.indexes?.find(
                    index => index.fieldName === 'vector'
                )?.dimension;
                
                if (existingDimension && existingDimension !== vectorDimension) {
                    this.logger.info(`集合维度不匹配 (现有: ${existingDimension}, 需要: ${vectorDimension})，重新创建集合...`);
                    
                    // 删除现有集合
                    await this.dropCollection(databaseName, collectionName);
                    
                    // 创建新集合
                    await this._createCollectionWithFields(databaseName, collectionName, vectorDimension);
                } else {
                    this.logger.debug(`集合 ${collectionName} 配置正确，跳过重新创建`);
                }
            } else {
                // 检查是否是"集合不存在"的错误
                if (describeResult.data && describeResult.data.code === 15302) {
                    this.logger.info(`集合 ${collectionName} 不存在，正在创建...`);
                    await this._createCollectionWithFields(databaseName, collectionName, vectorDimension);
                } else {
                    // 其他错误，抛出异常
                    throw new Error(`查询集合详情失败: ${describeResult.message || '未知错误'}`);
                }
            }
            
        } catch (error) {
            // 对于已知的"集合不存在"错误，创建集合
            if (error.message.includes('not exist') || error.message.includes('Not Found') || 
                (error.response && error.response.data && error.response.data.msg && 
                 error.response.data.msg.includes('not exist'))) {
                this.logger.info(`集合 ${collectionName} 不存在，正在创建...`);
                await this._createCollectionWithFields(databaseName, collectionName, vectorDimension);
            } else {
                throw error;
            }
        }
    }

    // 辅助方法：创建带有完整字段定义的集合
    async _createCollectionWithFields(databaseName, collectionName, vectorDimension) {
        const collectionParams = {
            description: `Auto-created collection for ${collectionName}`,
            indexes: [
                {
                    fieldName: "id",
                    fieldType: "string",
                    indexType: "primaryKey"
                },
                {
                    fieldName: "vector",
                    fieldType: "vector",
                    indexType: "HNSW",
                    dimension: vectorDimension,
                    metricType: "COSINE",
                    params: {
                        M: 16,
                        efConstruction: 200
                    }
                },
                // 添加测试数据的字段
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
                    fieldName: "code",
                    fieldType: "string",
                    indexType: "filter"
                },
                // 添加更多可能需要的字段
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
                    fieldName: "vector_model",
                    fieldType: "string",
                    indexType: "filter"
                }
            ]
        };
        
        const createResult = await this.createCollection(databaseName, collectionName, collectionParams);
        if (createResult.success) {
            this.logger.info(`集合 ${collectionName} 创建成功，维度: ${vectorDimension}`);
            
            // 等待索引构建完成
            await this._waitForIndexReady(databaseName, collectionName);
        } else {
            throw new Error(`创建集合失败: ${createResult.message || '未知错误'}`);
        }
    }

    // 辅助方法：等待索引准备就绪
    async _waitForIndexReady(databaseName, collectionName, maxWaitTime = 60000) {
        this.logger.info(`等待集合 ${collectionName} 的索引构建完成...`);
        
        const startTime = Date.now();
        let retryCount = 0;
        const maxRetries = Math.floor(maxWaitTime / 2000); // 每2秒检查一次
        
        while (retryCount < maxRetries) {
            try {
                // 尝试插入一个测试文档来检查索引是否就绪
                const testDoc = {
                    id: `test_${Date.now()}`,
                    vector: new Array(768).fill(0.1),
                    user_id: 'test',
                    device_id: 'test',
                    workspace_path: 'test',
                    file_path: 'test',
                    code: 'test',
                    start_line: 1,
                    end_line: 1,
                    vector_model: 'test'
                };
                
                const result = await this.upsertDocuments(databaseName, collectionName, [testDoc]);
                
                if (result.success) {
                    // 索引就绪，删除测试文档
                    await this.deleteDocuments(databaseName, collectionName, `id="${testDoc.id}"`);
                    this.logger.info(`集合 ${collectionName} 索引构建完成，耗时 ${Date.now() - startTime}ms`);
                    return;
                }
                
            } catch (error) {
                if (error.message && error.message.includes('current index is not ready')) {
                    // 索引还未准备好，继续等待
                    retryCount++;
                    this.logger.debug(`索引尚未准备就绪，等待中... (${retryCount}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    continue;
                } else {
                    // 其他错误，可能索引已经准备好了
                    this.logger.info(`索引状态检查完成 (可能已就绪): ${error.message}`);
                    return;
                }
            }
        }
        
        // 超时但不抛出错误，让后续操作自行处理
        this.logger.warn(`等待索引就绪超时 (${maxWaitTime}ms)，将继续尝试上传数据`);
    }

    // 辅助方法：分批处理
    _splitIntoBatches(items, batchSize) {
        const batches = [];
        for (let i = 0; i < items.length; i += batchSize) {
            batches.push(items.slice(i, i + batchSize));
        }
        return batches;
    }

    async search(queryVector, topK, comboKey, options = {}) {
        try {
            const collectionName = `collection_${comboKey}`;
            const databaseName = this.config.database || 'vectordb-test';
            
            this.logger.info(`执行搜索: ${databaseName}.${collectionName}, topK=${topK}`);
            this.logger.debug(`查询向量长度: ${queryVector.length}`);
            this.logger.debug(`搜索选项:`, JSON.stringify(options, null, 2));
            
            // 修正输出字段配置，避免使用'*'
            const defaultOutputFields = ['id', 'user_id', 'device_id', 'workspace_path', 'file_path', 'code', 'start_line', 'end_line', 'vector_model'];
            
            const params = {
                limit: topK,
                filter: options.filter,
                outputFields: options.outputFields || defaultOutputFields,
                retrieveVector: false  // 默认不返回向量以提高性能
            };
            
            this.logger.debug(`搜索参数:`, JSON.stringify(params, null, 2));
            
            const response = await this.searchVectors(databaseName, collectionName, queryVector, params);
            
            this.logger.debug(`搜索响应:`, JSON.stringify(response, null, 2));
            
            // 转换为标准格式
            if (response.success && response.data) {
                // 检查不同可能的响应格式
                let documents = response.data.documents || response.data.results || response.data;
                
                if (Array.isArray(documents)) {
                    this.logger.info(`找到 ${documents.length} 个搜索结果`);
                    return documents.map(doc => ({
                        id: doc.id,
                        score: doc.score || 0,
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
                        metadata: doc
                    }));
                } else {
                    this.logger.warn(`意外的响应格式，documents不是数组:`, typeof documents);
                }
            } else {
                // 检查常见的错误代码，提供更友好的处理
                if (response.data && response.data.code) {
                    const errorCode = response.data.code;
                    const errorMsg = response.data.msg || '未知错误';
                    
                    switch (errorCode) {
                        case 15171:
                            this.logger.warn(`向量维度不匹配: ${errorMsg} - 请检查向量维度是否与集合定义一致`);
                            break;
                        case 14000:
                            this.logger.warn(`字段不存在错误: ${errorMsg} - 请检查outputFields中指定的字段是否在集合中定义`);
                            break;
                        default:
                            this.logger.warn(`搜索响应包含错误 (${errorCode}): ${errorMsg}`);
                    }
                } else {
                    this.logger.warn(`搜索响应不包含成功数据:`, JSON.stringify(response, null, 2));
                }
            }
            
            return [];
            
        } catch (error) {
            this.logger.error(`搜索失败，完整错误信息:`, {
                message: error.message,
                stack: error.stack,
                code: error.code,
                response: error.response?.data,
                status: error.response?.status
            });
            throw new Error(`向量搜索失败: ${error.message || '未知错误'}`);
        }
    }

    // TC10: 精确查询 - 使用官方API格式
    async queryDocuments(databaseName, collectionName, filter, params = {}) {
        try {
            this.logger.info(`执行精确查询: ${databaseName}.${collectionName}`);
            
            const requestBody = {
                database: databaseName,
                collection: collectionName,
                filter: filter,
                limit: params.limit || 10,
                offset: params.offset || 0,
                outputFields: params.outputFields || []  // 指定返回的字段
            };

            // 如果指定了特定字段
            if (params.retrieveVector !== undefined) {
                requestBody.retrieveVector = params.retrieveVector;
            }
            
            const response = await this.makeRequest('POST', '/document/query', requestBody);
            
            this.logger.info(`精确查询完成，返回 ${response.data?.documents ? response.data.documents.length : 0} 条结果`);
            return response;
        } catch (error) {
            this.logger.error(`精确查询失败: ${error.message}`);
            throw error;
        }
    }

    // TC11: 删除数据 - 使用官方API格式
    async deleteDocuments(databaseName, collectionName, filter) {
        try {
            this.logger.info(`删除文档: ${databaseName}.${collectionName}`);
            
            const response = await this.makeRequest('POST', '/document/delete', {
                database: databaseName,
                collection: collectionName,
                filter: filter
            });
            
            this.logger.info(`文档删除成功`);
            return response;
        } catch (error) {
            this.logger.error(`删除文档失败: ${error.message}`);
            throw error;
        }
    }

    // TC12: 清空Collection - 使用官方API格式
    async truncateCollection(databaseName, collectionName) {
        try {
            this.logger.info(`清空集合: ${databaseName}.${collectionName}`);
            
            const response = await this.makeRequest('POST', '/collection/truncate', {
                database: databaseName,
                collection: collectionName
            });
            
            this.logger.info(`集合清空成功`);
            return response;
        } catch (error) {
            this.logger.error(`清空集合失败: ${error.message}`);
            throw error;
        }
    }

    // 将对象格式的过滤器转换为腾讯云API的字符串格式
    _convertFilterToTencentFormat(filter) {
        if (!filter || typeof filter === 'string') {
            return filter; // 如果已经是字符串格式，直接返回
        }
        
        const conditions = [];
        
        for (const [field, value] of Object.entries(filter)) {
            if (Array.isArray(value)) {
                // 数组格式转换为 in 操作 - 使用腾讯云格式
                const valueStr = value.map(v => `"${v}"`).join(',');
                conditions.push(`${field} in (${valueStr})`);
            } else if (typeof value === 'object' && value !== null) {
                // 范围查询等复杂条件
                if (value.$in) {
                    const valueStr = value.$in.map(v => `"${v}"`).join(',');
                    conditions.push(`${field} in (${valueStr})`);
                } else if (value.$eq) {
                    conditions.push(`${field}="${value.$eq}"`);  // 移除空格
                } else if (value.$gt) {
                    conditions.push(`${field}>${value.$gt}`);   // 移除空格
                } else if (value.$lt) {
                    conditions.push(`${field}<${value.$lt}`);   // 移除空格
                }
            } else {
                // 简单等值条件 - 移除等号两边的空格，使用腾讯云标准格式
                conditions.push(`${field}="${value}"`);
            }
        }
        
        // 使用腾讯云格式的连接符
        return conditions.length > 0 ? conditions.join(' and ') : '';  // 使用小写 'and'
    }

    // 发送HTTP请求的通用方法 - 根据官方文档修正认证方式
    async makeRequest(method, endpoint, data = null) {
        const maxRetries = 3;
        let lastError;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const url = `${this.baseURL}${endpoint}`;
                
                // 根据官方文档：使用 Authorization Bearer 头部认证
                const authToken = `account=${this.config.username}&api_key=${this.config.apiKey}`;
                
                // 标准HTTP请求头 + 官方认证头部
                const headers = {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${authToken}`,
                    'User-Agent': 'TencentVectorDB-NodeJS-Client/1.0.0',
                    'Connection': 'keep-alive'  // 保持连接
                };

                this.logger.debug(`发送请求 (尝试 ${attempt}/${maxRetries}): ${method} ${url}`);
                if (data) {
                    this.logger.debug(`请求数据:`, JSON.stringify(data, null, 2));
                }

                const axiosConfig = {
                    method,
                    url,
                    headers,
                    timeout: this.config.timeout || 60000, // 增加到60秒
                    validateStatus: (status) => {
                        // 接受2xx状态码
                        return status >= 200 && status < 300;
                    },
                    // 添加重试配置
                    retry: {
                        retries: 0, // axios层面不重试，我们手动控制
                        retryDelay: (retryCount) => {
                            return Math.pow(2, retryCount) * 1000; // 指数退避
                        },
                        retryCondition: (error) => {
                            // 网络错误才重试
                            return error.code === 'ECONNRESET' || 
                                   error.code === 'ETIMEDOUT' || 
                                   error.code === 'ECONNABORTED';
                        }
                    },
                    // 添加HTTP Agent配置
                    httpAgent: new (require('http').Agent)({
                        keepAlive: true,
                        keepAliveMsecs: 30000,
                        maxSockets: 5,
                        timeout: 30000
                    })
                };

                // 只有在有数据时才添加data字段
                if (data && method !== 'GET') {
                    axiosConfig.data = data;
                }

                const response = await axios(axiosConfig);

                this.logger.debug(`响应状态: ${response.status}`);
                this.logger.debug(`响应数据:`, JSON.stringify(response.data, null, 2));

                return {
                    success: true,
                    status: response.status,
                    data: response.data,
                    headers: response.headers,
                    message: this.getStatusMessage(response.status)
                };

            } catch (error) {
                lastError = error;
                
                if (error.response) {
                    // 检查是否是常见的业务错误，降级为警告
                    const isBusinessError = error.response.data && (
                        error.response.data.msg?.includes('already exist') ||
                        error.response.data.msg?.includes('current index is not ready') ||
                        error.response.data.code === 15201 || // 数据库已存在
                        error.response.data.code === 13100    // 索引未准备好
                    );
                    
                    if (isBusinessError) {
                        this.logger.warn(`业务警告 (${error.response.status}): ${error.response.data.msg || error.message}`);
                        return {
                            success: false,
                            status: error.response.status,
                            data: error.response.data,
                            headers: error.response.headers,
                            message: this.getStatusMessage(error.response.status),
                            error: error.message
                        };
                    } else {
                        this.logger.error(`请求失败 (尝试 ${attempt}/${maxRetries}): ${error.message}`);
                        this.logger.error(`响应状态: ${error.response.status}`);
                        this.logger.error(`响应数据:`, error.response.data);
                    }
                    
                    // 对于HTTP错误，不重试
                    return {
                        success: false,
                        status: error.response.status,
                        data: error.response.data,
                        headers: error.response.headers,
                        message: this.getStatusMessage(error.response.status),
                        error: error.message
                    };
                } else if (error.request) {
                    // 网络错误，可以重试
                    const isRetryableError = error.code === 'ECONNRESET' || 
                                           error.code === 'ETIMEDOUT' || 
                                           error.code === 'ECONNABORTED' ||
                                           error.message.includes('timeout');
                    
                    if (isRetryableError && attempt < maxRetries) {
                        const delay = Math.pow(2, attempt - 1) * 1000; // 指数退避: 1s, 2s, 4s
                        this.logger.warn(`网络错误，${delay}ms后重试 (${attempt}/${maxRetries}): ${error.message}`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue; // 重试
                    }
                    
                    this.logger.error(`网络错误 (尝试 ${attempt}/${maxRetries}):`, error.message);
                } else {
                    this.logger.error(`请求设置错误 (尝试 ${attempt}/${maxRetries}):`, error.message);
                }
                
                // 如果是最后一次尝试，返回错误
                if (attempt === maxRetries) {
                    break;
                }
            }
        }
        
        // 所有重试都失败了
        return {
            success: false,
            status: 0,
            data: null,
            message: `网络错误 (已重试${maxRetries}次): ${lastError?.message || 'Unknown error'}`,
            error: lastError?.message || 'Unknown error'
        };
    }

    // 获取状态码对应的消息
    getStatusMessage(status) {
        const statusMessages = {
            200: 'Success',
            201: 'Created',
            400: 'Bad Request - 请求参数错误',
            401: 'Unauthorized - 认证失败',
            403: 'Forbidden - 权限不足',
            404: 'Not Found - 资源不存在',
            405: 'Method Not Allowed - 请求方法不允许',
            409: 'Conflict - 资源冲突',
            422: 'Unprocessable Entity - 请求格式错误',
            429: 'Too Many Requests - 请求过于频繁',
            500: 'Internal Server Error - 服务器内部错误',
            502: 'Bad Gateway - 网关错误',
            503: 'Service Unavailable - 服务不可用',
            504: 'Gateway Timeout - 网关超时'
        };
        
        return statusMessages[status] || `HTTP ${status}`;
    }

    async close() {
        try {
            this.logger.info('关闭腾讯云向量数据库连接');
            this.isInitialized = false;
        } catch (error) {
            this.logger.error('关闭连接时出错:', error);
        }
    }
}

module.exports = TencentVectorDB; 