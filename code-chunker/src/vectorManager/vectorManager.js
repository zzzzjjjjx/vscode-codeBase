const VectorDB = require('./database/vectorDB');
const EmbeddingClient = require('./embedding/embeddingClient');
const PathEncryption = require('./security/pathEncryption');
const Logger = require('./utils/logger');
const Validator = require('./utils/validator');
const RetryHelper = require('./utils/retry');
const TencentVectorDB = require('./database/tencentVectorDB');
const TencentVectorDBAdapter = require('./database/tencentVectorDBAdapter');
const { createCollectionName } = require('../utils/collectionNameUtils');

class VectorManager {
    constructor(config = {}) {
        this.config = config;
        this.logger = new Logger('VectorManager', config.logLevel);
        this.validator = new Validator();
        this.retryHelper = new RetryHelper(config.retry);
        
        // 核心组件
        this.vectorDB = null;
        this.embeddingClient = null;
        this.pathEncryption = null;
        
        // 状态管理
        this.isInitialized = false;
        this.isShuttingDown = false;
        this.uploadInProgress = new Set(); // 跟踪正在上传的 comboKey
        
        // 临时存储（用于开发模式，替代缓存）
        this.tempVectors = new Map();
    }

    async initialize() {
        if (this.isInitialized) {
            this.logger.warn('VectorManager is already initialized');
            return;
        }

        try {
            this.logger.info('Initializing VectorManager...');
            
            // 检查是否配置了数据库且不是local类型
            const shouldInitFullMode = this.config.database && 
                                     this.config.database.type !== 'local' && 
                                     this.config.database.type !== 'disabled';
            
            // 在开发和测试环境中简化初始化，但如果配置了在线数据库则完整初始化
            if ((process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') && !shouldInitFullMode) {
                this.logger.info('Development mode: simplified VectorManager initialization');
                
                // 最小化初始化
                if (this.config.embedding) {
                this.embeddingClient = new EmbeddingClient(this.config.embedding);
                this.logger.info('EmbeddingClient initialized');
                }
                
                // 跳过其他复杂组件的初始化
                this.pathEncryption = null;
                this.vectorDB = null;
                
            } else {
                // 生产环境或在线模式完整初始化
                this.logger.info('Production mode: full VectorManager initialization');
                
                try {
                    // 1. 初始化安全模块
                    if (this.config.security && this.config.security.enabled) {
                        this.pathEncryption = new PathEncryption(this.config.security);
                        await this.pathEncryption.initialize();
                        this.logger.info('PathEncryption initialized');
                    } else {
                        this.logger.info('PathEncryption disabled, using passthrough mode');
                        this.pathEncryption = new PathEncryption({ enabled: false });
                        await this.pathEncryption.initialize();
                    }
                    
                    // 2. 跳过数据库连接初始化 - 只使用API接口
                    if (this.config.database && this.config.database.enabled && this.config.database.type !== 'api_only') {
                        // 根据配置类型选择不同的数据库实现
                        if (this.config.database.type === 'tencent_vectordb') {
                            // 使用腾讯云向量数据库适配器
                            this.vectorDB = new TencentVectorDBAdapter(this.config.database);
                            await this.vectorDB.initialize();
                            this.logger.info('Tencent VectorDB Adapter initialized');
                        } else if (this.config.database.type === 'tencent_cloud') {
                            // 使用默认VectorDB实现
                            this.vectorDB = new VectorDB(this.config.database);
                            await this.vectorDB.initialize();
                            this.logger.info('VectorDB initialized with Tencent Cloud');
                        }
                    } else {
                        this.logger.info('Database disabled or API-only mode, skipping VectorDB initialization');
                        this.vectorDB = null;
                    }
                    
                    // 3. 初始化嵌入服务客户端
                    if (this.config.embedding) {
                    this.embeddingClient = new EmbeddingClient(this.config.embedding);
                    this.logger.info('EmbeddingClient initialized');
                    }
                    
                    // 4. 注册清理回调
                    this._registerCleanupHandlers();
                    
                } catch (error) {
                    this.logger.error('Failed to initialize production components, falling back to simplified mode:', error);
                    
                    // 降级到简化模式，但仍尝试初始化基础组件
                    this.pathEncryption = new PathEncryption({ enabled: false });
                    await this.pathEncryption.initialize();
                    this.vectorDB = null;
                    
                    // 尝试初始化嵌入客户端
                    try {
                        if (this.config.embedding) {
                        this.embeddingClient = new EmbeddingClient(this.config.embedding);
                        this.logger.info('EmbeddingClient initialized in fallback mode');
                        }
                    } catch (embeddingError) {
                        this.logger.warn('Failed to initialize EmbeddingClient in fallback mode:', embeddingError);
                        this.embeddingClient = null;
                    }
                    
                    // 启用临时存储机制
                    this.tempVectors = new Map();
                    this.logger.info('Temporary vector storage enabled for fallback mode');
                }
            }
            
            this.isInitialized = true;
            this.logger.info('VectorManager initialized successfully');
            
        } catch (error) {
            this.logger.error('Failed to initialize VectorManager:', error);
            await this._cleanup();
            throw error;
        }
    }

    async addVector(data) {
        if (!this.isInitialized) {
            throw new Error('VectorManager not initialized');
        }
        
        if (this.isShuttingDown) {
            console.warn(`VectorManager is shutting down, skipping vector ${data.chunkId}`);
            return false;
        }
        
        try {
            // 1. 数据验证
            this._validateVectorData(data);
            
            // 2. 生成组合键
            const comboKey = this._generateComboKey(data.userId, data.deviceId, data.workspacePath);
            
            // 3. 如果有vectorDB，直接上传；否则存储到临时位置
            if (this.vectorDB) {
                // 确保目标集合存在
                await this._ensureCollectionExists(comboKey);
                
                // 直接上传到向量数据库
                const vectorData = {
                    id: data.chunkId,
                    vector: data.vector,
                    user_id: data.userId || 'unknown',
                    device_id: data.deviceId || 'unknown',
                    workspace_path: data.workspacePath || 'unknown',
                    file_path: this.pathEncryption ? this.pathEncryption.encryptPath(data.filePath) : data.filePath,
                    code: data.content || data.code || '',
                    start_line: data.startLine || data.start_line || 0,
                    end_line: data.endLine || data.end_line || 0,
                    vector_model: data.vector_model || 'CoCoSoDa-v1.0',
                    metadata: {
                        timestamp: Date.now(),
                        ...data.metadata
                    }
                };
                
                await this.vectorDB.upsert(comboKey, [vectorData]);
                this.logger.debug(`Added vector ${data.chunkId} directly to database for ${comboKey}`);
                return true;
            } else {
                // 临时存储模式
                if (!this.tempVectors.has(comboKey)) {
                    this.tempVectors.set(comboKey, []);
                }
                
                const tempVector = {
                    id: data.chunkId,
                    vector: data.vector,
                    filePath: data.filePath,
                    fileName: data.fileName,
                    userId: data.userId,
                    deviceId: data.deviceId,
                    workspacePath: data.workspacePath,
                    ...data.metadata
                };
                
                this.tempVectors.get(comboKey).push(tempVector);
                this.logger.debug(`Added vector ${data.chunkId} to temporary storage for ${comboKey}`);
                return true;
            }
            
        } catch (error) {
            this.logger.error(`Error adding vector ${data.chunkId}:`, error);
            
            if (this._isCriticalError(error)) {
                throw error;
            }
            
            return false;
        }
    }

    async search(query, topK = 10, options = {}) {
        if (!this.isInitialized) {
            throw new Error('VectorManager not initialized');
        }
        
        try {
            // 1. 参数验证
            if (!query || typeof query !== 'string') {
                throw new Error('Query must be a non-empty string');
            }
            
            if (!Number.isInteger(topK) || topK <= 0) {
                throw new Error('topK must be a positive integer');
            }
            
            // 2. 生成组合键（用于限定搜索范围）
            const comboKey = this._generateComboKey(
                options.userId, 
                options.deviceId, 
                options.workspacePath
            );
            
            // 3. 如果没有vectorDB但有临时存储，使用简单的文本匹配
            if (!this.vectorDB && this.tempVectors && this.tempVectors.has(comboKey)) {
                this.logger.debug(`Using temporary storage for search: ${comboKey}`);
                
                const vectors = this.tempVectors.get(comboKey);
                const results = vectors.filter(vector => {
                    // 简单的文本匹配搜索
                    const content = vector.content || '';
                    const filePath = vector.filePath || '';
                    const language = vector.language || '';
                    
                    return content.toLowerCase().includes(query.toLowerCase()) ||
                           filePath.toLowerCase().includes(query.toLowerCase()) ||
                           language.toLowerCase().includes(query.toLowerCase());
                }).slice(0, topK).map((vector, index) => ({
                    chunkId: vector.id,
                    id: vector.id,
                    score: 0.9 - (index * 0.1), // 模拟相似度分数
                    similarity: 0.9 - (index * 0.1),
                    filePath: vector.filePath,
                    fileName: vector.fileName,
                    startLine: vector.startLine,
                    endLine: vector.endLine,
                    content: vector.content,
                    metadata: {
                        userId: vector.userId,
                        deviceId: vector.deviceId,
                        workspacePath: vector.workspacePath,
                        language: vector.language,
                        parser: vector.parser,
                        type: vector.type,
                        vectorModel: 'temp-storage',
                        originalScore: 0.9 - (index * 0.1)
                    }
                }));
                
                this.logger.info(`Temporary storage search completed: found ${results.length} results`);
                return results;
            }
            
            // 3. 获取查询向量 - 支持压缩向量格式
            const queryEmbedding = await this.retryHelper.executeWithRetry(
                () => this.embeddingClient.getEmbedding(query),
                'Getting embedding for query'
            );
            
            // 处理压缩向量格式：如果是压缩向量，需要解压缩或使用压缩向量搜索
            let queryVector;
            if (queryEmbedding.isCompressed && queryEmbedding.compressedVector) {
                // 如果后端支持压缩向量搜索，直接使用压缩向量
                // 否则这里需要解压缩逻辑（目前暂时抛出错误提醒开发者）
                this.logger.warn('Query embedding is compressed. Current implementation requires uncompressed vectors for search.');
                // TODO: 实现压缩向量的解压缩逻辑或支持压缩向量搜索
                throw new Error('Compressed vector search not yet implemented. Please ensure query embedding returns uncompressed vector.');
            } else {
                queryVector = queryEmbedding.vector; // 使用未压缩的向量
            }
            
            // 4. 执行向量搜索
            const searchResults = await this.retryHelper.executeWithRetry(
                () => this.vectorDB.search(queryVector, topK, comboKey),
                'Searching vectors in database'
            );
            
            // 5. 处理搜索结果
            const processedResults = await this._processSearchResults(searchResults);
            
            this.logger.info(`Search completed: found ${processedResults.length} results for query "${query.substring(0, 50)}..."`);
            
            return processedResults;
            
        } catch (error) {
            this.logger.error(`Error searching vectors for query "${query}":`, error);
            throw error;
        }
    }

    async flushVectors() {
        if (!this.isInitialized) {
            throw new Error('VectorManager not initialized');
        }
        
        // 如果没有vectorDB或tempVectors，直接返回
        if (!this.vectorDB || !this.tempVectors) {
            this.logger.debug('No vectors to flush');
            return 0;
        }
        
        try {
            let totalUploaded = 0;
            
            for (const [comboKey, vectors] of this.tempVectors.entries()) {
                if (vectors.length === 0) continue;
                
                // 确保目标集合存在
                await this._ensureCollectionExists(comboKey);
                
                // 转换向量格式并上传
                const vectorsForUpload = vectors.map(vector => ({
                    id: vector.id,
                    vector: vector.vector,
                    user_id: vector.userId || 'unknown',
                    device_id: vector.deviceId || 'unknown',
                    workspace_path: vector.workspacePath || 'unknown',
                    file_path: this.pathEncryption ? this.pathEncryption.encryptPath(vector.filePath) : vector.filePath,
                    code: vector.content || vector.code || '',
                    start_line: vector.startLine || vector.start_line || 0,
                    end_line: vector.endLine || vector.end_line || 0,
                    vector_model: vector.vector_model || 'CoCoSoDa-v1.0',
                    metadata: {
                        timestamp: Date.now(),
                        ...vector.metadata
                    }
                }));
                
                await this.vectorDB.upsert(comboKey, vectorsForUpload);
                totalUploaded += vectorsForUpload.length;
                
                // 清空临时存储
                this.tempVectors.set(comboKey, []);
            }
            
            this.logger.info(`Flush completed: uploaded ${totalUploaded} vectors`);
            return totalUploaded;
            
        } catch (error) {
            this.logger.error('Error flushing vectors:', error);
            return 0;
        }
    }

    async getVectorInfo() {
        try {
            if (this.tempVectors) {
                // 临时存储模式
                let totalVectors = 0;
                for (const vectors of this.tempVectors.values()) {
                    totalVectors += vectors.length;
                }
                
                return {
                    totalVectors,
                    cacheSize: totalVectors * 1024, // 估算大小
                    lastUpdate: new Date().toISOString()
                };
            } else {
                return {
                    totalVectors: 0,
                    cacheSize: 0,
                    lastUpdate: undefined
                };
            }
        } catch (error) {
            this.logger.error('Error getting vector info:', error);
            return {
                totalVectors: 0,
                cacheSize: 0,
                lastUpdate: undefined
            };
        }
    }

    // 内部辅助方法
    _generateComboKey(userId, deviceId, workspacePath) {
        if (!userId || !deviceId || !workspacePath) {
            throw new Error('Missing required parameters for combo key generation');
        }
        
        // 使用统一的collection名称生成工具
        return createCollectionName(userId, deviceId, workspacePath);
    }

    async _ensureCollectionExists(comboKey) {
        try {
            if (this.vectorDB && typeof this.vectorDB.ensureCollection === 'function') {
                await this.vectorDB.ensureCollection(comboKey);
                this.logger.debug(`Ensured collection exists for ${comboKey}`);
            } else {
                this.logger.debug(`VectorDB not available or ensureCollection not supported for ${comboKey}`);
            }
        } catch (error) {
            this.logger.warn(`Failed to ensure collection exists for ${comboKey}:`, error);
            // 不抛出错误，让上传继续进行
        }
    }

    async _processSearchResults(searchResults) {
        const processedResults = [];
        
        this.logger.debug(`_processSearchResults接收到的原始数据:`, JSON.stringify(searchResults, null, 2));
        
        // 修复：处理腾讯云实际返回的嵌套数据结构
        // 实际搜索结果在第一个元素的metadata数组中
        let actualResults = [];
        
        if (Array.isArray(searchResults) && searchResults.length > 0) {
            const firstItem = searchResults[0];
            if (firstItem && Array.isArray(firstItem.metadata)) {
                // 真正的搜索结果在metadata数组中
                actualResults = firstItem.metadata;
                this.logger.info(`从metadata数组中提取到 ${actualResults.length} 个实际搜索结果`);
            } else {
                // 如果数据结构正常，直接使用
                actualResults = searchResults;
                this.logger.info(`使用原始数据结构，包含 ${actualResults.length} 个搜索结果`);
            }
        } else {
            this.logger.warn(`搜索结果为空或格式异常`);
            return [];
        }
        
        this.logger.debug(`Processing ${actualResults.length} actual search results`);
        
        for (const result of actualResults) {
            try {
                this.logger.debug(`Processing search result:`, JSON.stringify(result, null, 2));
                
                // 修复：处理腾讯云实际返回的字段结构
                const filePath = result.file_path || result.filePath || 'unknown';
                const fileName = result.fileName || null;
                const chunkId = result.id || result.chunkId || 'unknown';
                const score = result.score || 0;
                
                // 解密文件路径
                let decryptedPath = filePath;
                try {
                    decryptedPath = this.pathEncryption.decryptPath(filePath);
                } catch (decryptError) {
                    this.logger.warn(`Failed to decrypt path ${filePath}, using original path:`, decryptError.message);
                    decryptedPath = filePath;
                }
                
                // 构造返回结果 - 兼容多种数据格式
                const processedResult = {
                    chunkId: chunkId,
                    score: score, // 保持原始分数字段
                    similarity: score, // 同时保留similarity字段供向后兼容
                    filePath: decryptedPath,
                    fileName: fileName ? this.pathEncryption.decryptPath(fileName) : null,
                    offset: result.offset || 0,
                    
                    // 尝试从多个可能的字段中获取内容
                    content: result.content || result.code || '', 
                    
                    // 尝试从多个可能的字段中获取行号
                    startLine: result.startLine || result.start_line || 0,
                    endLine: result.endLine || result.end_line || 0,
                    
                    metadata: {
                        // 尝试从多个可能的字段中获取用户信息
                        userId: result.userId || result.user_id || 'unknown',
                        deviceId: result.deviceId || result.device_id || 'unknown',
                        workspacePath: result.workspacePath || result.workspace_path || '',
                        
                        // 尝试从多个可能的字段中获取其他元数据
                        language: result.language || result.metadata?.language || '',
                        parser: result.parser || result.metadata?.parser || '',
                        type: result.type || result.metadata?.type || '',
                        vectorModel: result.vectorModel || result.vector_model || result.metadata?.vectorModel || '',
                        processingTimeMs: result.processingTimeMs || result.processing_time_ms || result.metadata?.processingTimeMs || 0,
                        createdAt: result.createdAt || result.created_at || result.metadata?.createdAt || '',
                        
                        originalScore: result.score // 保留原始分数
                    }
                };
                
                processedResults.push(processedResult);
                this.logger.debug(`Successfully processed result ${chunkId} with score ${score}`);
                
            } catch (error) {
                this.logger.error(`Error processing search result ${result?.id || 'unknown'}:`, error);
                this.logger.error(`Result data:`, JSON.stringify(result, null, 2));
                // 跳过处理失败的结果，但不中断整个处理流程
            }
        }
        
        this.logger.info(`Successfully processed ${processedResults.length}/${actualResults.length} search results`);
        return processedResults;
    }

    _startPeriodicTasks() {
        // 定期清理任务（保留基础清理功能）
        this.cleanupTimer = setInterval(async () => {
            try {
                await this._periodicCleanup();
            } catch (error) {
                this.logger.error('Error in periodic cleanup:', error);
            }
        }, 600000); // 10分钟
    }

    async shutdown() {
        if (this.isShuttingDown) {
            this.logger.warn('VectorManager is already shutting down, waiting for completion...');
            // 等待当前关闭流程完成
            const maxWait = 10000; // 最多等待10秒
            const startTime = Date.now();
            while (this.isShuttingDown && (Date.now() - startTime) < maxWait) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            return;
        }
        
        this.isShuttingDown = true;
        this.logger.info('Shutting down VectorManager...');
        
        try {
            // 1. 停止定时任务
            if (this.cleanupTimer) {
                clearInterval(this.cleanupTimer);
                this.cleanupTimer = null;
            }
            
            // 2. 给正在进行的操作更多时间完成
            this.logger.info('Waiting for ongoing operations to complete...');
            await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒
            
            // 3. 等待正在进行的上传完成
            await this._waitForUploadsToComplete();
            
            // 4. 刷新临时存储的向量（如果有的话）
            try {
                await this.flushVectors();
            } catch (error) {
                this.logger.warn('Error during final vector flush (ignoring):', error);
            }
            
            // 5. 关闭各组件
            await this._cleanup();
            
            this.isShuttingDown = false; // 重置状态
            this.logger.info('VectorManager shutdown completed');
            
        } catch (error) {
            this.logger.error('Error during shutdown:', error);
            this.isShuttingDown = false; // 即使出错也要重置状态
            throw error;
        }
    }

    _validateVectorData(data) {
        const requiredFields = ['chunkId', 'vector', 'filePath', 'userId', 'deviceId', 'workspacePath'];
        
        for (const field of requiredFields) {
            if (!data[field]) {
                throw new Error(`Missing required field: ${field}`);
            }
        }
        
        if (!Array.isArray(data.vector)) {
            throw new Error('Vector must be an array');
        }
        
        if (data.vector.length === 0) {
            throw new Error('Vector cannot be empty');
        }
        
        if (!data.vector.every(v => typeof v === 'number')) {
            throw new Error('Vector must contain only numbers');
        }
        
        if (typeof data.chunkId !== 'string' || data.chunkId.length === 0) {
            throw new Error('chunkId must be a non-empty string');
        }
    }

    _handleError(error, context) {
        const errorInfo = {
            message: error.message,
            stack: error.stack,
            context: context,
            timestamp: new Date().toISOString()
        };
        
        this.logger.error('VectorManager error:', errorInfo);
        
        // 根据错误类型决定是否需要告警
        if (this._isCriticalError(error)) {
            this._sendAlert(errorInfo);
        }
    }

    _isCriticalError(error) {
        // 判断是否为关键错误
        const criticalPatterns = [
            'database connection',
            'authentication failed',
            'out of memory',
            'permission denied'
        ];
        
        return criticalPatterns.some(pattern => 
            error.message.toLowerCase().includes(pattern)
        );
    }

    async _cleanup() {
        try {
            if (this.vectorDB) {
                // VectorDB使用close方法，不是shutdown
                if (typeof this.vectorDB.shutdown === 'function') {
                    await this.vectorDB.shutdown();
                } else if (typeof this.vectorDB.close === 'function') {
                    await this.vectorDB.close();
                }
            }
            // EmbeddingClient没有shutdown方法，跳过
            if (this.embeddingClient) {
                this.logger.info('EmbeddingClient cleanup completed (no explicit shutdown needed)');
            }
            // PathEncryption没有shutdown方法，跳过
            if (this.pathEncryption) {
                this.logger.info('PathEncryption cleanup completed (no explicit shutdown needed)');
            }
        } catch (error) {
            this.logger.error('Error during cleanup:', error);
        }
    }

    async _waitForUploadsToComplete() {
        const maxWaitTime = 30000; // 30秒
        const startTime = Date.now();
        
        while (this.uploadInProgress.size > 0) {
            if (Date.now() - startTime > maxWaitTime) {
                this.logger.warn('Timeout waiting for uploads to complete');
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    _splitVectorsIntoBatches(vectors, batchSize) {
        const batches = [];
        for (let i = 0; i < vectors.length; i += batchSize) {
            batches.push(vectors.slice(i, i + batchSize));
        }
        return batches;
    }

    async _periodicCleanup() {
        try {
            if (this.vectorDB) {
                await this.vectorDB.cleanup();
            }
        } catch (error) {
            this.logger.error('Error in periodic cleanup:', error);
        }
    }

    _registerCleanupHandlers() {
        // 优化清理处理器，避免过于激进的关闭
        let shutdownInProgress = false;
        
        const gracefulShutdown = async (signal) => {
            if (shutdownInProgress) {
                this.logger.warn(`Shutdown already in progress, ignoring ${signal}`);
                return;
            }
            shutdownInProgress = true;
            
            this.logger.info(`Received ${signal} signal, initiating graceful shutdown...`);
            try {
                await this.shutdown();
                process.exit(0);
            } catch (error) {
                this.logger.error('Error during graceful shutdown:', error);
                process.exit(1);
            }
        };

        process.on('SIGINT', async () => {
            await gracefulShutdown('SIGINT');
        });

        process.on('SIGTERM', async () => {
            await gracefulShutdown('SIGTERM');
        });

        // 对于未捕获异常，给更多容错性
        process.on('uncaughtException', async (error) => {
            this.logger.error('Uncaught exception:', error);
            
            // 检查是否是关键错误
            if (this._isCriticalError(error)) {
                this.logger.error('Critical error detected, shutting down immediately');
                if (!shutdownInProgress) {
                    shutdownInProgress = true;
                    try {
                        await this.shutdown();
                    } catch (shutdownError) {
                        this.logger.error('Error during emergency shutdown:', shutdownError);
                    }
                    process.exit(1);
                }
            } else {
                // 非关键错误，记录但不关闭
                this.logger.warn('Non-critical uncaught exception, continuing operation');
            }
        });

        // 对于未处理的Promise拒绝，也给更多容错性
        process.on('unhandledRejection', async (reason, promise) => {
            this.logger.error('Unhandled rejection:', reason);
            
            // 只有在确实是关键错误时才关闭
            if (reason && typeof reason === 'object' && this._isCriticalError(reason)) {
                this.logger.error('Critical unhandled rejection, shutting down');
                if (!shutdownInProgress) {
                    shutdownInProgress = true;
                    try {
                        await this.shutdown();
                    } catch (shutdownError) {
                        this.logger.error('Error during emergency shutdown:', shutdownError);
                    }
                    process.exit(1);
                }
            } else {
                // 非关键错误，记录但不关闭
                this.logger.warn('Non-critical unhandled rejection, continuing operation');
            }
        });
    }
}

module.exports = VectorManager;