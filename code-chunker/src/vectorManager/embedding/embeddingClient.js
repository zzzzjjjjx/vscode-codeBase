const https = require('https');
const http = require('http');
const crypto = require('crypto');
const URL = require('url').URL;
const backendApiConfig = require('../../../config/backend-api-config');
const config = require('../../config');

/**
 * 新版本嵌入客户端
 * 适配新的 /api/v1/codebase/embed 接口
 */
class EmbeddingClient {
    constructor(options = {}) {
        // 从现有配置系统获取配置
        const userConfig = config.getAll();
        
        // 解析API端点（支持<SERVER_IP>占位符格式）
        let apiEndpoint = options.apiEndpoint || userConfig.apiEndpoint;
        if (apiEndpoint && apiEndpoint.includes('<SERVER_IP>')) {
            const serverIP = process.env.BACKEND_API_SERVER_IP || '42.193.14.136:8087';
            const protocol = process.env.BACKEND_API_PROTOCOL || 'http';
            apiEndpoint = apiEndpoint.replace('<SERVER_IP>', serverIP);
            
            // 如果协议不匹配，更新协议
            if (apiEndpoint.startsWith('https://') && protocol === 'http') {
                apiEndpoint = apiEndpoint.replace('https://', 'http://');
            } else if (apiEndpoint.startsWith('http://') && protocol === 'https') {
                apiEndpoint = apiEndpoint.replace('http://', 'https://');
            }
        }
        
        // 解析URL获取基础信息
        const url = new URL(apiEndpoint || 'http://42.193.14.136:8087/api/v1/codebase/embed');
        this.baseURL = `${url.protocol}//${url.host}`;
        
        this.config = {
            baseURL: this.baseURL,
            token: options.token || process.env.BACKEND_API_TOKEN || userConfig.token || 'test_auth_token',
            timeout: options.timeout || userConfig.timeout || 30000,
            batchSize: options.batchSize || userConfig.batchSize || 100,
            maxRetries: options.maxRetries || userConfig.maxRetries || 3,
            retryDelay: options.retryDelay || userConfig.retryDelay || 1000,
            logLevel: options.logLevel || 'info',
        };
        
        // 新的API端点
        this.endpoints = {
            embed: '/api/v1/codebase/embed',
            upsert: '/api/v1/codebase/upsert'
        };
        
        this.stats = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            totalProcessingTime: 0,
        };
        
        this._log('info', `EmbeddingClient initialized with baseURL: ${this.baseURL}`);
    }

    /**
     * 生成随机ID
     */
    _generateId() {
        return `req-${crypto.randomBytes(8).toString('hex')}`;
    }

    /**
     * 生成UUID格式的请求ID
     */
    _generateRequestId() {
        return `req-${crypto.randomBytes(8).toString('hex')}`;
    }

    /**
     * 嵌入代码块 - 新接口格式
     * @param {Array} codeBlocks - 代码块数组
     * @param {Object} options - 处理选项
     */
    async embedCodeBlocks(codeBlocks, options = {}) {
        const startTime = Date.now();
        
        try {
            // 验证并获取处理后的代码块
            const validatedBlocks = this._validateCodeBlocks(codeBlocks);
            
            // 准备新接口格式的请求数据
            const requestData = {
                requestId: this._generateRequestId(),
                uniqueId: options.uniqueId || `${Date.now()}-unknown-unknown`,
                parserVersion: options.parserVersion || "v0.1.2",
                timestamp: new Date().toISOString(),
                processingMode: options.processingMode || "sync",
                codeChunks: validatedBlocks.map(block => ({
                    chunkId: block.chunkId,
                    filePath: block.filePath,
                    language: block.language || this._detectLanguage(block.filePath),
                    startLine: block.startLine || 1,
                    endLine: block.endLine || 1,
                    content: block.content,
                    parser: block.parser || "ast_parser"
                }))
            };

            
            this._log('info', `Processing ${validatedBlocks.length} code blocks with requestId: ${requestData.requestId}`);
            
            // 发送请求到新的接口
            const response = await this._makeRequest('POST', this.endpoints.embed, requestData);
            
            const processingTime = Date.now() - startTime;
            this._updateStats(true, processingTime);
            
            // 处理响应并转换为原格式兼容
            const result = this._processNewEmbedResponse(response, validatedBlocks);
            
            this._log('info', `Successfully processed ${validatedBlocks.length} code blocks in ${processingTime}ms`);
            return result;
            
        } catch (error) {
            const processingTime = Date.now() - startTime;
            this._updateStats(false, processingTime);
            
            this._log('error', `Failed to process code blocks: ${error.message}`);
            throw error;
        }
    }

    /**
     * 获取单个查询的嵌入向量（用于搜索功能）
     * @param {string} query - 查询字符串
     * @param {Object} options - 处理选项
     */
    async getEmbedding(query, options = {}) {
        const startTime = Date.now();
        
        try {
            if (!query || typeof query !== 'string') {
                throw new Error('Query must be a non-empty string');
            }

            if (Buffer.byteLength(query, 'utf8') > 10240) { // 10KB
                throw new Error('Query exceeds 10KB limit');
            }

            this._log('info', `Getting embedding for query: "${query.substring(0, 50)}${query.length > 50 ? '...' : ''}"`);

            // 将查询包装为代码块格式以复用现有API
            const queryBlock = {
                chunkId: options.queryId || `query_${this._generateId()}`,
                filePath: 'search_query',
                language: 'text',
                startLine: 1,
                endLine: 1,
                content: query,
                parser: 'search'
            };

            // 使用embedCodeBlocks方法处理单个查询
            const result = await this.embedCodeBlocks([queryBlock], {
                ...options,
                processingMode: 'sync'
            });

            const processingTime = Date.now() - startTime;

            // 提取第一个结果的向量，支持压缩向量格式
            if (result.results && result.results.length > 0) {
                const firstResult = result.results[0];
                if (firstResult.status === 'success') {
                    this._log('info', `Successfully generated embedding for query in ${processingTime}ms`);
                    
                    // 支持压缩向量格式
                    const response = {
                        vector: firstResult.vector,
                        compressedVector: firstResult.compressedVector,
                        isCompressed: firstResult.isCompressed || false,
                        vectorDimension: firstResult.vectorDimension,
                        processingTimeMs: firstResult.processingTimeMs,
                        modelVersion: firstResult.modelVersion
                    };
                    
                    // 记录压缩向量信息
                    if (firstResult.isCompressed) {
                        this._log('info', `Query embedding is compressed: compressedVector length = ${firstResult.compressedVector ? firstResult.compressedVector.length : 'null'}`);
                    }
                    
                    return response;
                } else {
                    throw new Error(`Failed to generate embedding: ${firstResult.error}`);
                }
            } else {
                throw new Error('No embedding result returned');
            }
            
        } catch (error) {
            this._log('error', `Failed to get embedding for query: ${error.message}`);
            throw error;
        }
    }

    /**
     * 处理新接口的响应格式（支持压缩向量）
     */
    _processNewEmbedResponse(response, originalBlocks) {
        try {
            // 增强日志记录，显示完整的响应信息（强制输出）

            
            // 兼容后端返回的字段名错误：支持 "status:" 和 "status"
            const status = response.status || response['status:'];
            
            // 检查是否为成功响应
            // 如果有明确的错误字段（detail, error, message），则认为是错误响应
            const hasErrorField = response.detail || response.error || response.message;
            const isSuccessStatus = status === 'success';
            const hasSuccessFields = response.results || response.processed !== undefined;
            
            if (isSuccessStatus || (!hasErrorField && hasSuccessFields)) {
                // 处理压缩向量格式
                const processedResults = this._processCompressedVectors(response.results);
                
                return {
                    status: 'success',
                    requestId: response.requestId,
                    processed: response.processed,
                    skipped: response.skipped,
                    results: processedResults,
                    totalProcessingTimeMs: response.totalProcessingTimeMs,
                    timestamp: response.timestamp,
                    processingMode: 'sync'
                };
            } else {
                // 优先检查各种可能的错误字段
                const errorMsg = response.error || response.detail || response.message || 'Unknown error occurred';
                console.error(`🔥 [EmbeddingClient] Response indicates failure. Status: "${status}", Error: "${errorMsg}"`);
                console.error(`🔥 [EmbeddingClient] Available error fields:`, {
                    error: response.error,
                    detail: response.detail,
                    message: response.message
                });
                throw new Error(errorMsg);
            }
        } catch (error) {
            console.error(`🔥 [EmbeddingClient] Failed to process embed response: ${error.message}`);
            console.error(`🔥 [EmbeddingClient] Full response object:`, JSON.stringify(response, null, 2));
            throw error;
        }
    }

    /**
     * 处理压缩向量格式的结果
     */
    _processCompressedVectors(results) {
        if (!Array.isArray(results)) {
            return results;
        }

        return results.map(result => {
            const processedResult = { ...result };

            // 处理压缩向量
            if (result.isCompressed === true) {
                // 确保压缩格式的数据结构正确
                processedResult.vector = null;
                processedResult.compressedVector = result.compressedVector;
                processedResult.isCompressed = true;
            } else {
                // 如果不是压缩格式，使用原始向量
                processedResult.vector = result.vector;
                processedResult.compressedVector = null;
                processedResult.isCompressed = false;
            }

            return processedResult;
        });
    }

    /**
     * 验证代码块数据
     */
    _validateCodeBlocks(codeBlocks) {
        if (!Array.isArray(codeBlocks)) {
            throw new Error('codeBlocks must be an array');
        }
        
        if (codeBlocks.length === 0) {
            throw new Error('codeBlocks cannot be empty');
        }
        
        if (codeBlocks.length > 100) {
            throw new Error('codeBlocks cannot exceed 100 items');
        }
        
        const validatedBlocks = [];
        
        for (let index = 0; index < codeBlocks.length; index++) {
            const block = codeBlocks[index];
            
            // 验证必填字段
            if (!block.chunkId) {
                throw new Error(`Code block ${index}: chunkId is required`);
            }
            
            if (!block.filePath) {
                throw new Error(`Code block ${index}: filePath is required`);
            }
            
            if (block.content === undefined || block.content === null) {
                throw new Error(`Code block ${index}: content is required`);
            }
            
            // 详细记录空内容情况，但不过滤
            if (block.content === '' || block.content === null || block.content === undefined) {
                console.error(`🚨 [EmbeddingClient] 空内容代码块详情:`);
                console.error(`   索引: ${index}`);
                console.error(`   chunkId: ${block.chunkId}`);
                console.error(`   filePath: ${block.filePath}`);
                console.error(`   行号范围: ${block.startLine}-${block.endLine}`);
                console.error(`   内容类型: ${typeof block.content}`);
                console.error(`   内容值: ${JSON.stringify(block.content)}`);
                this._log('warn', `Code block ${index} (${block.chunkId}) has empty content`);
            }
            
            // 检查内容长度（10KB限制）
            const contentSize = Buffer.byteLength(block.content, 'utf8');
            if (contentSize > 10240) {
                // 自动分割超大代码块而不是抛出错误
                this._log('warn', `Code block ${index} exceeds 10KB (${contentSize} bytes), splitting automatically`);
                const splitBlocks = this._splitLargeCodeBlock(block);
                validatedBlocks.push(...splitBlocks);
            } else {
                validatedBlocks.push({
                    chunkId: block.chunkId,
                    filePath: block.filePath,
                    language: block.language || this._detectLanguage(block.filePath),
                    startLine: block.startLine || 1,
                    endLine: block.endLine || 1,
                    content: block.content,
                    parser: block.parser || 'ast_parser'
                });
            }
        }
        
        return validatedBlocks;
    }

    /**
     * 分割过大的代码块
     */
    _splitLargeCodeBlock(block, maxSize = 10240) {
        const lines = block.content.split('\n');
        const chunks = [];
        let currentLines = [];
        let currentStartLine = block.startLine || 1;
        let partIndex = 0;
        
        for (let i = 0; i < lines.length; i++) {
            currentLines.push(lines[i]);
            const currentContent = currentLines.join('\n');
            const currentSize = Buffer.byteLength(currentContent, 'utf8');
            
            // 如果达到大小限制或是最后一行
            if (currentSize >= maxSize - 100 || i === lines.length - 1) { // 留100字节余量
                if (currentSize > maxSize && currentLines.length > 1) {
                    // 移除最后一行，保存当前块
                    currentLines.pop();
                    const finalContent = currentLines.join('\n');
                    
                    chunks.push({
                        chunkId: `${block.chunkId}_part_${partIndex++}`,
                        filePath: block.filePath,
                        language: block.language || this._detectLanguage(block.filePath),
                        startLine: currentStartLine,
                        endLine: currentStartLine + currentLines.length - 1,
                        content: finalContent,
                        parser: block.parser || 'ast_parser'
                    });
                    
                    // 从当前行重新开始 - 修复Bug: 应该基于处理的行数更新起始行号
                    const processedLines = currentLines.length;
                    currentLines = [lines[i]];
                    currentStartLine = currentStartLine + processedLines;
                } else {
                    // 保存当前块
                    chunks.push({
                        chunkId: `${block.chunkId}_part_${partIndex++}`,
                        filePath: block.filePath,
                        language: block.language || this._detectLanguage(block.filePath),
                        startLine: currentStartLine,
                        endLine: currentStartLine + currentLines.length - 1,
                        content: currentContent,
                        parser: block.parser || 'ast_parser'
                    });
                    
                    // 重置 - 修复Bug: 在重置currentLines之前先保存长度
                    const processedLines = currentLines.length;
                    currentLines = [];
                    currentStartLine = currentStartLine + processedLines;
                }
            }
        }
        
        this._log('info', `Split large code block ${block.chunkId} into ${chunks.length} parts`);
        return chunks;
    }

    /**
     * 检测文件语言
     */
    _detectLanguage(filePath) {
        if (!filePath) return 'unknown';
        
        const ext = filePath.split('.').pop()?.toLowerCase();
        
        const languageMap = {
            'js': 'javascript',
            'ts': 'typescript',
            'py': 'python',
            'java': 'java',
            'cpp': 'cpp',
            'c': 'c',
            'cs': 'csharp',
            'go': 'go',
            'rs': 'rust',
            'php': 'php',
            'rb': 'ruby',
            'json': 'json',
            'yaml': 'yaml',
            'yml': 'yaml',
            'xml': 'xml',
            'html': 'html',
            'css': 'css',
            'md': 'markdown'
        };
        
        return languageMap[ext] || 'unknown';
    }

    /**
     * 发送HTTP请求
     */
    async _makeRequest(method, endpoint, data = null) {
        const requestStartTime = process.hrtime.bigint(); // 高精度请求开始时间
        const url = new URL(endpoint, this.baseURL);
        const isHttps = url.protocol === 'https:';
        
        // 特别标记upsert请求
        const isUpsertRequest = endpoint.includes('/upsert');
        
        if (isUpsertRequest) {
            console.log(`\n🌐 ===== HTTP 网络请求详情 =====`);
            console.log(`📡 URL: ${method} ${this.baseURL}${endpoint}`);
            console.log(`🔗 协议: ${isHttps ? 'HTTPS' : 'HTTP'}`);
            console.log(`🏠 主机: ${url.hostname}:${url.port || (isHttps ? 443 : 80)}`);
            console.log(`🔑 认证: Bearer ${this.config.token.substring(0, 10)}...`);
            console.log(`⏱️ 超时: ${this.config.timeout}ms`);
        }
        
        const options = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.token}`,
                'User-Agent': 'CodeChunker-EmbeddingClient/1.0.0'
            },
            timeout: this.config.timeout
        };

        if (data) {
            const postData = JSON.stringify(data);
            options.headers['Content-Length'] = Buffer.byteLength(postData);
            
            if (isUpsertRequest) {
                console.log(`📦 请求体大小: ${Buffer.byteLength(postData)} bytes`);
                console.log(`📝 Content-Length: ${options.headers['Content-Length']}`);
            }
        }

        return new Promise((resolve, reject) => {
            let connectionStartTime;
            let firstByteTime;
            let responseEndTime;
            
            const req = (isHttps ? https : http).request(options, (res) => {
                firstByteTime = process.hrtime.bigint(); // 接收到第一个字节的时间
                let responseData = '';
                
                res.on('data', (chunk) => {
                    responseData += chunk;
                });
                
                res.on('end', () => {
                    responseEndTime = process.hrtime.bigint(); // 响应完全接收完成时间
                    
                    try {
                        // 检查响应数据是否为空或不完整
                        if (!responseData || responseData.trim().length === 0) {
                            reject(new Error('Empty response from server'));
                            return;
                        }
                        
                        // 检查响应是否看起来像JSON
                        if (!responseData.trim().startsWith('{') && !responseData.trim().startsWith('[')) {
                            this._log('error', `Non-JSON response received: ${responseData.substring(0, 200)}...`);
                            reject(new Error(`Invalid response format: expected JSON, got: ${responseData.substring(0, 100)}...`));
                            return;
                        }
                        
                        const parsed = JSON.parse(responseData);
                        
                        // 计算网络通信时间
                        const totalRequestTime = Number(responseEndTime - requestStartTime) / 1000000; // 转换为毫秒
                        const serverProcessingTime = 14; // 已知的服务器内部处理时间
                        const networkCommunicationTime = totalRequestTime - serverProcessingTime;
                        
                        // 详细的时间分析
                        const connectionTime = connectionStartTime ? Number(connectionStartTime - requestStartTime) / 1000000 : 0;
                        const timeToFirstByte = Number(firstByteTime - requestStartTime) / 1000000;
                        const dataTransferTime = Number(responseEndTime - firstByteTime) / 1000000;
                        
                        // 记录网络性能分析（强制输出重要性能信息）
                        console.log(`\n📊 [网络性能分析] ${endpoint} 接口调用时间统计:`);
                        console.log(`├─ 总请求时间: ${totalRequestTime.toFixed(2)}ms`);
                        console.log(`├─ 服务器处理时间: ${serverProcessingTime}ms (已知)`);
                        console.log(`├─ 网络通信时间: ${networkCommunicationTime.toFixed(2)}ms`);
                        console.log(`├─ 连接建立时间: ${connectionTime.toFixed(2)}ms`);
                        console.log(`├─ 首字节响应时间: ${timeToFirstByte.toFixed(2)}ms`);
                        console.log(`├─ 数据传输时间: ${dataTransferTime.toFixed(2)}ms`);
                        console.log(`├─ 响应数据大小: ${Buffer.byteLength(responseData, 'utf8')} bytes`);
                        console.log(`└─ 网络通信占比: ${((networkCommunicationTime / totalRequestTime) * 100).toFixed(1)}%\n`);
                        
                        // 记录到性能分析数组中
                        if (!this.networkPerformanceData) {
                            this.networkPerformanceData = [];
                        }
                        
                        this.networkPerformanceData.push({
                            timestamp: new Date().toISOString(),
                            totalRequestTime: totalRequestTime,
                            serverProcessingTime: serverProcessingTime,
                            networkCommunicationTime: networkCommunicationTime,
                            connectionTime: connectionTime,
                            timeToFirstByte: timeToFirstByte,
                            dataTransferTime: dataTransferTime,
                            responseSize: Buffer.byteLength(responseData, 'utf8'),
                            networkRatio: (networkCommunicationTime / totalRequestTime) * 100
                        });
                        
                        // 如果有外部性能分析器，记录详细网络数据
                        if (this.performanceAnalyzer) {
                            this.performanceAnalyzer.recordDetailedNetworkRequest(
                                'embedding',
                                totalRequestTime,
                                networkCommunicationTime,
                                serverProcessingTime,
                                true
                            );
                        }
                        
                        if (isUpsertRequest) {
                            console.log(`\n📥 ===== HTTP 响应详情 =====`);
                            console.log(`📊 状态码: ${res.statusCode} ${res.statusMessage || ''}`);
                            console.log(`📋 响应头:`, JSON.stringify(res.headers, null, 2));
                            console.log(`📄 响应体:`, JSON.stringify(parsed, null, 2));
                            console.log(`📥 ============================\n`);
                        }
                        
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(parsed);
                        } else {
                            if (isUpsertRequest) {
                                console.error(`\n❌ ===== HTTP 错误响应 =====`);
                                console.error(`📊 状态码: ${res.statusCode} ${res.statusMessage || ''}`);
                                console.error(`📋 响应头:`, JSON.stringify(res.headers, null, 2));
                                console.error(`📄 错误响应体:`, JSON.stringify(parsed, null, 2));
                                console.error(`❌ ===========================\n`);
                            }
                            
                            const error = new Error(parsed.error || `HTTP ${res.statusCode}`);
                            error.statusCode = res.statusCode;
                            error.response = parsed;
                            reject(error);
                        }
                    } catch (error) {
                        this._log('error', `JSON parse error. Response length: ${responseData.length}, Content: ${responseData.substring(0, 200)}...`);
                        reject(new Error(`Failed to parse response: ${error.message}. Response was: ${responseData.substring(0, 200)}...`));
                    }
                });
            });

            req.on('connect', () => {
                connectionStartTime = process.hrtime.bigint(); // 连接建立时间
            });

            req.on('error', (error) => {
                if (isUpsertRequest) {
                    console.error(`\n💥 ===== HTTP 网络错误 =====`);
                    console.error(`📡 URL: ${method} ${this.baseURL}${endpoint}`);
                    console.error(`❌ 错误类型: ${error.constructor.name}`);
                    console.error(`📝 错误消息: ${error.message}`);
                    console.error(`🔧 错误代码: ${error.code || 'N/A'}`);
                    console.error(`📚 错误堆栈:`, error.stack);
                    console.error(`💥 ========================\n`);
                }
                reject(new Error(`Request failed: ${error.message}`));
            });

            req.on('timeout', () => {
                if (isUpsertRequest) {
                    console.error(`\n⏰ ===== HTTP 请求超时 =====`);
                    console.error(`📡 URL: ${method} ${this.baseURL}${endpoint}`);
                    console.error(`⏱️ 超时设置: ${this.config.timeout}ms`);
                    console.error(`⏰ ========================\n`);
                }
                req.destroy();
                reject(new Error('Request timeout'));
            });

            if (data) {
                req.write(JSON.stringify(data));
            }
            
            req.end();
        });
    }

    /**
     * 更新统计信息
     */
    _updateStats(success, processingTime) {
        this.stats.totalRequests++;
        if (success) {
            this.stats.successfulRequests++;
        } else {
            this.stats.failedRequests++;
        }
        this.stats.totalProcessingTime += processingTime;
    }

    /**
     * 日志记录
     */
    _log(level, message) {
        if (level === 'error' || this.config.logLevel === 'debug' || 
            (this.config.logLevel === 'info' && level === 'info')) {
    
        }
    }

    /**
     * 获取统计信息
     */
    getStats() {
        return {
            ...this.stats,
            averageProcessingTime: this.stats.totalRequests > 0 
                ? this.stats.totalProcessingTime / this.stats.totalRequests 
                : 0
        };
    }

    /**
     * 生成网络性能分析报告
     */
    generateNetworkPerformanceReport() {
        if (!this.networkPerformanceData || this.networkPerformanceData.length === 0) {
            console.log('\n📊 [网络性能报告] 暂无性能数据');
            return null;
        }

        const data = this.networkPerformanceData;
        const count = data.length;

        // 计算统计信息
        const totalRequestTimes = data.map(d => d.totalRequestTime);
        const networkTimes = data.map(d => d.networkCommunicationTime);
        const connectionTimes = data.map(d => d.connectionTime);
        const firstByteTimes = data.map(d => d.timeToFirstByte);
        const transferTimes = data.map(d => d.dataTransferTime);
        const responseSizes = data.map(d => d.responseSize);
        const networkRatios = data.map(d => d.networkRatio);

        const calculateStats = (arr) => ({
            min: Math.min(...arr),
            max: Math.max(...arr),
            avg: arr.reduce((a, b) => a + b, 0) / arr.length,
            median: arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)]
        });

        const totalStats = calculateStats(totalRequestTimes);
        const networkStats = calculateStats(networkTimes);
        const connectionStats = calculateStats(connectionTimes);
        const firstByteStats = calculateStats(firstByteTimes);
        const transferStats = calculateStats(transferTimes);
        const sizeStats = calculateStats(responseSizes);
        const ratioStats = calculateStats(networkRatios);

        const report = {
            summary: {
                totalRequests: count,
                timeRange: {
                    start: data[0].timestamp,
                    end: data[data.length - 1].timestamp
                },
                serverProcessingTime: 14 // 固定值
            },
            performance: {
                totalRequestTime: totalStats,
                networkCommunicationTime: networkStats,
                connectionTime: connectionStats,
                timeToFirstByte: firstByteStats,
                dataTransferTime: transferStats,
                responseSize: sizeStats,
                networkRatio: ratioStats
            },
            rawData: data
        };

        // 输出详细报告
        console.log('\n' + '='.repeat(80));
        console.log('📊 网络性能分析报告');
        console.log('='.repeat(80));
        console.log(`\n📈 总体统计 (基于 ${count} 次请求)`);
        console.log(`├─ 时间范围: ${new Date(report.summary.timeRange.start).toLocaleString()} ~ ${new Date(report.summary.timeRange.end).toLocaleString()}`);
        console.log(`└─ 服务器处理时间: ${report.summary.serverProcessingTime}ms (固定值)\n`);

        console.log('⏱️  时间性能分析:');
        console.log(`├─ 总请求时间    : 平均 ${totalStats.avg.toFixed(2)}ms | 最小 ${totalStats.min.toFixed(2)}ms | 最大 ${totalStats.max.toFixed(2)}ms | 中位数 ${totalStats.median.toFixed(2)}ms`);
        console.log(`├─ 网络通信时间  : 平均 ${networkStats.avg.toFixed(2)}ms | 最小 ${networkStats.min.toFixed(2)}ms | 最大 ${networkStats.max.toFixed(2)}ms | 中位数 ${networkStats.median.toFixed(2)}ms`);
        console.log(`├─ 连接建立时间  : 平均 ${connectionStats.avg.toFixed(2)}ms | 最小 ${connectionStats.min.toFixed(2)}ms | 最大 ${connectionStats.max.toFixed(2)}ms | 中位数 ${connectionStats.median.toFixed(2)}ms`);
        console.log(`├─ 首字节响应时间: 平均 ${firstByteStats.avg.toFixed(2)}ms | 最小 ${firstByteStats.min.toFixed(2)}ms | 最大 ${firstByteStats.max.toFixed(2)}ms | 中位数 ${firstByteStats.median.toFixed(2)}ms`);
        console.log(`└─ 数据传输时间  : 平均 ${transferStats.avg.toFixed(2)}ms | 最小 ${transferStats.min.toFixed(2)}ms | 最大 ${transferStats.max.toFixed(2)}ms | 中位数 ${transferStats.median.toFixed(2)}ms\n`);

        console.log('📦 数据传输分析:');
        console.log(`├─ 响应数据大小  : 平均 ${(sizeStats.avg / 1024).toFixed(2)}KB | 最小 ${(sizeStats.min / 1024).toFixed(2)}KB | 最大 ${(sizeStats.max / 1024).toFixed(2)}KB`);
        console.log(`└─ 网络时间占比  : 平均 ${ratioStats.avg.toFixed(1)}% | 最小 ${ratioStats.min.toFixed(1)}% | 最大 ${ratioStats.max.toFixed(1)}%\n`);

        console.log('🎯 性能优化建议:');
        if (networkStats.avg > 100) {
            console.log('├─ ⚠️  网络通信时间较长，建议检查网络连接质量');
        }
        if (connectionStats.avg > 50) {
            console.log('├─ ⚠️  连接建立时间较长，建议考虑连接复用或更近的服务器');
        }
        if (ratioStats.avg > 70) {
            console.log('├─ ⚠️  网络时间占比过高，主要瓶颈在网络通信而非服务器处理');
        }
        if (sizeStats.avg > 100 * 1024) { // 100KB
            console.log('├─ ⚠️  响应数据较大，建议考虑数据压缩或分批处理');
        }
        if (networkStats.avg < 30 && ratioStats.avg < 50) {
            console.log('├─ ✅ 网络性能良好，主要处理时间在服务器端');
        }
        console.log('└─ 💡 持续监控这些指标有助于识别性能瓶颈和优化方向\n');

        console.log('='.repeat(80));

        return report;
    }

    /**
     * 清除网络性能数据
     */
    clearNetworkPerformanceData() {
        this.networkPerformanceData = [];
        console.log('🗑️  [网络性能] 已清除历史性能数据');
    }

    /**
     * 获取网络性能数据
     */
    getNetworkPerformanceData() {
        return this.networkPerformanceData || [];
    }
}

module.exports = EmbeddingClient;
