/**
 * VS Code 扩展 - 智能代码分块工具
 * 
 * 命令使用示例:
 * 1. 手动搜索: vscode.commands.executeCommand('test-electron-treesitter.searchCode')
 * 2. 程序化搜索: vscode.commands.executeCommand('test-electron-treesitter.searchCode', 'function')
 * 3. 其他命令: 
 *    - 'test-electron-treesitter.chunkCode' - 开始代码分块
 *    - 'test-electron-treesitter.checkProgress' - 查看分块进度
 *    - 'test-electron-treesitter.configure' - 配置代码分块器
 */

import * as vscode from 'vscode';
import { registerChunkingCommands } from './commands/chunkingCommands';
import { registerSearchCommands } from './commands/searchCommands';

export function activate(context: vscode.ExtensionContext) {
    console.log('[CodeChunker] 扩展已激活');

    // 清除代理环境变量避免连接问题
    clearProxyEnvironment();

    // 注册所有命令
    registerChunkingCommands(context);
    registerSearchCommands(context);

    console.log('[CodeChunker] 所有命令已注册');
}

/**
 * 清除代理环境变量
 */
function clearProxyEnvironment() {
    const proxyVars = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy'];
    proxyVars.forEach(varName => {
        if (process.env[varName]) {
            console.log(`[CodeChunker] 清除代理变量: ${varName}=${process.env[varName]}`);
            delete process.env[varName];
        }
    });
    process.env.NO_PROXY = '*';
    process.env.no_proxy = '*';
    console.log('[CodeChunker] 代理环境变量已清除，避免网络连接问题');
}

export function deactivate() {
    console.log('[CodeChunker] 扩展已停用');
} 