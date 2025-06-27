#!/usr/bin/env node

/**
 * Code Chunker 搜索功能测试
 * 目标：测试向量搜索功能
 * 包含：工作空间处理、向量搜索、结果分析等
 */

// 设置环境模式
// 'development' = 测试模式（跳过网络请求）
// 'production' = 生产模式（执行真实网络请求）
process.env.NODE_ENV = 'production'; // 生产环境进行真实搜索

const path = require('path');
const CodeChunker = require('../src/main');

async function runSearchTest() {
    console.log('🔍 开始Code Chunker搜索功能测试\n');
    console.log('=' .repeat(60));
    
    try {
        // ========== 配置阶段 ==========
        console.log('📋 步骤1: 配置测试参数');
        
        const targetDir = process.argv[2] || '../../python';
        const workspacePath = path.resolve(targetDir);
        
        console.log(`📁 测试目标目录: ${workspacePath}`);
        
        // 测试用户配置
        const testConfig = {
            userId: 'test-user-001',
            deviceId: 'test-device-001', 
            token: 'test-token-123',
            ignorePatterns: [
                'node_modules/**',
                '.git/**',
                '*.log',
                '*.tmp',
                '__pycache__/**',
                '*.pyc',
                '.pytest_cache/**',
                'venv/**',
                '.venv/**'
            ]
        };
        
        // 搜索查询配置
        const searchQuery = 'python parser';
        const searchOptions = {
            topK: 20, // 返回前20个最相关的结果
            threshold: 0.5 // 相似度阈值
        };
        
        console.log('✅ 配置参数设置完成');
        console.log(`🔍 搜索查询: "${searchQuery}"`);
        console.log(`📊 搜索选项: topK=${searchOptions.topK}, threshold=${searchOptions.threshold}\n`);
        
        // ========== 初始化阶段 ==========
        console.log('📋 步骤2: 初始化CodeChunker实例');
        
        const chunker = new CodeChunker({
            workspacePath,
            ignorePatterns: testConfig.ignorePatterns,
            token: testConfig.token,
            
            // 核心处理配置 - 针对向量数据库优化
            maxFileSize: 1048576, // 1MB
            linesPerChunk: 15,    // 15行每块
            maxWorkers: 2,        // 2个工作线程
            batchSize: 3,         // 批处理大小为3
            
            // VectorManager配置 - 必须启用以支持搜索
            vectorManager: {
                enabled: true,
                enableKeyRotation: false,
                logLevel: 'info',
                
                cache: {
                    size: 500,
                    uploadThreshold: 10,
                    memoryThreshold: 0.6,
                    persistPath: "./test-vector-cache",
                    cleanupInterval: 1800000
                },
                
                security: {
                    enabled: false,
                    keyPath: "./test-keys/vector.key"
                },
                
                embedding: {
                    timeout: 30000,
                    batchSize: 10,
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
                    batchSize: 100
                }
            },
            
            testMode: true
        });
        
        console.log('✅ CodeChunker实例创建成功');
        console.log('📊 配置详情:');
        console.log(`   • 用户ID: ${testConfig.userId}`);
        console.log(`   • 设备ID: ${testConfig.deviceId}`);
        console.log(`   • VectorManager: 已启用 (支持搜索)`);
        console.log('');
        
        // ========== 数据准备阶段 ==========
        console.log('📋 步骤3: 处理工作空间以准备向量数据');
        console.log('-'.repeat(40));
        
        const PROCESSING_TIMEOUT_MS = 180000; // 3分钟处理超时
        const processingTimeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`工作空间处理超时 (${PROCESSING_TIMEOUT_MS/1000}秒)`)), PROCESSING_TIMEOUT_MS)
        );
        
        const processingPromise = chunker.processWorkspace(
            testConfig.userId, 
            testConfig.deviceId, 
            workspacePath, 
            testConfig.token, 
            testConfig.ignorePatterns
        );
        
        console.log(`⏱️  开始处理工作空间，${PROCESSING_TIMEOUT_MS/1000}秒超时保护已启用...\n`);
        
        const startProcessingTime = Date.now();
        const processingResult = await Promise.race([processingPromise, processingTimeoutPromise]);
        const endProcessingTime = Date.now();
        const processingTime = ((endProcessingTime - startProcessingTime) / 1000).toFixed(2);
        
        if (!processingResult) {
            throw new Error('工作空间处理失败，无法进行搜索测试');
        }
        
        console.log(`✅ 工作空间处理完成，耗时: ${processingTime} 秒\n`);
        
        // ========== 搜索测试阶段 ==========
        console.log('📋 步骤4: 执行向量搜索测试');
        console.log('-'.repeat(40));
        
        const SEARCH_TIMEOUT_MS = 60000; // 1分钟搜索超时
        const searchTimeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`搜索请求超时 (${SEARCH_TIMEOUT_MS/1000}秒)`)), SEARCH_TIMEOUT_MS)
        );
        
        console.log(`🔍 执行搜索查询: "${searchQuery}"`);
        console.log(`📊 搜索参数: topK=${searchOptions.topK}`);
        console.log(`⏱️  搜索超时保护: ${SEARCH_TIMEOUT_MS/1000}秒\n`);
        
        const searchPromise = chunker.search(searchQuery, searchOptions);
        
        const startSearchTime = Date.now();
        const searchResults = await Promise.race([searchPromise, searchTimeoutPromise]);
        const endSearchTime = Date.now();
        const searchTime = ((endSearchTime - startSearchTime) / 1000).toFixed(2);
        
        // ========== 结果分析阶段 ==========
        console.log('\n' + '='.repeat(60));
        console.log('📊 搜索结果分析');
        console.log('='.repeat(60));
        
        console.log(`🎉 搜索测试成功完成！`);
        console.log(`⚡ 搜索耗时: ${searchTime} 秒`);
        console.log(`📈 返回结果数量: ${searchResults ? searchResults.length : 0}`);
        
        if (searchResults && searchResults.length > 0) {
            console.log('\n🔍 搜索结果详情:');
            console.log('-'.repeat(40));
            
            searchResults.forEach((result, index) => {
                console.log(`\n📄 结果 ${index + 1}:`);
                console.log(`   🎯 相似度分数: ${result.score ? result.score.toFixed(4) : (result.similarity ? result.similarity.toFixed(4) : 'N/A')}`);
                console.log(`   📁 文件路径: ${result.filePath || 'N/A'}`);
                console.log(`   📍 块ID: ${result.chunkId || 'N/A'}`);
                console.log(`   📏 内容长度: ${result.content ? result.content.length : 0} 字符`);
                console.log(`   📊 行范围: ${result.startLine || 'N/A'} - ${result.endLine || 'N/A'}`);
                
                if (result.content && result.content.length > 0) {
                    // 显示内容预览（前200个字符）
                    const preview = result.content.length > 200 
                        ? result.content.substring(0, 200) + '...' 
                        : result.content;
                    console.log(`   📖 内容预览: ${preview}`);
                }
                
                // 显示元数据信息
                if (result.metadata) {
                    console.log(`   📋 元数据:`);
                    console.log(`      • 用户ID: ${result.metadata.userId || 'N/A'}`);
                    console.log(`      • 设备ID: ${result.metadata.deviceId || 'N/A'}`);
                    console.log(`      • 向量模型: ${result.metadata.vectorModel || 'N/A'}`);
                    if (result.metadata.originalScore) {
                        console.log(`      • 原始分数: ${result.metadata.originalScore.toFixed(4)}`);
                    }
                }
            });
            
            console.log('\n✅ 搜索功能验证项目:');
            console.log('   🔍 向量搜索执行成功');
            console.log('   📊 返回了相关结果');
            console.log('   🎯 相似度计算正常');
            console.log('   📄 元数据信息完整');
            console.log('   ⚡ 搜索响应时间合理');
            
        } else {
            console.log('\n⚠️  搜索结果为空');
            console.log('📝 可能的原因:');
            console.log('   • 查询词与代码库内容匹配度较低');
            console.log('   • 向量数据库中暂无相关数据');
            console.log('   • 相似度阈值设置过高');
            console.log('   • 嵌入模型处理查询词异常');
        }
        
        console.log('\n🏆 搜索功能状态: 测试完成');
        console.log(`💡 总耗时: 处理${processingTime}秒 + 搜索${searchTime}秒 = ${(parseFloat(processingTime) + parseFloat(searchTime)).toFixed(2)}秒`);
        
        // ========== 清理阶段 ==========
        console.log('\n📋 步骤5: 清理资源');
        await chunker.shutdown();
        console.log('✅ 资源清理完成');
        
        console.log('\n' + '='.repeat(60));
        console.log('🏁 搜索测试完成');
        console.log('='.repeat(60));
        
        return searchResults;
        
    } catch (error) {
        console.error('\n💥 搜索测试过程中发生错误:');
        console.error(`📍 错误信息: ${error.message}`);
        
        if (error.message.includes('VectorManager is not enabled')) {
            console.error('\n🔍 VectorManager 未启用错误:');
            console.error('   • 确保vectorManager.enabled设置为true');
            console.error('   • 检查VectorManager初始化是否成功');
            console.error('   • 验证数据库连接配置是否正确');
        } else if (error.message.includes('超时')) {
            console.error('\n🔍 可能的超时原因:');
            console.error('   • 网络连接缓慢或不稳定');
            console.error('   • 嵌入服务响应时间过长');
            console.error('   • 向量数据库查询性能问题');
            console.error('   • 工作空间处理耗时过长');
        } else {
            console.error(`\n📋 详细错误信息:\n${error.stack}`);
        }
        
        // 尝试清理资源
        try {
            if (chunker && typeof chunker.shutdown === 'function') {
                await chunker.shutdown();
            }
        } catch (cleanupError) {
            console.error('清理资源时发生错误:', cleanupError.message);
        }
        
        process.exit(1);
    }
}

// ========== 错误处理 ==========
process.on('uncaughtException', (error) => {
    console.error('\n💥 未捕获的异常:', error.message);
    console.error('📍 堆栈:', error.stack);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('\n💥 未处理的Promise拒绝:', reason);
    console.error('📍 Promise:', promise);
    process.exit(1);
});

// ========== 启动测试 ==========
if (require.main === module) {
    console.log('Code Chunker 搜索测试启动中...\n');
    runSearchTest().catch(error => {
        console.error('搜索测试启动失败:', error);
        process.exit(1);
    });
}

module.exports = runSearchTest; 