const fs = require('fs-extra');
const path = require('path');
const { Worker } = require('worker_threads');
const ParserSelector = require('./parserSelector');

class Dispatcher {
    constructor(config) {
        this.config = config;
        // 更激进地降低最大Worker数量，默认禁用Worker
        this.maxWorkers = Math.min(config.maxWorkers || 1, 1); // 最多1个Worker
        this.workspacePath = config.workspacePath;
        this.progressTracker = config.progressTracker;
        
        // 默认禁用Worker模式，优先使用同步处理避免内存问题
        this.useWorkers = false; // 改为默认禁用
        
        // 添加Worker统计
        this.activeWorkers = 0;
        this.maxActiveWorkers = 0;
        this.workerFailures = 0;
        
        // 添加内存监控
        this.memoryThreshold = 0.7; // 70%内存使用率时停止Worker
        this.processedFiles = 0;
        this.maxFilesPerBatch = 100; // 每批最多处理100个文件
    }

    log(message) {
        console.log(`[Dispatcher] ${message}`);
    }

    error(message) {
        console.error(`[Dispatcher] ${message}`);
    }

    warn(message) {
        console.warn(`[Dispatcher] ${message}`);
    }

    async processFiles(fileList, parserSelector) {
        this.log('fileList:', fileList);
        const chunks = [];

        for (const file of fileList) {
            if (!file || !file.path) {
                this.warn('Invalid file entry:', file);
                continue;
            }
            try {
                const fullPath = path.join(this.workspacePath, file.path);
                const content = await fs.readFile(fullPath, 'utf8');
                const parser = parserSelector.selectParser(file.path);
                // 修复：使用正确的参数顺序 parse(filePath, content)
                const fileChunks = await parser.parse(fullPath, content);
                
                // 为同步方法手动设置chunk属性（因为没有worker处理）
                fileChunks.forEach((chunk, index) => {
                    // 生成唯一的chunk ID，包含路径哈希确保唯一性
                    const crypto = require('crypto');
                    const pathHash = crypto.createHash('md5').update(file.path).digest('hex').substring(0, 8);
                    const timestamp = Date.now().toString(36);
                    chunk.id = `${path.basename(file.path, path.extname(file.path))}_${pathHash}_${chunk.startLine || index}-${chunk.endLine || index}_${timestamp}_${index}`;
                    chunk.filePath = file.path;
                    
                    // 注册 chunk 到 ProgressTracker
                    if (this.progressTracker) {
                        this.progressTracker.registerChunk(chunk.id, {
                            filePath: chunk.filePath,
                            startLine: chunk.startLine,
                            endLine: chunk.endLine,
                            content: chunk.content,
                            parser: chunk.parser,
                            type: chunk.type,
                            language: chunk.language
                        });
                    }
                });
                
                chunks.push(...fileChunks);
            } catch (error) {
                this.error(`Error processing file ${file && file.path}:`, error);
            }
        }

        return chunks;
    }

    async processFilesConcurrently(fileList, parserSelector) {
        const chunks = [];
        const validFiles = fileList.filter(file => file && file.path);
        
        if (validFiles.length === 0) {
            this.warn('No valid files to process');
            return chunks;
        }

        // 检查内存使用情况
        const memUsage = this.checkMemoryUsage();
        this.log(`当前内存使用率: ${(memUsage * 100).toFixed(2)}%`);

        // 对于大型项目，分批处理以避免内存问题
        if (validFiles.length > this.maxFilesPerBatch) {
            this.warn(`文件数量过多 (${validFiles.length})，分批处理以避免内存问题`);
            
            const batches = [];
            for (let i = 0; i < validFiles.length; i += this.maxFilesPerBatch) {
                batches.push(validFiles.slice(i, i + this.maxFilesPerBatch));
            }
            
            for (let i = 0; i < batches.length; i++) {
                this.log(`处理批次 ${i + 1}/${batches.length} (${batches[i].length} 个文件)`);
                
                const batchChunks = await this.processFiles(batches[i], parserSelector);
                chunks.push(...batchChunks);
                
                // 批次间检查内存并强制垃圾回收
                this.checkMemoryUsage();
                if (global.gc) {
                    global.gc();
                }
                
                // 批次间小延迟，释放资源
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            return chunks;
        }

        // 如果worker不可用或文件数量适中，使用同步处理
        if (!this.useWorkers) {
            this.log('使用同步处理模式 (Worker已禁用或不可用)');
            return await this.processFiles(validFiles, parserSelector);
        }

        try {
            // 使用批处理方式控制并发数量
            const batchSize = this.maxWorkers;
            const batches = [];
            
            for (let i = 0; i < validFiles.length; i += batchSize) {
                batches.push(validFiles.slice(i, i + batchSize));
            }

            // 按批次处理文件
            for (const batch of batches) {
                const batchPromises = batch.map(file => this._createWorkerPromise(file, chunks, parserSelector));
                
                // 等待当前批次的所有 worker 完成
                const results = await Promise.allSettled(batchPromises);
                
                // 记录任何失败的任务
                results.forEach((result, index) => {
                    if (result.status === 'rejected') {
                        this.error(`Batch processing failed for file ${batch[index].path}:`, result.reason);
                    }
                });
                
                // 批次间检查内存
                this.checkMemoryUsage();
            }
        } catch (error) {
            this.error('Worker processing failed, switching to synchronous mode:', error);
            this.useWorkers = false;
            return await this.processFiles(validFiles, parserSelector);
        }

        return chunks;
    }

    /**
     * 创建Worker Promise，负责协调worker的执行
     * 注意：chunk的id和filePath属性由worker.js负责设置，此方法只负责ProgressTracker注册
     */
    _createWorkerPromise(file, chunks, parserSelector) {
        return new Promise((resolve, reject) => {
            let worker;
            
            // 检查Worker失败率，如果太高就直接使用同步处理
            if (this.workerFailures > 10) {
                this.warn(`Worker失败次数过多(${this.workerFailures})，切换到同步处理模式`);
                this.useWorkers = false;
                this._processSingleFileSync(file, chunks, parserSelector)
                    .then(resolve)
                    .catch(reject);
                return;
            }
            
            try {
                worker = this._createWorker(file);
                this.activeWorkers++;
                this.maxActiveWorkers = Math.max(this.maxActiveWorkers, this.activeWorkers);
            } catch (error) {
                this.workerFailures++;
                this.error(`Failed to create worker for file ${file.path} (失败次数: ${this.workerFailures}):`, error);
                // 回退到同步处理单个文件
                this._processSingleFileSync(file, chunks, parserSelector)
                    .then(resolve)
                    .catch(reject);
                return;
            }

            // 设置超时处理（防止worker卡死）
            const timeout = setTimeout(() => {
                if (worker) {
                    worker.terminate();
                }
                reject(new Error(`Worker timeout for file ${file.path}`));
            }, 30000); // 30秒超时

            worker.on('message', (result) => {
                clearTimeout(timeout);
                this.activeWorkers--;
                
                if (result.chunks) {
                    // chunk的id和filePath已经在worker中设置，这里只需要进行ProgressTracker注册
                    result.chunks.forEach(chunk => {
                        // 验证worker是否正确设置了必要属性
                        if (!chunk.id || !chunk.filePath) {
                            this.warn(`Missing chunk properties from worker for file ${file.path}:`, {
                                hasId: !!chunk.id,
                                hasFilePath: !!chunk.filePath
                            });
                        }
                        
                        // 注册 chunk 到 ProgressTracker
                        if (this.progressTracker && chunk.id) {
                            this.progressTracker.registerChunk(chunk.id, {
                                filePath: chunk.filePath,
                                startLine: chunk.startLine,
                                endLine: chunk.endLine,
                                content: chunk.content,
                                parser: chunk.parser,
                                type: chunk.type,
                                language: chunk.language
                            });
                        }
                    });
                    chunks.push(...result.chunks);
                }
                resolve(result);
            });

            worker.on('error', (error) => {
                clearTimeout(timeout);
                this.activeWorkers--;
                this.workerFailures++;
                this.error(`Worker error for file ${file.path} (失败次数: ${this.workerFailures}):`, error);
                
                // 回退到同步处理
                this._processSingleFileSync(file, chunks, parserSelector)
                    .then(() => resolve({ chunks: [] }))
                    .catch(reject);
            });

            worker.on('exit', (code) => {
                clearTimeout(timeout);
                this.activeWorkers--;
                if (code !== 0) {
                    this.workerFailures++;
                    const error = new Error(`Worker stopped with exit code ${code}`);
                    this.error(`Worker exit error for file ${file.path} (失败次数: ${this.workerFailures}):`, error);
                    
                    // 回退到同步处理
                    this._processSingleFileSync(file, chunks, parserSelector)
                        .then(() => resolve({ chunks: [] }))
                        .catch(reject);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * 同步处理单个文件（回退方案）
     */
    async _processSingleFileSync(file, chunks, parserSelector) {
        try {
            const fullPath = path.join(this.workspacePath, file.path);
            const content = await fs.readFile(fullPath, 'utf8');
            const parser = parserSelector.selectParser(file.path);
            const fileChunks = await parser.parse(fullPath, content);
            
            // 设置chunk属性
            fileChunks.forEach((chunk, index) => {
                const crypto = require('crypto');
                const pathHash = crypto.createHash('md5').update(file.path).digest('hex').substring(0, 8);
                const timestamp = Date.now().toString(36);
                chunk.id = `${path.basename(file.path, path.extname(file.path))}_${pathHash}_${chunk.startLine || index}-${chunk.endLine || index}_${timestamp}_${index}`;
                chunk.filePath = file.path;
                
                // 注册 chunk 到 ProgressTracker
                if (this.progressTracker) {
                    this.progressTracker.registerChunk(chunk.id, {
                        filePath: chunk.filePath,
                        startLine: chunk.startLine,
                        endLine: chunk.endLine,
                        content: chunk.content,
                        parser: chunk.parser,
                        type: chunk.type,
                        language: chunk.language
                    });
                }
            });
            
            chunks.push(...fileChunks);
            this.log(`Processed file synchronously: ${file.path} (${fileChunks.length} chunks)`);
        } catch (error) {
            this.error(`Error in sync processing for file ${file.path}:`, error);
        }
    }

    _createWorker(file) {
        // 尝试多个可能的worker路径
        const possiblePaths = [
            path.join(__dirname, 'worker.js'),
            path.resolve(__dirname, 'worker.js'),
            path.join(process.cwd(), 'code-chunker', 'src', 'worker.js'),
            path.join(process.cwd(), 'src', 'worker.js')
        ];

        let workerPath = null;
        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                workerPath = p;
                break;
            }
        }

        if (!workerPath) {
            throw new Error(`Worker script not found at any of these paths: ${possiblePaths.join(', ')}`);
        }

        const worker = new Worker(workerPath, {
            workerData: {
                file,
                workspacePath: this.workspacePath,
                config: this.config
            }
        });

        return worker;
    }

    /**
     * 获取Worker统计信息
     */
    getWorkerStats() {
        return {
            maxWorkers: this.maxWorkers,
            activeWorkers: this.activeWorkers,
            maxActiveWorkers: this.maxActiveWorkers,
            workerFailures: this.workerFailures,
            useWorkers: this.useWorkers
        };
    }

    /**
     * 重置Worker统计
     */
    resetWorkerStats() {
        this.activeWorkers = 0;
        this.maxActiveWorkers = 0;
        this.workerFailures = 0;
        this.useWorkers = false;
    }

    // 检查内存使用情况
    checkMemoryUsage() {
        const memUsage = process.memoryUsage();
        const totalMem = require('os').totalmem();
        const usedPercentage = memUsage.heapUsed / totalMem;
        
        if (usedPercentage > this.memoryThreshold) {
            this.warn(`高内存使用率检测到: ${(usedPercentage * 100).toFixed(2)}%，切换到同步模式`);
            this.useWorkers = false;
            
            // 强制垃圾回收（如果可用）
            if (global.gc) {
                global.gc();
            }
        }
        
        return usedPercentage;
    }
}

module.exports = Dispatcher; 