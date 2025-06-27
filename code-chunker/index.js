const CodeChunker = require('./src/main');
const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

// 全局CodeChunker实例缓存
const chunkerInstances = new Map();

/**
 * 加载默认配置
 */
function loadDefaultConfig() {
    // 🔥 内置多语言项目优化配置，支持Python、C++、CUDA等深度学习项目
    const builtinConfig = {
        scanFileExtensions: [
            // Python files
            '.py', '.pyx', '.pyi', '.pyw',
            // C/C++ files
            '.c', '.cpp', '.cc', '.cxx', '.c++', '.h', '.hpp', '.hh', '.hxx', '.h++',
            // CUDA files
            '.cu', '.cuh',
            // Configuration files
            '.yaml', '.yml', '.json', '.toml', '.ini', '.cfg', '.conf',
            // Build files
            '.cmake', '.txt', '.mk', '.make',
            // Documentation
            '.md', '.rst', '.txt',
            // Shell scripts
            '.sh', '.bash', '.zsh', '.fish',
            // Java files (keep for backward compatibility)
            '.java', '.xml', '.properties',
            // JavaScript/TypeScript
            '.js', '.ts', '.jsx', '.tsx',
            // Other common formats
            '.sql', '.proto', '.proto3'
        ],
        maxWorkers: 1,
        useWorkers: false,
        batchSize: 10,
        linesPerChunk: 20,
        ignoredDirectories: [
            'node_modules', '.git', '.vscode', '.idea', 'target', 'build', 'out', 'bin', 'classes',
            'test', 'tests', 'src/test', 'sql', 'database', 'db', 'flowable-patch', 'patch',
            'lib', 'libs', 'vendor', 'third-party', 'ui', 'frontend', 'static', 'dist',
            'script', 'scripts', 'doc', 'docs', 'logs', 'log', 'temp', 'tmp'
        ],
        ignorePatterns: [
            '**/*.sql', '**/sql/**', '**/test/**', '**/tests/**', '**/target/**', '**/build/**',
            '**/flowable-patch/**', '**/third-party/**', '**/vendor/**', '**/lib/**', '**/libs/**',
            '**/node_modules/**', '**/.git/**', '**/.vscode/**', '**/.idea/**',
            // CUDA和深度学习项目特有忽略
            '**/cubin/**', '**/*.cubin', '**/*.cubin.cpp', '**/*.ptx', '**/*.fatbin',
            '**/models/**', '**/weights/**', '**/data/**', '**/datasets/**',
            '**/*.bin', '**/*.onnx', '**/*.pb', '**/*.pth', '**/*.engine', '**/*.plan',
            '**/__pycache__/**', '**/venv/**', '**/wandb/**', '**/runs/**'
        ]
    };
    
    // 🔥 尝试加载外部配置文件，但如果失败则使用内置配置
    const defaultConfigPath = path.join(__dirname, 'config', 'default.yaml');
    
    try {
        if (fs.existsSync(defaultConfigPath)) {
            const defaultConfigContent = fs.readFileSync(defaultConfigPath, 'utf8');
            const externalConfig = yaml.parse(defaultConfigContent);
            return externalConfig;
        } else {
            return builtinConfig;
        }
    } catch (error) {
        console.error('[CodeChunker] ❌ 加载外部配置失败，使用内置配置:', error);
        return builtinConfig;
    }
}

/**
 * 获取或创建CodeChunker实例
 */
function getChunkerInstance(userId, deviceId, workspacePath, token) {
    const key = `${userId}_${deviceId}_${workspacePath}`;
    
    if (!chunkerInstances.has(key)) {
        // 🔥 加载默认配置（包含白名单和优化设置）
        const defaultConfig = loadDefaultConfig();
        
        // 合并配置：默认配置 + 运行时配置
        const config = {
            ...defaultConfig, // 🔥 首先应用default.yaml配置
            workspacePath,
            userId,
            deviceId,
            token,
            vectorManager: {
                enabled: true,
                logLevel: 'info',
                
                cache: {
                    size: defaultConfig.vectorCache?.maxSize || 200,
                    uploadThreshold: 10,
                    memoryThreshold: defaultConfig.performance?.maxMemoryUsage || 0.6,
                    persistPath: "./vector-cache",
                    cleanupInterval: 1800000
                },
                
                security: {
                    enabled: false,
                    keyPath: "./keys/vector.key"
                },
                
                embedding: {
                    timeout: 30000,
                    batchSize: defaultConfig.batchSize || 10,
                    maxRetries: 3
                },
                
                database: {
                    type: 'tencent_cloud',
                    connection: {
                        type: 'tencent',
                        host: 'http://nj-vdb-dz5mmt48.sql.tencentcdb.com',
                        port: 8100,
                        database: 'vectorservice-test',
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
                        defaultDatabase: 'vectorservice-test'
                    },
                    batchSize: defaultConfig.batchSize || 10
                }
            }
        };
        
        const chunkerInstance = new CodeChunker(config);
        chunkerInstances.set(key, chunkerInstance);
        
        return chunkerInstance;
    }
    
    return chunkerInstances.get(key);
}

/**
 * 统一签名的入口函数 - 使用缓存实例
 */
async function processWorkspace(userId, deviceId, workspacePath, token, ignorePatterns) {
    // 使用缓存的实例，确保与进度查询使用同一个实例
    const chunker = getChunkerInstance(userId, deviceId, workspacePath, token);
    
    // 执行处理
    const result = await chunker.processWorkspace(userId, deviceId, workspacePath, token, ignorePatterns);
    
    return result;
}

module.exports = {
    processWorkspace,
    getChunkerInstance,
    chunkerInstances,
    CodeChunker
}; 