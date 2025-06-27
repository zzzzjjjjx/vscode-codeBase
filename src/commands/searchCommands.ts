import * as vscode from 'vscode';
import { SearchService } from '../services/searchService';

let searchService: SearchService;

/**
 * 注册搜索相关的所有命令
 */
export function registerSearchCommands(context: vscode.ExtensionContext) {
    // 初始化服务
    searchService = new SearchService();

    // 注册智能代码搜索命令
    const searchCodeCommand = vscode.commands.registerCommand('test-electron-treesitter.searchCode', async (searchString?: string) => {
        try {
            await searchService.performCodeSearch(searchString);
        } catch (error) {
            console.error('[CodeChunker] 代码搜索错误:', error);
            vscode.window.showErrorMessage(`代码搜索失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // 注册配置命令
    const configureCommand = vscode.commands.registerCommand('test-electron-treesitter.configure', async () => {
        try {
            await searchService.showConfiguration();
        } catch (error) {
            console.error('[CodeChunker] 配置错误:', error);
            vscode.window.showErrorMessage(`配置失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // 注册删除Collection命令
    const deleteCollectionCommand = vscode.commands.registerCommand('test-electron-treesitter.deleteCollection', async () => {
        try {
            await searchService.deleteCloudCollection();
        } catch (error) {
            console.error('[CodeChunker] 删除Collection错误:', error);
            vscode.window.showErrorMessage(`删除Collection失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // 保留原有的 Hello World 命令
    const helloWorldCommand = vscode.commands.registerCommand('test-electron-treesitter.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from test-electron-treeSitter!');
    });

    context.subscriptions.push(searchCodeCommand, configureCommand, deleteCollectionCommand, helloWorldCommand);
    console.log('[CodeChunker] 搜索相关命令已注册');
} 