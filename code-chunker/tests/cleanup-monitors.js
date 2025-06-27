#!/usr/bin/env node

/**
 * 清理所有活跃的工作空间监控实例
 * 用于测试后的清理工作
 */

const axios = require('axios');

const API_BASE_URL = 'http://localhost:3000';

async function cleanupAllMonitors() {
    console.log('🧹 清理所有活跃的工作空间监控实例\n');
    
    try {
        // 检查API服务器
        console.log('🔍 检查API服务器状态...');
        await axios.get(`${API_BASE_URL}/health`, { timeout: 5000 });
        console.log('✅ API服务器正常\n');
        
        // 获取所有活跃监控
        console.log('📊 查询所有活跃监控...');
        const monitorsResponse = await axios.get(`${API_BASE_URL}/api/workspace-monitors`);
        
        const monitors = monitorsResponse.data.monitors || [];
        console.log(`📈 找到 ${monitors.length} 个活跃监控\n`);
        
        if (monitors.length === 0) {
            console.log('✅ 没有活跃监控需要清理');
            return;
        }
        
        // 逐个停止监控
        let successCount = 0;
        let failureCount = 0;
        
        for (let i = 0; i < monitors.length; i++) {
            const monitor = monitors[i];
            console.log(`🛑 停止监控 ${i + 1}/${monitors.length}:`);
            console.log(`   Key: ${monitor.workspaceKey}`);
            console.log(`   用户: ${monitor.userId}`);
            console.log(`   设备: ${monitor.deviceId}`);
            console.log(`   路径: ${monitor.workspacePath}`);
            
            try {
                const stopResponse = await axios.post(`${API_BASE_URL}/api/stop-workspace-monitor`, {
                    userId: monitor.userId,
                    deviceId: monitor.deviceId,
                    workspacePath: monitor.workspacePath
                });
                
                if (stopResponse.data.stopped) {
                    console.log(`   ✅ 停止成功`);
                    successCount++;
                } else {
                    console.log(`   ⚠️  停止失败: ${stopResponse.data.message}`);
                    failureCount++;
                }
            } catch (error) {
                console.log(`   ❌ 停止出错: ${error.message}`);
                failureCount++;
            }
            console.log('');
        }
        
        // 最终检查
        console.log('🔍 最终状态检查...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const finalCheck = await axios.get(`${API_BASE_URL}/api/workspace-monitors`);
        const remainingCount = finalCheck.data.count || 0;
        
        console.log('📋 清理结果汇总:');
        console.log(`   ✅ 成功停止: ${successCount}`);
        console.log(`   ❌ 停止失败: ${failureCount}`);
        console.log(`   📊 剩余监控: ${remainingCount}`);
        
        if (remainingCount === 0) {
            console.log('\n🎉 所有监控实例已成功清理！');
        } else {
            console.log('\n⚠️  仍有监控实例未清理，可能需要重启服务器');
            if (finalCheck.data.monitors) {
                console.log('   剩余监控:');
                finalCheck.data.monitors.forEach((monitor, index) => {
                    console.log(`     ${index + 1}. ${monitor.workspaceKey}`);
                });
            }
        }
        
    } catch (error) {
        console.error('💥 清理过程中发生错误:', error.message);
        
        if (error.message.includes('ECONNREFUSED')) {
            console.error('\n❗ 服务器连接失败:');
            console.error('   请确保服务器已启动: npm start');
        }
        
        process.exit(1);
    }
}

if (require.main === module) {
    cleanupAllMonitors().then(() => {
        console.log('\n🏁 清理完成');
        process.exit(0);
    });
}

module.exports = cleanupAllMonitors; 