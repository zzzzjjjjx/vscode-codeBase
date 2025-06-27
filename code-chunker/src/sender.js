const axios = require('axios');
const ProgressTracker = require('./progressTracker');
const VectorManager = require('./vectorManager');
const EmbeddingClient = require('./vectorManager/embedding/embeddingClient');
const config = require('./config');

class Sender {
    constructor(senderConfig, progressTracker, externalVectorManager = null, performanceAnalyzer = null) {
        // 支持传入配置对象或使用全局配置
        this.config = senderConfig || config.getAll();
        this.progressTracker = progressTracker;
        this.performanceAnalyzer = performanceAnalyzer;
        
        // 确保必要的API锁定配置存在
        this.config.userId = this.config.userId || "user123";
        this.config.deviceId = this.config.deviceId || "device123";
        this.config.workspacePath = this.config.workspacePath || process.cwd();
        
        // 初始化嵌入客户端
        this.embeddingClient = new EmbeddingClient({
            apiEndpoint: this.config.apiEndpoint,
            token: this.config.token,
            timeout: this.config.timeout,
            batchSize: this.config.batchSize,
            maxRetries: this.config.maxRetries,
            retryDelay: this.config.retryDelay
        });
        
        // 传递性能分析器给EmbeddingClient
        if (this.performanceAnalyzer) {
            this.embeddingClient.performanceAnalyzer = this.performanceAnalyzer;
        }
        
        this.stats = {
            totalChunks: 0,
            successfulChunks: 0,
            failedChunks: 0,
            totalEmbeddings: 0,
            processingTime: 0
        };
        
        this.batchSize = this.config.batchSize || 10;
        this.retryAttempts = this.config.retryAttempts || 3;
        this.retryDelay = this.config.retryDelay || 1000;
        this.asyncTimeout = this.config.asyncTimeout || 60000; // 异步处理超时时间
        this.pendingAsyncResults = new Map(); // 跟踪待处理的异步结果
        
        // API锁定机制管理
        this.lockedTasks = new Map(); // 跟踪被锁定的任务: key -> timestamp
        this.lockDuration = 30000; // 30秒锁定时间
        
        // 启动定期清理过期锁定
        this.lockCleanupInterval = setInterval(() => {
            this._cleanupExpiredLocks();
        }, 10000); // 每10秒清理一次
        
        // 使用外部传入的VectorManager，避免重复初始化
        if (externalVectorManager) {
            this.vectorManager = externalVectorManager;
        } else if (this.config.vectorManager?.enabled) {
            this.vectorManager = new VectorManager(this.config.vectorManager);
            this.vectorManager.initialize().catch(error => {
                console.error('Failed to initialize VectorManager:', error);
            });
        }
    }

    async _sendBatch(batch) {
        try {
            // 为每个chunk预设置状态为processing
            if (this.progressTracker) {
                for (const chunk of batch) {
                    this.progressTracker.updateChunkStatus(chunk.id, 'processing', {
                        batchSize: batch.length,
                        startTime: new Date().toISOString()
                    });
                }
            }

            // 准备代码块数据 - 不过滤空内容，让问题暴露出来
            const codeChunks = batch.map(chunk => ({
                chunkId: chunk.id,
                filePath: chunk.filePath,
                language: chunk.language || 'unknown',
                startLine: chunk.startLine,
                endLine: chunk.endLine,
                content: chunk.content,
                parser: chunk.parser || 'tree_sitter'
            }));

            // 记录空内容代码块但不过滤，让问题暴露
            codeChunks.forEach((chunk, index) => {
                if (!chunk.content || chunk.content.trim().length === 0) {
                    console.warn(`🚨 发现空内容代码块 ${index + 1}: ${chunk.chunkId} (行号: ${chunk.startLine}-${chunk.endLine})`);
                    console.warn(`   文件路径: ${chunk.filePath}`);
                    console.warn(`   内容长度: ${chunk.content ? chunk.content.length : 'null/undefined'}`);
                }
            });

           

            // 使用新的EmbeddingClient发送请求
            const embeddingOptions = {
                uniqueId: `${this.config.userId}-${this.config.deviceId}-${Date.now()}`,
                parserVersion: '1.0.0',
                processingMode: 'sync', // 优先使用同步模式
                autoPolling: true,
                onProgress: (progress) => {
                    // 处理进度更新
                }
            };
            
            // 记录网络请求开始时间
            const networkStartTime = Date.now();
            const result = await this.embeddingClient.embedCodeBlocks(codeChunks, embeddingOptions);
            const networkEndTime = Date.now();
            
            // 记录网络请求性能
            if (this.performanceAnalyzer) {
                this.performanceAnalyzer.recordNetworkRequest('embedding', networkEndTime - networkStartTime, true);
                this.performanceAnalyzer.updatePeakMemory();
            }
            
            // 处理结果并更新状态
            const processedResults = await this._processEmbeddingResults(result, batch);
            await this._saveDataToLocal(processedResults, batch);
            return {
                status: 'completed',
                results: processedResults,
                batchId: this._generateBatchId(batch),
                processingMode: result.processingMode,
                totalProcessingTimeMs: result.totalProcessingTimeMs
            };

        } catch (error) {
            console.error('❌ 批次发送失败:', error.message);
            console.error('❌ 错误详情:', {
                name: error.name,
                message: error.message,
                stack: error.stack,
                embeddingError: error.embeddingError
            });

            // 更新所有chunk状态为失败
            if (this.progressTracker) {
                for (const chunk of batch) {
                    this.progressTracker.updateChunkStatus(chunk.id, 'failed', {
                        error: error.message,
                        errorType: error.embeddingError?.type || 'ProcessingError',
                        timestamp: new Date().toISOString()
                    });
                }
            }

            throw error;
        }
    }

    async _saveDataToLocal(codeChunks, originalBatch) {
        try {
            // 参数验证
            if (!codeChunks || !Array.isArray(codeChunks)) {
                console.warn('Invalid codeChunks parameter for _saveDataToLocal:', codeChunks);
                codeChunks = []; // 使用空数组作为默认值
            }
            
            if (!originalBatch || !Array.isArray(originalBatch)) {
                console.warn('Invalid originalBatch parameter for _saveDataToLocal:', originalBatch);
                originalBatch = []; // 使用空数组作为默认值
            }
            
            const fs = require('fs').promises;
            const path = require('path');
            
            // 创建本地数据目录
            const dataDir = path.join(process.cwd(), 'local_data', 'send_logs');
            await fs.mkdir(dataDir, { recursive: true });
            
            // 生成时间戳和批次ID
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const batchId = this._generateBatchId(originalBatch);
            
            // 准备保存的数据
            const saveData = {
                batchInfo: {
                    batchId: batchId,
                    timestamp: new Date().toISOString(),
                    chunkCount: codeChunks.length,
                    userId: this.config.userId || 'unknown',
                    deviceId: this.config.deviceId || 'unknown'
                },
                embeddingOptions: {
                    uniqueId: `${this.config.userId || 'unknown'}-${this.config.deviceId || 'unknown'}-${Date.now()}`,
                    parserVersion: '1.0.0',
                    processingMode: 'sync'
                },
                codeChunks: codeChunks,
                originalChunkData: originalBatch.map(chunk => ({
                    id: chunk?.id || 'unknown',
                    filePath: chunk?.filePath || 'unknown',
                    fileName: chunk?.fileName || null,
                    type: chunk?.type || 'unknown',
                    contentPreview: chunk?.content ? chunk.content.substring(0, 200) + '...' : 'No content'
                }))
            };
            
            // 保存完整数据到JSON文件
            const fileName = `batch_${batchId}_${timestamp}.json`;
            const filePath = path.join(dataDir, fileName);
            
            await fs.writeFile(filePath, JSON.stringify(saveData, null, 2), 'utf8');
            
            // 同时保存一份简化的摘要信息
            const summaryData = {
                batchId: batchId,
                timestamp: new Date().toISOString(),
                chunkCount: codeChunks.length,
                files: [...new Set(codeChunks.map(chunk => chunk?.filePath || 'unknown').filter(path => path !== 'unknown'))],
                languages: [...new Set(codeChunks.map(chunk => chunk?.language || 'unknown').filter(lang => lang !== 'unknown'))],
                totalLines: codeChunks.reduce((sum, chunk) => {
                    const startLine = chunk?.startLine || 0;
                    const endLine = chunk?.endLine || 0;
                    return sum + (endLine > startLine ? endLine - startLine + 1 : 0);
                }, 0)
            };
            
            const summaryFileName = `summary_${batchId}_${timestamp}.json`;
            const summaryFilePath = path.join(dataDir, summaryFileName);
            await fs.writeFile(summaryFilePath, JSON.stringify(summaryData, null, 2), 'utf8');
            
        } catch (error) {
            console.warn('保存本地数据失败:', error.message);
            console.warn('错误详情:', error.stack);
            // 不抛出错误，允许继续处理
        }
    }

    async _processEmbeddingResults(embeddingResult, originalBatch) {
        // 参数验证
        if (!embeddingResult || !embeddingResult.results || !Array.isArray(embeddingResult.results)) {
            console.warn('Invalid embedding result format:', embeddingResult);
            return []; // 返回空数组避免后续错误
        }
        
        const processedResults = []; // 收集处理结果
        
        // 处理每个嵌入结果
        for (const result of embeddingResult.results) {
            try {
                
                if (result.status === 'success' && (result.vector || result.compressedVector)) {
                    // 存储向量到VectorManager (支持压缩向量)
                    const stored = await this._storeEmbeddingVector(result, originalBatch);
                    
                    // 构建处理结果，支持压缩向量格式
                    const processedResult = {
                        chunkId: result.chunkId,
                        status: 'success',
                        vector: result.vector,
                        compressedVector: result.compressedVector,
                        isCompressed: result.isCompressed || false,
                        vectorDimension: result.vectorDimension || (result.vector ? result.vector.length : 0),
                        stored: stored,
                        filePath: result.filePath || 'unknown',
                        startLine: result.startLine || 0,
                        endLine: result.endLine || 0,
                        language: result.language || 'unknown',
                        processingMode: 'embedding_success',
                        modelVersion: result.modelVersion
                    };
                    
                    processedResults.push(processedResult);
                    
                    if (stored) {
                        // 更新进度：成功
                        if (this.progressTracker) {
                            this.progressTracker.updateChunkStatus(result.chunkId, 'completed', {
                                vectorStored: true,
                                vectorDimension: result.vectorDimension || (result.vector ? result.vector.length : 0),
                                isCompressed: result.isCompressed || false,
                                processingMode: 'embedding_success'
                            });
                        }
                    } else {
                        // 存储失败（可能因为VectorManager关闭），但不算作错误
                        console.warn(`Vector storage failed for chunk ${result.chunkId}, marking as completed anyway`);
                        if (this.progressTracker) {
                            this.progressTracker.updateChunkStatus(result.chunkId, 'completed', {
                                vectorStored: false,
                                vectorDimension: result.vectorDimension || (result.vector ? result.vector.length : 0),
                                isCompressed: result.isCompressed || false,
                                processingMode: 'embedding_success_storage_skipped',
                                warning: 'Vector storage skipped (VectorManager unavailable)'
                            });
                        }
                    }
                } else {
                    // 嵌入失败
                    console.warn(`嵌入生成失败: ${result.chunkId} - ${result.error || 'Unknown error'}`);
                    
                    // 构建失败结果
                    const failedResult = {
                        chunkId: result.chunkId,
                        status: 'failed',
                        error: result.error || 'Embedding generation failed',
                        filePath: result.filePath || 'unknown',
                        startLine: result.startLine || 0,
                        endLine: result.endLine || 0,
                        language: result.language || 'unknown',
                        processingMode: 'embedding_failure'
                    };
                    
                    processedResults.push(failedResult);
                    
                    if (this.progressTracker) {
                        this.progressTracker.updateChunkStatus(result.chunkId, 'failed', {
                            error: result.error || 'Embedding generation failed',
                            processingMode: 'embedding_failure'
                        });
                    }
                }
            } catch (error) {
                console.error(`处理代码块 ${result.status} ${result.chunkId} ${result.startLine || 'unknown'}-${result.endLine || 'unknown'} ${result.chunkId.substring(0, 8)} ${result.vectorDimension || 0} 结果时出错:`, error);
                
                // 构建错误结果
                const errorResult = {
                    chunkId: result.chunkId || 'unknown',
                    status: 'error',
                    error: error.message,
                    filePath: 'unknown',
                    startLine: 0,
                    endLine: 0,
                    language: 'unknown',
                    processingMode: 'embedding_processing_error'
                };
                
                processedResults.push(errorResult);
                
                // 更新进度：处理错误
                if (this.progressTracker) {
                    this.progressTracker.updateChunkStatus(result.chunkId, 'failed', {
                        error: error.message,
                        processingMode: 'embedding_processing_error'
                    });
                }
                
                // 不重新抛出错误，继续处理其他结果
            }
        }
        

        return processedResults; // 返回处理结果数组
    }

    async _setupAsyncResultHandling(responseData, originalBatch) {
        const requestId = responseData.requestId;
        const estimatedTime = responseData.estimatedProcessingTimeMs || 30000;
        
        if (!requestId) {
            throw new Error('Missing requestId in async response');
        }

        // 为批次中的每个chunk设置异步等待状态
        if (this.progressTracker) {
            for (const chunk of originalBatch) {
                this.progressTracker.updateChunkStatus(chunk.id, 'async_pending', {
                    requestId: requestId,
                    estimatedTime: estimatedTime,
                    submittedAt: new Date().toISOString()
                });
            }
        }

        // 存储异步请求信息
        this.pendingAsyncResults.set(requestId, {
            batch: originalBatch,
            submittedAt: Date.now(),
            estimatedTime: estimatedTime,
            callbackUrl: responseData.callbackUrl
        });

        // 启动轮询或设置回调
        if (responseData.callbackUrl) {
            // 如果有回调URL，可以设置webhook处理
    
        } else {
            // 启动轮询检查结果
            this._startPollingForResult(requestId, estimatedTime);
        }

        return {
            requestId: requestId,
            status: 'pending',
            estimatedTime: estimatedTime,
            chunkCount: originalBatch.length
        };
    }

    async _startPollingForResult(requestId, estimatedTime) {
        // 等待估计时间的80%后开始轮询
        const initialDelay = estimatedTime * 0.8;
        setTimeout(async () => {
            await this._pollAsyncResult(requestId);
        }, initialDelay);
    }

    async _pollAsyncResult(requestId, attempt = 1) {
        const maxPollingAttempts = 10;
        const pollingInterval = 5000; // 5秒间隔

        try {
            const response = await axios.get(`${this.config.endpoint}/results/${requestId}`, {
                headers: {
                    'Authorization': `Bearer ${this.config.token}`
                },
                timeout: 15000
            });

            if (response.status === 200 && response.data.status === 'completed') {
                // 异步处理完成
                const pendingInfo = this.pendingAsyncResults.get(requestId);
                if (pendingInfo) {
                    await this._processSyncEmbeddingResults(response.data, pendingInfo.batch);
                    this.pendingAsyncResults.delete(requestId);
        
                }
            } else if (response.status === 200 && response.data.status === 'processing') {
                // 仍在处理中，继续轮询
                if (attempt < maxPollingAttempts) {
                    setTimeout(() => {
                        this._pollAsyncResult(requestId, attempt + 1);
                    }, pollingInterval);
                } else {
                    console.error(`Polling timeout for requestId: ${requestId}`);
                    this._handleAsyncTimeout(requestId);
                }
            } else {
                console.error(`Async processing failed for requestId: ${requestId}`, response.data);
                this._handleAsyncFailure(requestId, response.data.error);
            }
        } catch (error) {
            console.error(`Error polling async result for ${requestId}:`, error);
            if (attempt < maxPollingAttempts) {
                setTimeout(() => {
                    this._pollAsyncResult(requestId, attempt + 1);
                }, pollingInterval);
            } else {
                this._handleAsyncTimeout(requestId);
            }
        }
    }

    async _storeEmbeddingVector(result, originalBatch) {
        const maxRetries = 2; // 最多重试2次
        let lastError = null;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // 获取对应的原始chunk信息
                const originalChunk = originalBatch.find(chunk => chunk.id === result.chunkId);
                if (!originalChunk) {
                    console.warn(`Original chunk not found for ${result.chunkId}`);
                    return false;
                }

                // 生成锁定键：基于snippet_id + user_id + device_id
                const lockKey = `${result.chunkId}_${this.config.userId}_${this.config.deviceId}`;
                
                // 检查是否在锁定期内
                if (this.lockedTasks.has(lockKey)) {
                    const lockTime = this.lockedTasks.get(lockKey);
                    const timeElapsed = Date.now() - lockTime;
                    
                    if (timeElapsed < this.lockDuration) {
                        const waitTime = this.lockDuration - timeElapsed;
        
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                        
                        // 清除锁定记录
                        this.lockedTasks.delete(lockKey);
                    } else {
                        // 锁定已过期，清除记录
                        this.lockedTasks.delete(lockKey);
                    }
                }

                // 直接使用EmbeddingClient的upsert API接口
                try {
                    // 准备文档数据，支持压缩向量格式
                    const documents = [{
                        snippet_id: result.chunkId,
                        user_id: this.config.userId,
                        device_id: this.config.deviceId,
                        workspace_path: this.config.workspacePath,
                        file_path: originalChunk.filePath || 'unknown',
                        start_line: originalChunk.startLine || 1,
                        end_line: originalChunk.endLine || 1,
                        code: originalChunk.content || '',
                        vector: result.isCompressed ? null : result.vector,
                        compressedVector: result.isCompressed ? result.compressedVector : null,
                        isCompressed: result.isCompressed || false,
                        vector_model: result.modelVersion || "CoCoSoDa-v1.0",
                        compressionFormat: 'base64',
                        originalDimensions: 768,
                    }];

                    // 生成请求ID
                    const requestId = `req-store-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                    
                    // 准备upsert请求数据
                    const upsertData = {
                        requestId: requestId,
                        database: this.config.database || 'codebase_db',
                        collection: this.config.collection || 'code_vectors1',  // 使用配置中的collection名称，默认为code_vectors1
                        documents: documents,
                        buildIndex: true
                    };

                    // ===== 详细请求日志 =====
                    console.log(`\n🔍 ===== UPSERT API 请求详情 =====`);
                    console.log(`📡 URL: POST /api/v1/codebase/upsert`);
                    console.log(`🆔 Request ID: ${requestId}`);
                    console.log(`📦 Chunk ID: ${result.chunkId}`);
                    console.log(`📊 请求体大小: ${JSON.stringify(upsertData).length} 字符`);
                    console.log(`📋 完整请求体:`, JSON.stringify(upsertData, null, 2));
                    
                    // 分析向量数据
                    const doc = documents[0];
                    if (doc.isCompressed) {
                        console.log(`🗜️ 压缩向量信息:`);
                        console.log(`   - 压缩格式: ${doc.compressionFormat}`);
                        console.log(`   - 原始维度: ${doc.originalDimensions}`);
                        console.log(`   - 压缩数据长度: ${doc.compressedVector ? doc.compressedVector.length : 'null'}`);
                    } else {
                        console.log(`🎯 标准向量信息:`);
                        console.log(`   - 向量维度: ${doc.vector ? doc.vector.length : 'null'}`);
                        console.log(`   - 向量类型: ${Array.isArray(doc.vector) ? 'Array' : typeof doc.vector}`);
                    }
                    
                    console.log(`📄 文档信息:`);
                    console.log(`   - 文件路径: ${doc.file_path}`);
                    console.log(`   - 行号范围: ${doc.start_line}-${doc.end_line}`);
                    console.log(`   - 代码长度: ${doc.code.length} 字符`);
                    console.log(`   - 向量模型: ${doc.vector_model}`);
                    console.log(`🔍 ================================\n`);
    
                    // 直接调用API接口
                    const response = await this.embeddingClient._makeRequest('POST', '/api/v1/codebase/upsert', upsertData);
                    
                    // ===== 详细响应日志 =====
                    console.log(`\n📥 ===== UPSERT API 响应详情 =====`);
                    console.log(`🆔 Request ID: ${requestId}`);
                    console.log(`📦 Chunk ID: ${result.chunkId}`);
                    console.log(`📊 响应体大小: ${JSON.stringify(response).length} 字符`);
                    console.log(`📋 完整响应体:`, JSON.stringify(response, null, 2));
                    
                    // 分析响应状态
                    const status = response.status || response['status:'];
                    const hasStatusField = 'status' in response;
                    const hasStatusColonField = 'status:' in response;
                    
                    console.log(`📊 状态字段分析:`);
                    console.log(`   - 'status' 字段存在: ${hasStatusField}`);
                    console.log(`   - 'status:' 字段存在: ${hasStatusColonField}`);
                    console.log(`   - 最终状态值: "${status}"`);
                    console.log(`   - 状态类型: ${typeof status}`);
                    
                    if (response.error) {
                        console.log(`❌ 错误信息: ${response.error}`);
                    }
                    
                    console.log(`📥 ================================\n`);
                    
                    // 兼容后端返回的字段名错误：支持 "status:" 和 "status"
                    
                    if (status === 'success') {
                        console.log(`✅ API存储成功 - Chunk: ${result.chunkId}`);
                        // 成功时清除可能存在的锁定记录
                        this.lockedTasks.delete(lockKey);
                        return true;
                    } else {
                        const errorMsg = response.error || 'Unknown API error';
                        // 增强错误日志，显示完整的响应信息
                        console.warn(`❌ API storage failed for chunk ${result.chunkId} (attempt ${attempt}/${maxRetries}): ${errorMsg}`);
                        console.warn(`📋 完整错误响应:`, JSON.stringify(response, null, 2));
                        
                        // 如果是锁定相关的错误，记录锁定时间并继续重试
                        if (errorMsg.includes('任务正在执行') || 
                            errorMsg.includes('锁定') ||
                            errorMsg.includes('locked') ||
                            errorMsg.includes('busy')) {
                            
                            this.lockedTasks.set(lockKey, Date.now());
                            lastError = new Error(`API locked: ${errorMsg}`);
                            
                            // 如果不是最后一次尝试，继续重试
                            if (attempt < maxRetries) {
                                continue;
                            }
                        } else {
                            // 非锁定错误，不重试
                            lastError = new Error(`API error: ${errorMsg}`);
                            break;
                        }
                    }
                    
                } catch (apiError) {
                    // ===== 详细异常日志 =====
                    console.error(`\n💥 ===== UPSERT API 异常详情 =====`);
                    console.error(`🆔 Request ID: ${requestId}`);
                    console.error(`📦 Chunk ID: ${result.chunkId}`);
                    console.error(`🔢 尝试次数: ${attempt}/${maxRetries}`);
                    console.error(`❌ 异常类型: ${apiError.constructor.name}`);
                    console.error(`📝 异常消息: ${apiError.message}`);
                    console.error(`📚 异常堆栈:`, apiError.stack);
                    
                    // 如果有响应相关的信息
                    if (apiError.response) {
                        console.error(`📡 HTTP状态码: ${apiError.response.status}`);
                        console.error(`📋 响应头:`, apiError.response.headers);
                        console.error(`📄 响应体:`, apiError.response.data);
                    }
                    
                    // 如果有请求相关的信息
                    if (apiError.request) {
                        console.error(`📤 请求配置:`, {
                            method: apiError.request.method,
                            url: apiError.request.url,
                            headers: apiError.request.headers,
                            timeout: apiError.request.timeout
                        });
                    }
                    
                    console.error(`💥 ================================\n`);
                    
                    console.error(`❌ API storage failed for chunk ${result.chunkId} (attempt ${attempt}/${maxRetries}): ${apiError.message}`);
                    lastError = apiError;
                    
                    // 网络错误也可能导致锁定，记录锁定时间
                    if (apiError.message.includes('timeout') || 
                        apiError.message.includes('ECONNRESET') ||
                        apiError.message.includes('ETIMEDOUT')) {
                        
                        this.lockedTasks.set(lockKey, Date.now());
                        
                        // 网络错误时继续重试
                        if (attempt < maxRetries) {
                            continue;
                        }
                    } else {
                        // 非网络错误，不重试
                        break;
                    }
                }

            } catch (error) {
                console.error(`Failed to store vector for chunk ${result.chunkId} (attempt ${attempt}/${maxRetries}):`, error);
                lastError = error;
                break; // 致命错误，不重试
            }
        }
        
        // 所有重试都失败了
        console.error(`Failed to store vector for chunk ${result.chunkId} after ${maxRetries} attempts. Last error:`, lastError?.message);
        return false;
    }

    async _handleBatchAsPartialFailure(batch, reason) {
        const results = [];
        for (const chunk of batch) {
            if (this.progressTracker) {
                this.progressTracker.updateChunkStatus(chunk.id, 'failed', {
                    error: reason,
                    processingMode: 'batch_failure'
                });
            }
            results.push({
                chunkId: chunk.id,
                status: 'failed',
                error: reason
            });
        }
        return results;
    }

    async _handleAsyncTimeout(requestId) {
        const pendingInfo = this.pendingAsyncResults.get(requestId);
        if (pendingInfo && this.progressTracker) {
            for (const chunk of pendingInfo.batch) {
                this.progressTracker.updateChunkStatus(chunk.id, 'timeout', {
                    requestId: requestId,
                    message: 'Async processing timeout'
                });
            }
        }
        this.pendingAsyncResults.delete(requestId);
    }

    async _handleAsyncFailure(requestId, error) {
        const pendingInfo = this.pendingAsyncResults.get(requestId);
        if (pendingInfo && this.progressTracker) {
            for (const chunk of pendingInfo.batch) {
                this.progressTracker.updateChunkStatus(chunk.id, 'failed', {
                    requestId: requestId,
                    error: error,
                    processingMode: 'async_failure'
                });
            }
        }
        this.pendingAsyncResults.delete(requestId);
    }

    _generateBatchId(batch) {
        const crypto = require('crypto');
        
        // 参数验证
        if (!batch || !Array.isArray(batch) || batch.length === 0) {
            console.warn('Invalid batch parameter for _generateBatchId:', batch);
            // 为空批次生成默认ID
            return crypto.createHash('md5').update(`empty_batch_${Date.now()}`).digest('hex').substring(0, 8);
        }
        
        try {
            const chunkIds = batch.map(chunk => chunk?.id || 'unknown').sort().join('|');
            return crypto.createHash('md5').update(chunkIds).digest('hex').substring(0, 8);
        } catch (error) {
            console.warn('Error generating batch ID:', error.message);
            // 生成后备ID
            return crypto.createHash('md5').update(`fallback_batch_${Date.now()}`).digest('hex').substring(0, 8);
        }
    }

    _generateRequestId() {
        const crypto = require('crypto');
        return crypto.randomUUID();
    }

    _calculateVectorNorm(vector) {
        return Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    }

    _extractFileName(filePath) {
        const path = require('path');
        return path.basename(filePath);
    }

    async sendChunks(chunks, merkleRootHash) {
        // 注意：merkleRootHash参数已不再使用，保留仅为向后兼容
        
        // 开始计时：Sender初始化和准备
        if (this.performanceAnalyzer) {
            this.performanceAnalyzer.startModuleTimer('sender', 'initTime');
            this.performanceAnalyzer.recordMemoryUsage('sender_start');
        }
        
        // 检查是否为测试模式，跳过网络请求
        if (process.env.NODE_ENV === 'development' && this.config.testMode !== false) {
            
            // 更新进度跟踪器状态
            if (this.progressTracker) {
                chunks.forEach(chunk => {
                    this.progressTracker.updateChunkStatus(chunk.id, 'completed', {
                        testMode: true,
                        skippedNetworkRequest: true,
                        timestamp: new Date().toISOString()
                    });
                });
            }
            
            return {
                totalBatches: Math.ceil(chunks.length / this.batchSize),
                successful: Math.ceil(chunks.length / this.batchSize),
                failed: 0,
                asyncPending: 0,
                completedImmediately: Math.ceil(chunks.length / this.batchSize),
                testMode: true,
                results: []
            };
        }
        
        // 开始计时：数据准备
        if (this.performanceAnalyzer) {
            this.performanceAnalyzer.endModuleTimer('sender', 'initTime');
            this.performanceAnalyzer.startModuleTimer('sender', 'prepareTime');
        }
        
        const batches = [];
        for (let i = 0; i < chunks.length; i += this.batchSize) {
            batches.push(chunks.slice(i, i + this.batchSize));
        }
        
        // 结束数据准备，开始发送
        if (this.performanceAnalyzer) {
            this.performanceAnalyzer.endModuleTimer('sender', 'prepareTime');
            this.performanceAnalyzer.startModuleTimer('sender', 'sendTime');
        }

        // 并发发送所有批次，但控制并发数
        const maxConcurrentBatches = this.config.maxConcurrentBatches || 3;
        const results = [];
        
        for (let i = 0; i < batches.length; i += maxConcurrentBatches) {
            const currentBatches = batches.slice(i, i + maxConcurrentBatches);
            const batchPromises = currentBatches.map(batch => this._sendBatch(batch));
            const batchResults = await Promise.allSettled(batchPromises);
            results.push(...batchResults);
        }

        // 统计结果
        const successfulBatches = results.filter(r => r.status === 'fulfilled');
        const failedBatches = results.filter(r => r.status === 'rejected');
        const asyncBatches = successfulBatches.filter(r => r.value.status === 'accepted');
        const completedBatches = successfulBatches.filter(r => r.value.status === 'completed');



        if (failedBatches.length > 0) {
            console.warn(`${failedBatches.length} batches failed to send`);
            failedBatches.forEach((failure, index) => {
                console.error(`🔥 Batch ${index} failure:`, failure.reason?.message || failure.reason);
                console.error(`🔥 Batch ${index} detailed error:`, {
                    name: failure.reason?.name,
                    message: failure.reason?.message,
                    stack: failure.reason?.stack,
                    embeddingError: failure.reason?.embeddingError
                });
            });
        }

        // 结束发送计时，开始批处理计时
        if (this.performanceAnalyzer) {
            this.performanceAnalyzer.endModuleTimer('sender', 'sendTime');
            this.performanceAnalyzer.startModuleTimer('sender', 'batchTime');
        }

        // 记录embedding生成完成统计
        if (this.performanceAnalyzer) {
            const totalRequests = batches.length;
            const successRequests = successfulBatches.length;
            const failedRequests = failedBatches.length;
            this.performanceAnalyzer.endEmbeddingGeneration(totalRequests, successRequests, failedRequests);
        }

        // 数据已直接发送到向量数据库，无需额外持久化
        
        // 结束批处理计时
        if (this.performanceAnalyzer) {
            this.performanceAnalyzer.endModuleTimer('sender', 'batchTime');
            this.performanceAnalyzer.recordMemoryUsage('sender_end');
        }

        return {
            totalBatches: batches.length,
            successful: successfulBatches.length,
            failed: failedBatches.length,
            asyncPending: asyncBatches.length,
            completedImmediately: completedBatches.length,
            pendingAsyncRequests: Array.from(this.pendingAsyncResults.keys()),
            results: results
        };
    }

    async getPendingAsyncResults() {
        return Array.from(this.pendingAsyncResults.entries()).map(([requestId, info]) => ({
            requestId,
            chunkCount: info.batch.length,
            submittedAt: new Date(info.submittedAt).toISOString(),
            estimatedTime: info.estimatedTime,
            callbackUrl: info.callbackUrl
        }));
    }

    async shutdown() {
        // 等待所有异步结果完成或超时
        if (this.pendingAsyncResults.size > 0) {
            const timeout = this.asyncTimeout;
            const startTime = Date.now();
            
            while (this.pendingAsyncResults.size > 0 && (Date.now() - startTime) < timeout) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            if (this.pendingAsyncResults.size > 0) {
                console.warn(`Shutdown with ${this.pendingAsyncResults.size} pending async results remaining`);
            }
        }

        // 停止锁定清理定时器
        if (this.lockCleanupInterval) {
            clearInterval(this.lockCleanupInterval);
            this.lockCleanupInterval = null;
        }

        if (this.vectorManager) {
            await this.vectorManager.shutdown();
        }
    }

    /**
     * 清理过期的锁定记录
     */
    _cleanupExpiredLocks() {
        const now = Date.now();
        const expiredKeys = [];
        
        for (const [key, timestamp] of this.lockedTasks) {
            if (now - timestamp >= this.lockDuration) {
                expiredKeys.push(key);
            }
        }
        
        expiredKeys.forEach(key => {
            this.lockedTasks.delete(key);
        });
        

    }

    /**
     * 获取当前锁定状态
     */
    getLockStatus() {
        const now = Date.now();
        const activeLocks = [];
        
        for (const [key, timestamp] of this.lockedTasks) {
            const timeElapsed = now - timestamp;
            if (timeElapsed < this.lockDuration) {
                const remainingTime = this.lockDuration - timeElapsed;
                activeLocks.push({
                    key: key,
                    remainingSeconds: Math.round(remainingTime / 1000)
                });
            }
        }
        
        return {
            totalLocks: activeLocks.length,
            locks: activeLocks
        };
    }

    /**
     * 手动清除特定任务的锁定
     */
    clearLock(chunkId) {
        const lockKey = `${chunkId}_${this.config.userId}_${this.config.deviceId}`;
        const wasLocked = this.lockedTasks.has(lockKey);
        this.lockedTasks.delete(lockKey);
        

        
        return wasLocked;
    }
}

module.exports = Sender;