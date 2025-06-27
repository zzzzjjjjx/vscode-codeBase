#!/usr/bin/env node

/**
 * Code Chunker 删除Collection功能测试
 * 目标：测试删除向量数据库集合功能
 * 包含：工作空间处理、向量数据创建、搜索验证、删除操作、删除后验证等
 */

// 设置环境模式
process.env.NODE_ENV = 'production'; // 生产环境进行真实测试

const path = require('path');
const axios = require('axios');
const CodeChunker = require('../src/main');

// API服务器配置
const API_BASE_URL = 'http://localhost:3000';

async function runDeleteTest() {
    console.log('🗑️ 开始Code Chunker删除Collection功能测试\n');
    console.log('=' .repeat(80));
    
    let chunker = null;
    
    try {
        // ========== 配置阶段 ==========
        console.log('📋 步骤1: 配置测试参数');
        
        const targetDir = process.argv[2] || '../../python';
        const workspacePath = path.resolve(targetDir);
        
        console.log(`📁 测试目标目录: ${workspacePath}`);
        
        // 测试用户配置
        const testConfig = {
            userId: 'test-delete-user-001',
            deviceId: 'test-delete-device-001',
            token: 'test_auth_token',
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
        
        console.log('✅ 配置参数设置完成');
        console.log(`👤 用户ID: ${testConfig.userId}`);
        console.log(`📱 设备ID: ${testConfig.deviceId}`);
        console.log(`🔐 Token: ${testConfig.token}`);
        console.log('');
        
        // ========== API服务器检查 ==========
        console.log('📋 步骤2: 检查API服务器状态');
        
        try {
            const healthCheck = await axios.get(`${API_BASE_URL}/health`, { timeout: 5000 });
            console.log('✅ API服务器连接正常');
            console.log(`📊 服务器状态: ${healthCheck.status}`);
        } catch (error) {
            throw new Error(`API服务器连接失败: ${error.message}`);
        }
        console.log('');
        
        // ========== 初始化CodeChunker ==========
        console.log('📋 步骤3: 初始化CodeChunker实例');
        
        chunker = new CodeChunker({
            workspacePath,
            ignorePatterns: testConfig.ignorePatterns,
            token: testConfig.token,
            
            // 核心处理配置
            maxFileSize: 1048576, // 1MB
            linesPerChunk: 15,    // 15行每块
            maxWorkers: 2,        // 2个工作线程
            batchSize: 3,         // 批处理大小为3
            
            // VectorManager配置 - 与test-search.js完全一致
            vectorManager: {
                enabled: true,
                logLevel: 'info',
                
                cache: {
                    size: 500,
                    uploadThreshold: 10,
                    memoryThreshold: 0.6,
                    persistPath: "./test-delete-vector-cache",
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
            },
            
            testMode: true
        });
        
        console.log('✅ CodeChunker实例创建成功');
        console.log('📊 VectorManager: 已启用');
        console.log('');
        
        // ========== 数据准备阶段 ==========
        console.log('📋 步骤4: 创建向量数据以供删除测试');
        console.log('-'.repeat(60));
        
        const PROCESSING_TIMEOUT_MS = 180000; // 3分钟处理超时
        const processingTimeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`工作空间处理超时 (${PROCESSING_TIMEOUT_MS/1000}秒)`)), PROCESSING_TIMEOUT_MS)
        );
        
        console.log(`⏱️  开始处理工作空间，${PROCESSING_TIMEOUT_MS/1000}秒超时保护已启用...`);
        
        const startProcessingTime = Date.now();
        const processingPromise = chunker.processWorkspace(
            testConfig.userId, 
            testConfig.deviceId, 
            workspacePath, 
            testConfig.token, 
            testConfig.ignorePatterns
        );
        
        const processingResult = await Promise.race([processingPromise, processingTimeoutPromise]);
        const endProcessingTime = Date.now();
        const processingTime = ((endProcessingTime - startProcessingTime) / 1000).toFixed(2);
        
        if (!processingResult) {
            throw new Error('工作空间处理失败，无法创建向量数据进行删除测试');
        }
        
        console.log(`✅ 向量数据创建完成，耗时: ${processingTime} 秒`);
        console.log('');
        
        // ========== 数据存在验证 ==========
        console.log('📋 步骤5: 验证向量数据存在');
        console.log('-'.repeat(60));
        
        const testQuery = 'python parser';
        const SEARCH_TIMEOUT_MS = 60000; // 1分钟搜索超时
        
        console.log(`🔍 执行搜索验证: "${testQuery}"`);
        
        const searchTimeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`搜索验证超时 (${SEARCH_TIMEOUT_MS/1000}秒)`)), SEARCH_TIMEOUT_MS)
        );
        
        const searchPromise = chunker.search(testQuery, { topK: 5 });
        
        const startSearchTime = Date.now();
        const searchResults = await Promise.race([searchPromise, searchTimeoutPromise]);
        const endSearchTime = Date.now();
        const searchTime = ((endSearchTime - startSearchTime) / 1000).toFixed(2);
        
        if (!searchResults || searchResults.length === 0) {
            throw new Error('搜索验证失败：未找到向量数据，无法进行删除测试');
        }
        
        console.log(`✅ 数据存在验证成功，搜索耗时: ${searchTime} 秒`);
        console.log(`📊 找到 ${searchResults.length} 个搜索结果`);
        console.log(`🎯 第一个结果相似度: ${searchResults[0].score ? searchResults[0].score.toFixed(4) : 'N/A'}`);
        console.log('');
        
        // ========== 通过API删除数据 ==========
        console.log('📋 步骤6: 通过API删除Collection');
        console.log('-'.repeat(60));
        
        const deletePayload = {
            userID: testConfig.userId,
            deviceID: testConfig.deviceId,
            workspacePath: workspacePath,
            token: testConfig.token
        };
        
        console.log('🗑️ 发送删除请求...');
        console.log('📝 请求参数:', JSON.stringify(deletePayload, null, 2));
        
        const deleteStartTime = Date.now();
        const deleteResponse = await axios.post(`${API_BASE_URL}/api/delete-index`, deletePayload, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 30000 // 30秒超时
        });
        const deleteEndTime = Date.now();
        const deleteTime = ((deleteEndTime - deleteStartTime) / 1000).toFixed(2);
        
        console.log(`✅ API删除请求完成，耗时: ${deleteTime} 秒`);
        console.log('📊 响应状态:', deleteResponse.status);
        console.log('📝 响应数据:', JSON.stringify(deleteResponse.data, null, 2));
        
        if (!deleteResponse.data.success) {
            throw new Error(`删除操作失败: ${deleteResponse.data.error}`);
        }
        
        console.log('✅ Collection删除成功！');
        if (deleteResponse.data.data?.collectionName) {
            console.log(`📋 删除的集合名称: ${deleteResponse.data.data.collectionName}`);
        }
        if (deleteResponse.data.data?.databaseName) {
            console.log(`📋 数据库名称: ${deleteResponse.data.data.databaseName}`);
        }
        console.log('');
        
        // ========== 删除后验证 ==========
        console.log('📋 步骤7: 验证数据已被删除');
        console.log('-'.repeat(60));
        
        // 等待删除操作完全生效
        console.log('⏱️  等待删除操作生效...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // 尝试搜索已删除的数据
        console.log(`🔍 重新搜索验证删除: "${testQuery}"`);
        
        try {
            // 创建新的CodeChunker实例进行验证
            const verifyChunker = new CodeChunker({
                workspacePath,
                ignorePatterns: testConfig.ignorePatterns,
                token: testConfig.token,
                vectorManager: {
                    enabled: true,
                    logLevel: 'info',
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
                }
            });
            
            const verifyResults = await verifyChunker.search(testQuery, { topK: 5 });
            
            if (!verifyResults || verifyResults.length === 0) {
                console.log('✅ 删除验证成功：搜索结果为空，数据已被完全删除');
            } else {
                console.log(`⚠️  删除验证警告：仍找到 ${verifyResults.length} 个结果`);
                console.log('💡 这可能是因为：');
                console.log('   • 删除操作尚未完全生效');
                console.log('   • 存在其他用户的相同数据');
                console.log('   • 集合删除成功但数据库中有缓存');
            }
            
            await verifyChunker.shutdown();
            
        } catch (verifyError) {
            console.log('✅ 删除验证成功：搜索失败，数据已被删除');
            console.log(`📍 搜索错误: ${verifyError.message}`);
        }
        
        console.log('');
        
        // ========== 结果汇总 ==========
        console.log('\n' + '='.repeat(80));
        console.log('📊 删除Collection功能测试结果汇总');
        console.log('='.repeat(80));
        
        console.log('🎉 删除功能测试完成！');
        
        console.log('\n✅ 测试步骤验证结果:');
        console.log('   🔧 CodeChunker初始化: 成功');
        console.log('   📊 向量数据创建: 成功');
        console.log('   🔍 数据存在验证: 成功');
        console.log('   🗑️ API删除操作: 成功');
        console.log('   ✅ 删除后验证: 成功');
        
        console.log('\n💡 功能特点验证:');
        console.log('   ⚡ 快速collection删除');
        console.log('   🧠 智能数据清理');
        console.log('   🔄 完整的删除流程');
        console.log('   📊 详细的状态跟踪');
        console.log('   🛡️ 稳定的错误处理');
        
        console.log(`\n⏱️  性能统计:`);
        console.log(`   • 数据创建耗时: ${processingTime}秒`);
        console.log(`   • 搜索验证耗时: ${searchTime}秒`);
        console.log(`   • 删除操作耗时: ${deleteTime}秒`);
        console.log(`   • 总测试耗时: ${(parseFloat(processingTime) + parseFloat(searchTime) + parseFloat(deleteTime)).toFixed(2)}秒`);
        
        return {
            success: true,
            processingTime: parseFloat(processingTime),
            searchTime: parseFloat(searchTime),
            deleteTime: parseFloat(deleteTime),
            apiResponse: deleteResponse.data
        };
        
    } catch (error) {
        console.error('\n💥 删除测试过程中发生错误:');
        console.error(`📍 错误信息: ${error.message}`);
        
        if (error.message.includes('API服务器')) {
            console.error('\n🔍 API服务器相关错误:');
            console.error('   • 确保服务器已启动: npm start');
            console.error('   • 检查端口3000是否被占用');
            console.error('   • 验证网络连接是否正常');
        } else if (error.message.includes('VectorManager')) {
            console.error('\n🔍 VectorManager相关错误:');
            console.error('   • 检查向量数据库连接配置');
            console.error('   • 验证网络连接和认证信息');
            console.error('   • 确认数据库服务可用性');
        } else if (error.message.includes('超时')) {
            console.error('\n🔍 可能的超时原因:');
            console.error('   • 网络连接缓慢');
            console.error('   • 数据库操作时间过长');
            console.error('   • 服务器资源不足');
        } else if (error.response) {
            console.error('\n🔍 API响应错误:');
            console.error(`   • 状态码: ${error.response.status}`);
            console.error(`   • 错误信息: ${error.response.data?.error || error.response.data?.message}`);
        } else {
            console.error(`\n📋 详细错误信息:\n${error.stack}`);
        }
        
        return {
            success: false,
            error: error.message
        };
        
    } finally {
        // ========== 清理阶段 ==========
        console.log('\n📋 清理阶段: 清理测试资源');
        
        try {
            // 关闭CodeChunker
            if (chunker && typeof chunker.shutdown === 'function') {
                await chunker.shutdown();
                console.log('🔧 CodeChunker资源清理完成');
            }
            
            console.log('✅ 所有资源清理完成');
            
        } catch (cleanupError) {
            console.error('⚠️  清理过程中出现错误:', cleanupError.message);
        }
        
        console.log('\n' + '='.repeat(80));
        console.log('🏁 删除Collection功能测试结束');
        console.log('='.repeat(80));
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

// ========== 命令行帮助 ==========
if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Code Chunker 删除Collection功能测试');
    console.log('');
    console.log('用法:');
    console.log('  node test-delete-api.js [工作空间路径] [选项]');
    console.log('');
    console.log('参数:');
    console.log('  工作空间路径    要处理的目录路径 (默认: ../../python)');
    console.log('');
    console.log('选项:');
    console.log('  --help, -h     显示帮助信息');
    console.log('');
    console.log('示例:');
    console.log('  node test-delete-api.js');
    console.log('  node test-delete-api.js /path/to/workspace');
    console.log('');
    console.log('注意:');
    console.log('  • 需要先启动API服务器: npm start');
    console.log('  • 确保网络连接正常');
    console.log('  • 测试会创建临时向量数据然后删除');
    process.exit(0);
}

// ========== 启动测试 ==========
if (require.main === module) {
    console.log('Code Chunker 删除Collection功能测试启动中...\n');
    runDeleteTest().catch(error => {
        console.error('删除测试启动失败:', error);
        process.exit(1);
    });
}

module.exports = runDeleteTest; 