const express = require('express');
const { CodeChunker, processWorkspace, getChunkerInstance, chunkerInstances } = require('./index');
const path = require('path');
const FileScanner = require('./src/fileScanner');
const { createCollectionName } = require('./src/utils/collectionNameUtils');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== 静默程序管理 ====================
const silentPrograms = new Map();
const merkleTreeCache = new Map(); // 缓存哈希树

const SILENT_MONITOR_CONFIG = {
    intervalMs: 600000, // 10分钟
    enableLogging: true,
    autoStopOnTrigger: true,
    maxInstances: 10,
    persistCache: true
};

// CORS 中间件 - 处理跨域请求
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 
        'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control, Pragma'
    );
    res.setHeader('Access-Control-Max-Age', '86400'); // 24小时
    
    // 处理预检请求
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    next();
});

// 基础中间件
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 请求日志中间件（简化版）
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// 启动工作空间监控静默程序
function startWorkspaceMonitor(userId, deviceId, workspacePath, token) {
    const workspaceKey = `${userId}_${deviceId}_${workspacePath}`;
    
    // 防重复启动
    if (silentPrograms.has(workspaceKey)) {
        console.log(`📊 Workspace monitor already running: ${workspaceKey}`);
        return false;
    }
    
    console.log(`🚀 Starting workspace monitor: ${workspaceKey}`);
    
    // 创建FileScanner实例用于监控
    const monitorConfig = {
        workspacePath,
        ignorePatterns: [
            '**/.git/**',
            '**/node_modules/**',
            '**/__pycache__/**',
            '**/*.log',
            '**/*.tmp',
            '**/.vscode/**',
            '**/.idea/**'
        ],
        includeTextContentOnly: false,
        processBinaryFiles: false
    };
    
    const fileScanner = new FileScanner(monitorConfig);
    
    // 创建定时器
    const intervalId = setInterval(async () => {
        await executeWorkspaceMonitor(workspaceKey, {
            userId, deviceId, workspacePath, token, fileScanner
        });
    }, SILENT_MONITOR_CONFIG.intervalMs);
    
    // 存储程序信息
    silentPrograms.set(workspaceKey, {
        intervalId,
        startTime: new Date(),
        workspaceKey,
        status: 'monitoring',
        executeCount: 0,
        userId,
        deviceId,
        workspacePath,
        token,
        fileScanner
    });
    
    console.log(`✅ Workspace monitor started: ${workspaceKey}`);
    return true;
}

// 停止工作空间监控
function stopWorkspaceMonitor(userId, deviceId, workspacePath) {
    const workspaceKey = `${userId}_${deviceId}_${workspacePath}`;
    
    if (!silentPrograms.has(workspaceKey)) {
        return false;
    }
    
    const program = silentPrograms.get(workspaceKey);
    clearInterval(program.intervalId);
    
    const runTime = Date.now() - program.startTime.getTime();
    console.log(`🛑 Workspace monitor stopped: ${workspaceKey} (${(runTime/1000).toFixed(2)}s, ${program.executeCount} executions)`);
    
    // 清理缓存
    merkleTreeCache.delete(workspaceKey);
    silentPrograms.delete(workspaceKey);
    
    return true;
}

// 执行工作空间监控任务
async function executeWorkspaceMonitor(workspaceKey, context) {
    const { userId, deviceId, workspacePath, token, fileScanner } = context;
    const program = silentPrograms.get(workspaceKey);
    
    if (!program) return;
    
    try {
        program.executeCount++;
        
        // 1. 扫描工作空间生成新的哈希树
        const scanResult = await fileScanner.scanWorkspace(workspacePath);
        const newMerkleTree = scanResult.merkleTree;
        
        // 2. 获取上次的哈希树
        const lastMerkleTree = merkleTreeCache.get(workspaceKey);
        
        if (!lastMerkleTree) {
            // 首次扫描，直接缓存
            merkleTreeCache.set(workspaceKey, newMerkleTree);
            return;
        }
        
        // 3. 比较哈希树
        const changedFiles = FileScanner.findChangedFiles(lastMerkleTree, newMerkleTree);
        
        if (changedFiles.length > 0) {
            console.log(`📝 Changes detected in ${workspaceKey}: ${changedFiles.length} files`);
            
            // 4. 自动重新处理工作空间
            program.status = 'reprocessing';
            
            try {
                console.log(`🔄 Auto-reprocessing: ${workspaceKey}`);
                const success = await processWorkspace(userId, deviceId, workspacePath, token);
                
                if (success) {
                    merkleTreeCache.set(workspaceKey, newMerkleTree);
                    program.status = 'monitoring';
                    console.log(`✅ Auto-reprocessing completed: ${workspaceKey}`);
                } else {
                    console.log(`❌ Auto-reprocessing failed: ${workspaceKey}`);
                    program.status = 'monitoring';
                }
            } catch (error) {
                console.error(`Error in auto-reprocessing ${workspaceKey}:`, error.message);
                program.status = 'monitoring';
            }
        }
        
    } catch (error) {
        console.error(`Error in workspace monitor ${workspaceKey}:`, error.message);
        
        // 错误次数过多时停止监控
        program.errorCount = (program.errorCount || 0) + 1;
        if (program.errorCount > 3) {
            console.log(`⚠️ Too many errors, stopping monitor: ${workspaceKey}`);
            stopWorkspaceMonitor(userId, deviceId, workspacePath);
        }
    }
}

// 删除指定用户和设备的collection索引
async function deleteCollectionIndex(userID, deviceID, workspacePath, token) {
    let chunker = null;
    
    try {
        // 创建临时的CodeChunker实例用于删除操作
        const chunkerConfig = {
            workspacePath,
            token,
            userId: userID,
            deviceId: deviceID,
            vectorManager: {
                enabled: true,
                logLevel: 'info',
                database: {
                    type: 'tencent_cloud',
                    connection: {
                        type: 'tencent',
                        host: 'http://nj-vdb-dz5mmt48.sql.tencentcdb.com',
                        port: 8100,
                        database: 'vectordb-test',
                        username: 'root',
                        apiKey: '4xVMtNrcgYd3FQ35A3YkWuFTcvn63t0hkBkDWfKS',
                        timeout: 30000
                    },
                    collections: {
                        vectorDimension: 768,
                        metricType: 'COSINE',
                        indexType: 'HNSW'
                    },
                    query: {
                        defaultDatabase: 'vectordb-test'
                    },
                    batchSize: 100
                }
            }
        };

        chunker = new CodeChunker(chunkerConfig);

        // 使用统一的collection名称生成工具
        const collectionName = createCollectionName(userID, deviceID, workspacePath);
        const databaseName = 'vectordb-test';

        // 确保VectorManager已初始化
        if (!chunker.vectorManager) {
            const VectorManager = require('./src/vectorManager');
            chunker.vectorManager = new VectorManager(chunkerConfig.vectorManager);
            await chunker.vectorManager.initialize();
        }

        // 检查VectorManager和数据库连接
        if (!chunker.vectorManager.vectorDB || !chunker.vectorManager.vectorDB.implementation) {
            throw new Error('VectorDB not properly initialized');
        }

        // 执行删除操作
        const deleteResult = await chunker.vectorManager.vectorDB.implementation.dropCollection(databaseName, collectionName);

        // 清理本地缓存的实例
        const instanceKey = `${userID}_${deviceID}_${workspacePath}`;
        if (chunkerInstances.has(instanceKey)) {
            const cachedChunker = chunkerInstances.get(instanceKey);
            try {
                await cachedChunker.shutdown();
            } catch (shutdownError) {
                console.warn('清理缓存实例时出现警告:', shutdownError.message);
            }
            chunkerInstances.delete(instanceKey);
        }

        return {
            success: true,
            collectionName,
            databaseName,
            result: deleteResult
        };

    } catch (error) {
        console.error('删除集合时发生错误:', error.message);
        
        // 处理集合不存在的情况
        if (error.message.includes('not exist') || 
            error.message.includes('找不到') || 
            error.message.includes('does not exist') ||
            error.message.includes('Collection not found') ||
            error.code === 'COLLECTION_NOT_FOUND' || 
            error.status === 404) {
            
            // 使用统一的collection名称生成工具
            const collectionName = createCollectionName(userID, deviceID, workspacePath);
            
            return {
                success: true,
                collectionName,
                databaseName: 'vectordb-test',
                message: 'Collection does not exist (already deleted or never created)'
            };
        }

        return {
            success: false,
            error: error.message || 'Unknown error occurred',
            details: {
                name: error.name,
                code: error.code,
                status: error.status
            }
        };

    } finally {
        // 清理临时chunker实例
        if (chunker) {
            try {
                await chunker.shutdown();
            } catch (cleanupError) {
                console.warn('清理临时实例时发生错误:', cleanupError.message);
            }
        }
    }
}

// 健康检查接口
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'CodeChunker API',
        version: '0.1.0'
    });
});

// CORS 配置信息接口
app.get('/api/cors-info', (req, res) => {
    res.json({
        success: true,
        cors: {
            enabled: true,
            allowAllOrigins: true,
            allowedOrigins: ['*'],
            allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
            allowCredentials: false,
            maxAge: 86400,
            currentOrigin: req.headers.origin || 'no-origin'
        },
        timestamp: new Date().toISOString()
    });
});

// 处理工作空间接口
app.post('/api/process-workspace', async (req, res) => {
    try {
        const { userId, deviceId, workspacePath, token, ignorePatterns } = req.body;
        
        // 参数验证
        if (!userId || !deviceId || !workspacePath || !token) {
            return res.status(400).json({
                error: 'Missing required parameters',
                required: ['userId', 'deviceId', 'workspacePath', 'token']
            });
        }

        // 验证工作空间路径是否存在
        const fs = require('fs-extra');
        if (!fs.existsSync(workspacePath)) {
            return res.status(400).json({
                error: 'Workspace path does not exist',
                workspacePath
            });
        }

        console.log(`Processing workspace: ${workspacePath} for user ${userId}`);
        
        // 调用处理函数
        const result = await processWorkspace(userId, deviceId, workspacePath, token, ignorePatterns);
        
        if (result) {
            // 启动工作空间监控
            const monitorStarted = startWorkspaceMonitor(userId, deviceId, workspacePath, token);
            
            res.json({
                success: true,
                message: 'Workspace processed successfully',
                userId,
                deviceId,
                workspacePath,
                workspaceMonitorStarted: monitorStarted,
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(500).json({
                error: 'Failed to process workspace',
                userId,
                deviceId,
                workspacePath
            });
        }
    } catch (error) {
        console.error('Error processing workspace:', error.message);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// 搜索接口
app.post('/api/search', async (req, res) => {
    try {
        const { query, userId, deviceId, workspacePath, options = {} } = req.body;
        
        // 参数验证
        if (!query || !userId || !deviceId || !workspacePath) {
            return res.status(400).json({
                error: 'Missing required parameters',
                required: ['query', 'userId', 'deviceId', 'workspacePath']
            });
        }

        console.log(`Search: "${query}" for user ${userId}`);
        
        // 获取CodeChunker实例
        const chunker = getChunkerInstance(userId, deviceId, workspacePath);
        
        // 执行搜索
        const searchResults = await chunker.search(query, {
            topK: options.topK || 10,
            ...options
        });
        
        res.json({
            success: true,
            query,
            results: searchResults,
            resultCount: searchResults.length,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Error searching:', error.message);
        
        // 特殊处理VectorManager未启用的错误
        if (error.message.includes('VectorManager is not enabled')) {
            return res.status(400).json({
                error: 'Vector search is not enabled',
                message: 'Please process the workspace first to enable search functionality'
            });
        }
        
        res.status(500).json({
            error: 'Search failed',
            message: error.message
        });
    }
});

// 获取工作空间状态接口
app.get('/api/workspace-status', async (req, res) => {
    try {
        const { userId, deviceId, workspacePath } = req.query;
        
        if (!userId || !deviceId || !workspacePath) {
            return res.status(400).json({
                error: 'Missing required parameters',
                required: ['userId', 'deviceId', 'workspacePath']
            });
        }

        const key = `${userId}_${deviceId}_${workspacePath}`;
        const hasInstance = chunkerInstances.has(key);
        
        let vectorManagerStatus = 'not_initialized';
        if (hasInstance) {
            const chunker = chunkerInstances.get(key);
            if (chunker.vectorManager) {
                vectorManagerStatus = 'initialized';
            }
        }

        res.json({
            success: true,
            status: {
                hasInstance,
                vectorManagerStatus,
                canSearch: hasInstance && vectorManagerStatus === 'initialized'
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Error getting workspace status:', error.message);
        res.status(500).json({
            error: 'Failed to get workspace status',
            message: error.message
        });
    }
});

// 获取处理进度接口
app.get('/api/get-process', async (req, res) => {
    try {
        const { userID, deviceID, workspacePath, token } = req.query;
        
        // 参数验证
        if (!userID || !deviceID || !workspacePath || !token) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameters',
                required: ['userID', 'deviceID', 'workspacePath', 'token']
            });
        }

        // 简单的token验证
        const validTokens = ['test_auth_token', 'development_token'];
        if (!validTokens.includes(token) && process.env.NODE_ENV !== 'development') {
            return res.status(401).json({
                success: false,
                error: 'Invalid token'
            });
        }

        // 检查是否有对应的CodeChunker实例
        const instanceKey = `${userID}_${deviceID}_${workspacePath}`;
        
        if (!chunkerInstances.has(instanceKey)) {
            return res.json({
                success: true,
                progress: 0.0,
                progressPercentage: "0.00%",
                status: 'not_started',
                message: 'Workspace processing not started yet',
                details: {
                    totalFiles: 0,
                    completedFiles: 0,
                    processingFiles: 0,
                    failedFiles: 0,
                    pendingFiles: 0
                },
                timestamp: new Date().toISOString()
            });
        }

        const chunker = chunkerInstances.get(instanceKey);
        
        // 获取文件处理进度
        const progressPercentage = chunker.getFileProcessingProgress();
        const progressDetails = chunker.getFileProcessingDetails();
        
        // 确定状态
        let status = 'processing';
        if (progressPercentage === 0 && progressDetails.totalFiles === 0) {
            status = 'not_started';
        } else if (progressPercentage === 100) {
            status = 'completed';
        } else if (progressDetails.processingFiles > 0) {
            status = 'processing';
        } else if (progressDetails.failedFiles > 0 && progressDetails.completedFiles + progressDetails.failedFiles === progressDetails.totalFiles) {
            status = 'completed_with_errors';
        }

        res.json({
            success: true,
            progress: parseFloat(progressPercentage.toFixed(2)),
            progressPercentage: `${progressPercentage.toFixed(2)}%`,
            status: status,
            details: {
                totalFiles: progressDetails.totalFiles,
                completedFiles: progressDetails.completedFiles,
                processingFiles: progressDetails.processingFiles,
                failedFiles: progressDetails.failedFiles,
                pendingFiles: progressDetails.pendingFiles
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('获取处理进度时发生错误:', error.message);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// 删除索引接口
app.post('/api/delete-index', async (req, res) => {
    try {
        const { userID, deviceID, workspacePath, token } = req.body;
        
        // 参数验证
        if (!userID || !deviceID || !workspacePath || !token) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameters',
                required: ['userID', 'deviceID', 'workspacePath', 'token']
            });
        }

        // 简单的token验证
        const validTokens = ['test_auth_token', 'development_token'];
        if (!validTokens.includes(token) && process.env.NODE_ENV !== 'development') {
            return res.status(401).json({
                success: false,
                error: 'Invalid token'
            });
        }

        console.log(`Deleting index for user ${userID} in ${workspacePath}`);

        // 停止工作空间监控
        const monitorStopped = stopWorkspaceMonitor(userID, deviceID, workspacePath);

        // 执行删除操作
        const deleteResult = await deleteCollectionIndex(userID, deviceID, workspacePath, token);

        if (deleteResult.success) {
            res.json({
                success: true,
                message: 'Collection index deleted successfully',
                data: {
                    collectionName: deleteResult.collectionName,
                    databaseName: deleteResult.databaseName,
                    deletedAt: new Date().toISOString()
                },
                workspaceMonitorStopped: monitorStopped,
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(500).json({
                success: false,
                error: deleteResult.error,
                workspaceMonitorStopped: monitorStopped,
                timestamp: new Date().toISOString()
            });
        }

    } catch (error) {
        console.error('删除索引时发生错误:', error.message);
        
        // 错误情况下也尝试停止监控
        const { userID, deviceID, workspacePath } = req.body;
        const monitorStopped = stopWorkspaceMonitor(userID, deviceID, workspacePath);
        
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
            workspaceMonitorStopped: monitorStopped,
            timestamp: new Date().toISOString()
        });
    }
});

// 获取所有工作空间监控状态
app.get('/api/workspace-monitors', (req, res) => {
    try {
        const monitors = [];
        for (const [key, program] of silentPrograms) {
            monitors.push({
                workspaceKey: key,
                userId: program.userId,
                deviceId: program.deviceId,
                workspacePath: program.workspacePath,
                status: program.status,
                startTime: program.startTime,
                runningTime: Date.now() - program.startTime.getTime(),
                executeCount: program.executeCount,
                errorCount: program.errorCount || 0
            });
        }
        
        res.json({
            success: true,
            monitors,
            count: monitors.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to get workspace monitors',
            message: error.message
        });
    }
});

// 手动停止特定监控
app.post('/api/stop-workspace-monitor', (req, res) => {
    try {
        const { userId, deviceId, workspacePath } = req.body;
        
        if (!userId || !deviceId || !workspacePath) {
            return res.status(400).json({
                error: 'Missing required parameters',
                required: ['userId', 'deviceId', 'workspacePath']
            });
        }
        
        const stopped = stopWorkspaceMonitor(userId, deviceId, workspacePath);
        
        res.json({
            success: true,
            stopped,
            message: stopped ? 'Workspace monitor stopped' : 'Monitor not found'
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to stop workspace monitor',
            message: error.message
        });
    }
});

// 获取静默监控配置
app.get('/api/silent-monitor-config', (req, res) => {
    res.json({
        success: true,
        config: SILENT_MONITOR_CONFIG,
        timestamp: new Date().toISOString()
    });
});

// 更新静默监控配置
app.post('/api/silent-monitor-config', (req, res) => {
    try {
        const { config } = req.body;
        
        // 更新配置
        Object.keys(config).forEach(key => {
            if (key in SILENT_MONITOR_CONFIG) {
                SILENT_MONITOR_CONFIG[key] = config[key];
            }
        });
        
        res.json({
            success: true,
            message: 'Configuration updated',
            updatedConfig: SILENT_MONITOR_CONFIG
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to update configuration',
            message: error.message
        });
    }
});

// 清理实例接口
app.post('/api/cleanup', async (req, res) => {
    try {
        const { userId, deviceId, workspacePath } = req.body;
        
        if (userId && deviceId && workspacePath) {
            // 清理特定实例
            const key = `${userId}_${deviceId}_${workspacePath}`;
            if (chunkerInstances.has(key)) {
                const chunker = chunkerInstances.get(key);
                await chunker.shutdown();
                chunkerInstances.delete(key);
                
                res.json({
                    success: true,
                    message: 'Specific instance cleaned up',
                    key
                });
            } else {
                res.json({
                    success: true,
                    message: 'Instance not found',
                    key
                });
            }
        } else {
            // 清理所有实例
            const keys = Array.from(chunkerInstances.keys());
            for (const [key, chunker] of chunkerInstances) {
                try {
                    await chunker.shutdown();
                } catch (error) {
                    console.error(`Error shutting down chunker ${key}:`, error.message);
                }
            }
            chunkerInstances.clear();
            
            res.json({
                success: true,
                message: 'All instances cleaned up',
                cleanedCount: keys.length
            });
        }
        
    } catch (error) {
        console.error('Error during cleanup:', error.message);
        res.status(500).json({
            error: 'Cleanup failed',
            message: error.message
        });
    }
});

// 错误处理中间件
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error.message);
    res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        timestamp: new Date().toISOString()
    });
});

// 404处理
app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        path: req.path,
        method: req.method,
        availableEndpoints: [
            'GET /health',
            'GET /api/cors-info',   
            'POST /api/process-workspace',
            'POST /api/search',
            'GET /api/get-process',
            'POST /api/delete-index',
            'GET /api/workspace-status',
            'GET /api/workspace-monitors',
            'POST /api/stop-workspace-monitor',
            'GET /api/silent-monitor-config',
            'POST /api/silent-monitor-config',
            'POST /api/cleanup'
        ]
    });
});

// 优雅关闭
process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    
    // 停止所有工作空间监控程序
    const monitorKeys = Array.from(silentPrograms.keys());
    for (const key of monitorKeys) {
        const program = silentPrograms.get(key);
        stopWorkspaceMonitor(program.userId, program.deviceId, program.workspacePath);
    }
    console.log(`Stopped ${monitorKeys.length} workspace monitors`);
    
    // 关闭所有CodeChunker实例
    for (const [key, chunker] of chunkerInstances) {
        try {
            await chunker.shutdown();
        } catch (error) {
            console.error(`Error shutting down chunker ${key}:`, error.message);
        }
    }
    
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down gracefully...');
    
    // 停止所有工作空间监控程序
    const monitorKeys = Array.from(silentPrograms.keys());
    for (const key of monitorKeys) {
        const program = silentPrograms.get(key);
        stopWorkspaceMonitor(program.userId, program.deviceId, program.workspacePath);
    }
    console.log(`Stopped ${monitorKeys.length} workspace monitors`);
    
    // 关闭所有CodeChunker实例
    for (const [key, chunker] of chunkerInstances) {
        try {
            await chunker.shutdown();
        } catch (error) {
            console.error(`Error shutting down chunker ${key}:`, error.message);
        }
    }
    
    process.exit(0);
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`🚀 CodeChunker API Server running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`🔄 Workspace monitoring enabled (${SILENT_MONITOR_CONFIG.intervalMs/1000}s intervals)`);
    console.log(`📋 Available endpoints: ${[
        'GET /health',
        'POST /api/process-workspace',
        'POST /api/search',
        'GET /api/get-process',
        'POST /api/delete-index',
        'GET /api/workspace-monitors'
    ].length} endpoints`);
});

module.exports = app; 