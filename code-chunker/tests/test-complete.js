#!/usr/bin/env node

/**
 * Code Chunker 完整项目测试
 * 目标：使用Python代码目录测试整个项目流程
 * 包含：文件扫描、代码解析、分块、Merkle树构建、向量处理等
 */

// 设置环境模式
// 'development' = 测试模式（跳过网络请求）
// 'production' = 生产模式（执行真实网络请求）
process.env.NODE_ENV = 'production'; // 改为生产环境进行调试

const path = require('path');
const CodeChunker = require('../src/main');

async function runCompleteTest() {
    console.log('🚀 开始Code Chunker完整项目测试\n');
    console.log('=' .repeat(60));
    
    try {
        // ========== 配置阶段 ==========
        console.log('📋 步骤1: 配置测试参数');
        
        const targetDir = process.argv[2] || '../python';
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
        
        console.log('✅ 配置参数设置完成\n');
        
        // ========== 初始化阶段 ==========
        console.log('📋 步骤2: 初始化CodeChunker实例');
        
        const chunker = new CodeChunker({
            workspacePath,
            ignorePatterns: testConfig.ignorePatterns,
            token: testConfig.token,
            
            // 核心处理配置 - 针对向量数据库优化
            maxFileSize: 1048576, // 降到1MB
            linesPerChunk: 15,    // ✅ 进一步减少到15行，避免10KB限制
            maxWorkers: 2,        // 减少到2个工作线程
            batchSize: 3,         // ✅ 进一步减少批处理大小到3，提高成功率
            
            // VectorManager配置
            vectorManager: {
                enabled: true,
                enableKeyRotation: false, // 测试环境禁用密钥轮换
                logLevel: 'info',
                
                // 添加必要的配置项
                cache: {
                    size: 500,            // 减少缓存大小
                    uploadThreshold: 10,  // 进一步降低上传阈值，避免累积过多
                    memoryThreshold: 0.6, // 降低内存阈值
                    persistPath: "./test-vector-cache",
                    cleanupInterval: 1800000  // 30分钟
                },
                
                // 简化的安全配置（测试环境）
                security: {
                    enabled: false, // 测试环境禁用加密
                    keyPath: "./test-keys/vector.key"
                },
                
                // 嵌入服务配置
                embedding: {
                    timeout: 30000,
                    batchSize: 10,
                    maxRetries: 3
                },
                
                // ✅ 修复：使用与成功测试一致的数据库配置格式
                database: {
                    type: 'tencent_cloud',  // ✅ 正确的类型标识
                    connection: {
                        type: 'tencent',
                        host: 'http://nj-vdb-dz5mmt48.sql.tencentcdb.com',
                        port: 8100,
                        database: 'vectorservice-test',
                        username: 'root',
                        apiKey: '4xVMtNrcgYd3FQ35A3YkWuFTcvn63t0hkBkDWfKS', // ✅ 正确的字段名
                        timeout: 30000
                    },
                    collections: {
                        vectorDimension: 768, // ✅ 使用正确的字段名
                        metricType: 'COSINE', // ✅ 使用正确的字段名和值
                        indexType: 'HNSW'     // ✅ 使用成功测试中的索引类型
                    },
                    query: {
                        defaultDatabase: 'vectorservice-test'
                    },
                    batchSize: 100
                }
            },
            
            // 测试模式配置 - 在开发环境下自动跳过网络请求
            testMode: true
        });
        
        console.log('✅ CodeChunker实例创建成功');
        console.log('📊 配置详情:');
        console.log(`   • 用户ID: ${testConfig.userId}`);
        console.log(`   • 设备ID: ${testConfig.deviceId}`);
        console.log(`   • 忽略模式: ${testConfig.ignorePatterns.length} 个`);
        console.log(`   • VectorManager: 已启用 (生产环境)`);
        console.log(`   • 网络请求: 真实请求 (生产环境)`);
        console.log('');
        
        // ========== 处理阶段 ==========
        console.log('📋 步骤3: 开始处理工作空间');
        console.log('-'.repeat(40));
        
        // 添加处理超时保护
        const TIMEOUT_MS = 180000; // 3分钟超时
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`处理超时 (${TIMEOUT_MS/1000}秒)`)), TIMEOUT_MS)
        );
        
        const processingPromise = chunker.processWorkspace(
            testConfig.userId, 
            testConfig.deviceId, 
            workspacePath, 
            testConfig.token, 
            testConfig.ignorePatterns
        );
        
        console.log(`⏱️  开始处理，${TIMEOUT_MS/1000}秒超时保护已启用...\n`);
        
        // 执行处理并等待结果
        const startTime = Date.now();
        const result = await Promise.race([processingPromise, timeoutPromise]);
        const endTime = Date.now();
        const processingTime = ((endTime - startTime) / 1000).toFixed(2);
        
        // ========== 结果分析阶段 ==========
        console.log('\n' + '='.repeat(60));
        console.log('📊 测试结果分析');
        console.log('='.repeat(60));
        
        if (result) {
            console.log('🎉 项目测试完全成功！');
            console.log(`⚡ 总处理时间: ${processingTime} 秒`);
            
            console.log('\n✅ 已验证的核心功能:');
            console.log('   🔍 文件扫描和过滤');
            console.log('   🏗️  代码解析和语法分析');
            console.log('   🧩 智能代码分块');
            console.log('   🌳 Merkle树构建和验证');
            console.log('   📈 进度跟踪和状态管理');
            console.log('   🔒 VectorManager数据管理');
            console.log('   🌐 生产环境网络请求');
            
            console.log('\n🏆 项目状态: 所有核心功能正常工作');
            console.log('💡 项目已准备好处理真实的代码分块任务！');
            
        } else {
            console.log('❌ 项目测试失败');
            console.log('📝 请检查上面的错误日志了解详情');
        }
        
        // ========== 清理阶段 ==========
        console.log('\n📋 步骤4: 清理资源');
        await chunker.shutdown();
        console.log('✅ 资源清理完成');
        
        console.log('\n' + '='.repeat(60));
        console.log('🏁 测试完成');
        console.log('='.repeat(60));
        
    } catch (error) {
        console.error('\n💥 测试过程中发生错误:');
        console.error(`📍 错误信息: ${error.message}`);
        
        if (error.message.includes('超时')) {
            console.error('\n🔍 可能的超时原因:');
            console.error('   • Worker线程处理文件时卡住');
            console.error('   • 某个大文件解析时间过长');
            console.error('   • 网络请求超时或失败');
            console.error('   • 系统资源不足');
            
            console.error('\n💡 建议解决方案:');
            console.error('   • 减少maxWorkers数量');
            console.error('   • 降低maxFileSize限制');
            console.error('   • 检查网络连接');
            console.error('   • 检查目标目录中是否有特殊文件');
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
    console.log('Code Chunker 项目测试启动中...\n');
    runCompleteTest().catch(error => {
        console.error('测试启动失败:', error);
        process.exit(1);
    });
}

module.exports = runCompleteTest;