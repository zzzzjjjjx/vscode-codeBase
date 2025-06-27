import * as vscode from 'vscode';
import { ChunkingService } from '../services/chunkingService';

let chunkingService: ChunkingService;

/**
 * 注册代码分块相关的所有命令
 */
export function registerChunkingCommands(context: vscode.ExtensionContext) {
    // 初始化服务
    chunkingService = new ChunkingService();

    // 注册代码分块命令
    const chunkCodeCommand = vscode.commands.registerCommand('test-electron-treesitter.chunkCode', async () => {
        try {
            const res = await chunkingService.executeCodeChunking(context);
            return res;
        } catch (error) {
            console.error('[CodeChunker] 执行错误:', error);
            vscode.window.showErrorMessage(`代码分块执行失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // 注册进度查询命令
    const checkProgressCommand = vscode.commands.registerCommand('test-electron-treesitter.checkProgress', async () => {
        try {
            await chunkingService.checkChunkingProgress();
        } catch (error) {
            console.error('[CodeChunker] 进度查询错误:', error);
            vscode.window.showErrorMessage(`进度查询失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // 注册清除缓存命令
    const clearCacheCommand = vscode.commands.registerCommand('test-electron-treesitter.clearCache', async () => {
        try {
            await chunkingService.clearProcessingCache();
        } catch (error) {
            console.error('[CodeChunker] 清除缓存错误:', error);
            vscode.window.showErrorMessage(`清除缓存失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // 注册查看索引缓存统计命令
    const cacheStatsCommand = vscode.commands.registerCommand('test-electron-treesitter.cacheStats', async () => {
        try {
            const stats = await chunkingService.getCacheStats();
            if (stats) {
                vscode.window.showInformationMessage(
                    `索引缓存统计:\n` +
                    `- 缓存文件数: ${stats.totalFiles}\n` +
                    `- 缓存大小: ${stats.totalSize}\n` +
                    `- 最早记录: ${stats.oldestRecord ? stats.oldestRecord.toLocaleString() : '无'}\n` +
                    `- 最新记录: ${stats.newestRecord ? stats.newestRecord.toLocaleString() : '无'}`
                );
            } else {
                vscode.window.showInformationMessage('索引缓存未启用');
            }
        } catch (error) {
            console.error('[CodeChunker] 获取缓存统计失败:', error);
            vscode.window.showErrorMessage(`获取缓存统计失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // 注册清除索引缓存命令
    const clearIndexCacheCommand = vscode.commands.registerCommand('test-electron-treesitter.clearIndexCache', async () => {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('请先打开一个工作区');
                return;
            }

            const config = vscode.workspace.getConfiguration('codeChunker');
            const userId = config.get<string>('userId');
            const deviceId = config.get<string>('deviceId');

            if (!userId || !deviceId) {
                vscode.window.showErrorMessage('缺少必要的配置信息');
                return;
            }

            const confirmation = await vscode.window.showWarningMessage(
                '确定要清除当前工作区的索引缓存吗？这将导致下次处理时重新索引所有文件。',
                '确定清除',
                '取消'
            );

            if (confirmation === '确定清除') {
                const workspacePath = workspaceFolder.uri.fsPath;
                await chunkingService.clearWorkspaceIndexCache(workspacePath, userId, deviceId);
                vscode.window.showInformationMessage('索引缓存已清除');
            }
        } catch (error) {
            console.error('[CodeChunker] 清除索引缓存失败:', error);
            vscode.window.showErrorMessage(`清除索引缓存失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // 注册网络性能分析报告命令
    const networkPerformanceCommand = vscode.commands.registerCommand('test-electron-treesitter.networkPerformance', async () => {
        try {
            const report = await chunkingService.generateNetworkPerformanceReport();
            if (report) {
                vscode.window.showInformationMessage(
                    `网络性能报告已生成，详细信息请查看控制台输出。\n` +
                    `总请求数: ${report.summary.totalRequests}\n` +
                    `平均网络通信时间: ${report.performance.networkCommunicationTime.avg.toFixed(2)}ms\n` +
                    `网络时间占比: ${report.performance.networkRatio.avg.toFixed(1)}%`
                );
            } else {
                vscode.window.showInformationMessage('暂无网络性能数据，请先执行一些代码分块操作。');
            }
        } catch (error) {
            console.error('[CodeChunker] 生成网络性能报告失败:', error);
            vscode.window.showErrorMessage(`生成网络性能报告失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // 注册清除网络性能数据命令
    const clearNetworkDataCommand = vscode.commands.registerCommand('test-electron-treesitter.clearNetworkData', async () => {
        try {
            await chunkingService.clearNetworkPerformanceData();
            vscode.window.showInformationMessage('网络性能数据已清除');
        } catch (error) {
            console.error('[CodeChunker] 清除网络性能数据失败:', error);
            vscode.window.showErrorMessage(`清除网络性能数据失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    context.subscriptions.push(chunkCodeCommand, checkProgressCommand, clearCacheCommand, cacheStatsCommand, clearIndexCacheCommand, networkPerformanceCommand, clearNetworkDataCommand);
    console.log('[CodeChunker] 代码分块命令已注册');
} 