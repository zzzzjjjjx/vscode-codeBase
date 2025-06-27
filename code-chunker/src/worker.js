const { parentPort, workerData } = require('worker_threads');
const fs = require('fs-extra');
const path = require('path');
const ParserSelector = require('./parserSelector');
const FileTypeDetector = require('./utils/fileTypeDetector');

/**
 * 流式读取文件，防止大文件内存泄漏
 * @param {string} filePath - 文件路径
 * @param {number} maxSize - 最大文件大小限制
 * @returns {Promise<Buffer>} - 文件内容Buffer
 */
async function readFileStreaming(filePath, maxSize) {
    return new Promise((resolve, reject) => {
        const stream = fs.createReadStream(filePath);
        const chunks = [];
        let totalSize = 0;
        
        stream.on('data', (chunk) => {
            totalSize += chunk.length;
            
            // 检查是否超过大小限制
            if (totalSize > maxSize) {
                stream.destroy();
                reject(new Error(`File ${filePath} exceeds size limit during streaming read (${totalSize} > ${maxSize})`));
                return;
            }
            
            chunks.push(chunk);
        });
        
        stream.on('end', () => {
            try {
                const buffer = Buffer.concat(chunks);
                resolve(buffer);
            } catch (error) {
                reject(new Error(`Failed to concatenate file chunks: ${error.message}`));
            }
        });
        
        stream.on('error', (error) => {
            reject(new Error(`Stream reading error for ${filePath}: ${error.message}`));
        });
        
        // 设置超时
        const timeout = setTimeout(() => {
            stream.destroy();
            reject(new Error(`File reading timeout for ${filePath}`));
        }, 30000); // 30秒超时
        
        stream.on('close', () => {
            clearTimeout(timeout);
        });
    });
}

async function processFile() {
    let parserSelector = null;
    let fileTypeDetector = null;
    let fileInfo = null;
    
    try {
        // 参数验证
        if (!workerData) {
            throw new Error('Missing worker data');
        }
        
        const { file, workspacePath, config } = workerData;
        
        if (!file) {
            throw new Error('Missing file data in worker parameters');
        }
        
        if (!file.path || typeof file.path !== 'string') {
            throw new Error('Invalid or missing file path in worker data');
        }
        
        if (!workspacePath || typeof workspacePath !== 'string') {
            throw new Error('Invalid or missing workspace path in worker data');
        }
        
        if (!config) {
            throw new Error('Missing configuration in worker data');
        }
        
        // 初始化组件
        try {
            parserSelector = new ParserSelector(config);
            fileTypeDetector = new FileTypeDetector();
        } catch (initError) {
            throw new Error(`Failed to initialize worker components: ${initError.message}`);
        }

        const fullPath = path.join(workspacePath, file.path);
        
        let content;
        try {
            // 【修复】首先检查文件大小，避免大文件内存泄漏
            const stats = await fs.stat(fullPath);
            const maxFileSize = config.maxFileSize || 10 * 1024 * 1024; // 默认10MB限制
            
            if (stats.size > maxFileSize) {
                console.warn(`File ${file.path} too large (${stats.size} bytes), exceeds limit (${maxFileSize} bytes)`);
                parentPort.postMessage({ 
                    chunks: [{
                        id: `${path.basename(file.path, path.extname(file.path))}_large_file_${Date.now()}`,
                        content: `[Large file: ${(stats.size / 1024 / 1024).toFixed(2)}MB, processing skipped to prevent memory issues]`,
                        filePath: file.path,
                        startLine: 1,
                        endLine: 1,
                        isLargeFile: true,
                        fileSize: stats.size,
                        reason: 'File size exceeds memory safety limit'
                    }],
                    warning: `Large file skipped: ${file.path} (${stats.size} bytes)`,
                    fileInfo: {
                        encoding: 'unknown',
                        size: stats.size,
                        hash: null,
                        isBinary: false,
                        isLargeFile: true
                    }
                });
                return;
            }
            
            // 【修复】使用流式处理读取文件，防止大文件一次性加载到内存
            let buffer;
            if (stats.size > 1024 * 1024) { // 1MB以上使用流式读取
                buffer = await readFileStreaming(fullPath, maxFileSize);
            } else {
                // 小文件直接读取
                buffer = await fs.readFile(fullPath);
            }
            
            // 检查文件是否为空
            if (!buffer || buffer.length === 0) {
                console.warn(`File ${file.path} is empty`);
                parentPort.postMessage({ 
                    chunks: [],
                    warning: `Empty file: ${file.path}`,
                    fileInfo: {
                        encoding: 'utf8',
                        size: 0,
                        hash: null,
                        isBinary: false
                    }
                });
                return;
            }
            
            fileInfo = fileTypeDetector.analyzeFile(buffer, file.path);
            
            if (fileInfo.error) {
                throw new Error(`Failed to analyze file: ${fileInfo.error}`);
            }
            
            if (fileInfo.isBinary) {
                // 对于二进制文件，跳过解析或提供特殊处理
                console.warn(`Skipping binary file: ${file.path}`);
                parentPort.postMessage({ 
                    chunks: [],
                    warning: `Binary file skipped: ${file.path} (${fileInfo.size} bytes)`
                });
                return;
            }
            
            // 对于文本文件，使用检测到的内容
            content = fileInfo.content;
            
            // 释放buffer内存
            buffer = null;
            
            // 检查内容是否为空或只包含空白字符
            if (!content || content.trim().length === 0) {
                console.warn(`File ${file.path} contains only whitespace`);
                parentPort.postMessage({ 
                    chunks: [],
                    warning: `File contains only whitespace: ${file.path}`,
                    fileInfo: {
                        encoding: fileInfo.encoding,
                        size: fileInfo.size,
                        hash: fileInfo.hash,
                        isBinary: fileInfo.isBinary
                    }
                });
                return;
            }
            
            if (fileInfo.encoding && fileInfo.encoding !== 'utf8') {
    
            }
        } catch (readError) {
            // 处理文件读取错误
            if (readError.code === 'ENOENT') {
                throw new Error(`File not found: ${file.path}`);
            } else if (readError.code === 'EACCES') {
                throw new Error(`Permission denied reading file: ${file.path}`);
            } else if (readError.code === 'EISDIR') {
                throw new Error(`Path is a directory, not a file: ${file.path}`);
            } else if (readError.code === 'EMFILE' || readError.code === 'ENFILE') {
                throw new Error(`Too many open files, cannot read: ${file.path}`);
            } else if (readError.message && readError.message.includes('exceeds size limit')) {
                throw readError; // 重新抛出大小限制错误
            } else {
                throw new Error(`Error reading file ${file.path}: ${readError.message}`);
            }
        }
        
        // 选择适当的解析器
        let parser;
        try {
            parser = parserSelector.selectParser(file.path);
            if (!parser) {
                throw new Error(`No parser found for file: ${file.path}`);
            }
        } catch (parserError) {
            throw new Error(`Failed to select parser for ${file.path}: ${parserError.message}`);
        }

        // 解析文件内容
        let chunks;
        try {
            // 修复：使用正确的参数顺序 parse(filePath, content)
            chunks = await parser.parse(fullPath, content);
            
            // 验证解析结果
            if (!Array.isArray(chunks)) {
                console.warn(`Parser returned non-array result for ${file.path}, converting to array`);
                chunks = chunks ? [chunks] : [];
            }
            
        } catch (parseError) {
            console.error(`Parser failed for ${file.path}:`, parseError);
            
            // 尝试使用基础解析器作为回退
            try {
                const BaseParser = require('./parsers/BaseParser');
                const fallbackParser = new BaseParser(config);
                chunks = await fallbackParser.parse(fullPath, content);
                console.warn(`Used fallback parser for ${file.path}`);
            } catch (fallbackError) {
                throw new Error(`Both primary and fallback parsing failed for ${file.path}: ${parseError.message} | ${fallbackError.message}`);
            }
        }
        
        // 为每个 chunk 添加 ID 和元数据
        try {
            chunks.forEach((chunk, index) => {
                if (!chunk || typeof chunk !== 'object') {
                    console.warn(`Invalid chunk at index ${index} for file ${file.path}`);
                    return;
                }
                
                // 生成唯一的chunk ID，包含路径哈希确保唯一性
                const crypto = require('crypto');
                const pathHash = crypto.createHash('md5').update(file.path).digest('hex').substring(0, 8);
                const timestamp = Date.now().toString(36);
                chunk.id = `${path.basename(file.path, path.extname(file.path))}_${pathHash}_${chunk.startLine || index}-${chunk.endLine || index}_${timestamp}_${index}`;
                
                // 确保使用相对路径，而不是解析器可能设置的绝对路径
                chunk.filePath = file.path;
                
                // 添加文件类型信息
                if (fileInfo) {
                    chunk.fileEncoding = fileInfo.encoding;
                    chunk.fileSize = fileInfo.size;
                    chunk.fileHash = fileInfo.hash;
                }
            });
        } catch (chunkError) {
            console.error(`Error processing chunks for ${file.path}:`, chunkError);
            // 继续处理，不让这个错误阻止整个流程
        }
        
        
        // 发送结果回主线程
        parentPort.postMessage({ 
            chunks: chunks || [],
            fileInfo: {
                encoding: fileInfo?.encoding,
                size: fileInfo?.size,
                hash: fileInfo?.hash,
                isBinary: fileInfo?.isBinary
            }
        });
        
        // 【修复】主动释放大内容变量的内存引用
        content = null;
        chunks = null;
        
        // 建议垃圾回收（在处理大文件后）
        if (fileInfo && fileInfo.size > 1024 * 1024) { // 1MB以上的文件
            if (global.gc) {
                global.gc();
            }
        }
        
    } catch (error) {
        const errorDetails = {
            message: error.message || 'Unknown error',
            code: error.code || 'UNKNOWN_ERROR',
            filePath: workerData?.file?.path || 'unknown',
            stack: error.stack || 'No stack trace available',
            timestamp: new Date().toISOString(),
            workerData: {
                hasFile: !!(workerData && workerData.file),
                hasWorkspacePath: !!(workerData && workerData.workspacePath),
                hasConfig: !!(workerData && workerData.config)
            }
        };
        
        console.error(`Error processing file ${errorDetails.filePath}:`, error);
        
        // 发送详细的错误信息
        parentPort.postMessage({ 
            error: errorDetails
        });
    } finally {
        // 【修复】资源清理 - 更彻底的内存释放
        try {
            // 清理组件引用
            parserSelector = null;
            fileTypeDetector = null;
            fileInfo = null;
            
            // 清理可能的大变量引用
            content = null;
            
            // 清理workerData中的大对象引用
            if (workerData && workerData.file) {
                workerData.file = null;
            }
            
        } catch (cleanupError) {
            console.warn('Error during cleanup:', cleanupError);
        }
    }
}

processFile();

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception in worker:', error);
    parentPort.postMessage({ 
        error: {
            message: `Uncaught exception: ${error.message}`,
            code: 'UNCAUGHT_EXCEPTION',
            filePath: workerData?.file?.path || 'unknown',
            stack: error.stack,
            timestamp: new Date().toISOString()
        }
    });
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection in worker:', reason);
    parentPort.postMessage({ 
        error: {
            message: `Unhandled rejection: ${reason}`,
            code: 'UNHANDLED_REJECTION',
            filePath: workerData?.file?.path || 'unknown',
            stack: reason.stack || 'No stack trace',
            timestamp: new Date().toISOString()
        }
    });
    process.exit(1);
});