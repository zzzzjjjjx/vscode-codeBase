import * as vscode from 'vscode';
import * as path from 'path';
import type { CodeChunkerModule } from '../types';
import { SearchResultView } from '../views/searchResultView';
import { CommonViews } from '../views/commonViews';

// 导入 code-chunker 模块
const codeChunker: CodeChunkerModule = require('../../code-chunker/index.js');

export class SearchService {

    /**
     * 执行智能代码搜索
     */
    async performCodeSearch(searchString?: string) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('请先打开一个工作区');
            return "请先打开一个工作区";
        }

        // 获取配置
        const config = vscode.workspace.getConfiguration('codeChunker');
        const userId = config.get<string>('userId');
        const deviceId = config.get<string>('deviceId');
        const token = config.get<string>('token');

        // 检查必要的配置
        if (!userId || !deviceId || !token) {
            const result = await vscode.window.showErrorMessage(
                '缺少必要的配置信息（用户ID、设备ID或Token），是否现在配置？',
                '去配置',
                '取消'
            );
            if (result === '去配置') {
                await this.showConfiguration();
            }
            return;
        }

        // 获取搜索查询 - 支持传入参数或弹出输入框
        let searchQuery: string;
        
        if (searchString && searchString.trim().length > 0) {
            // 使用传入的搜索字符串
            searchQuery = searchString.trim();
            
            // 验证传入的搜索字符串
            if (searchQuery.length < 2) {
                vscode.window.showErrorMessage('搜索关键词至少需要2个字符');
                return;
            }
        } else {
            // 没有传入参数，显示输入框
            const inputResult = await vscode.window.showInputBox({
                prompt: '请输入搜索关键词',
                placeHolder: '例如: function, class, import, 等...',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return '搜索关键词不能为空';
                    }
                    if (value.trim().length < 2) {
                        return '搜索关键词至少需要2个字符';
                    }
                    return null;
                }
            });

            if (!inputResult) {
                return; // 用户取消了输入
            }
            
            searchQuery = inputResult.trim();
        }

        const workspacePath = workspaceFolder.uri.fsPath;
        const workspaceName = path.basename(workspacePath);

        // 显示搜索进度
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: '智能代码搜索中...',
            cancellable: false
        }, async (progress) => {
            try {
                progress.report({ increment: 0, message: '初始化搜索环境...' });

                // 获取chunker实例
                const chunkerInstance = codeChunker.getChunkerInstance(userId, deviceId, workspacePath, token);
                
                progress.report({ increment: 20, message: '连接向量数据库...' });

                // 确保VectorManager已初始化
                if (!chunkerInstance.vectorManager) {
                    throw new Error('VectorManager未初始化，请先运行代码分块处理');
                }

                await chunkerInstance.vectorManager.initialize();

                if (!chunkerInstance.vectorManager.vectorDB || !chunkerInstance.vectorManager.vectorDB.implementation) {
                    throw new Error('向量数据库连接失败，请检查配置或先运行代码分块');
                }

                progress.report({ increment: 40, message: '执行向量搜索...' });

                // 执行搜索
                if (!chunkerInstance.search || typeof chunkerInstance.search !== 'function') {
                    throw new Error('搜索功能未可用，请先运行代码分块处理');
                }
                
                const searchResults = await chunkerInstance.search(searchQuery, { topK: 10 });

                progress.report({ increment: 80, message: '处理搜索结果...' });

                if (!searchResults || searchResults.length === 0) {
                    vscode.window.showInformationMessage(`未找到与"${searchQuery}"相关的代码片段`);
                    return;
                }

                progress.report({ increment: 100, message: '搜索完成！' });

                // 显示搜索结果
                await SearchResultView.displaySearchResults(searchQuery, searchResults, workspaceName);

            } catch (error) {
                console.error('[CodeChunker] 搜索失败:', error);
                vscode.window.showErrorMessage(`搜索失败: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
    }

    /**
     * 显示配置界面
     */
    async showConfiguration() {
        return await CommonViews.showConfiguration();
    }

    /**
     * 删除云端Collection
     */
    async deleteCloudCollection() {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('请先打开一个工作区');
            return;
        }

        // 获取配置
        const config = vscode.workspace.getConfiguration('codeChunker');
        const userId = config.get<string>('userId');
        const deviceId = config.get<string>('deviceId');
        const token = config.get<string>('token');

        // 检查必要的配置
        if (!userId || !deviceId || !token) {
            vscode.window.showErrorMessage('缺少必要的配置信息（用户ID、设备ID或Token），请先配置');
            return;
        }

        const workspacePath = workspaceFolder.uri.fsPath;
        const workspaceName = path.basename(workspacePath);

        // 确认删除
        const confirmation = await vscode.window.showWarningMessage(
            `确定要删除工作区 "${workspaceName}" 在云端的向量数据吗？\n\n此操作不可撤销！`,
            { modal: true },
            '确定删除',
            '取消'
        );

        if (confirmation !== '确定删除') {
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: '删除云端Collection...',
            cancellable: false
        }, async (progress) => {
            try {
                progress.report({ increment: 0, message: '连接向量数据库...' });

                // 获取chunker实例
                const chunkerInstance = codeChunker.getChunkerInstance(userId, deviceId, workspacePath, token);

                if (!chunkerInstance.vectorManager) {
                    throw new Error('VectorManager未初始化');
                }

                await chunkerInstance.vectorManager.initialize();

                if (!chunkerInstance.vectorManager.vectorDB || !chunkerInstance.vectorManager.vectorDB.implementation) {
                    throw new Error('向量数据库连接失败');
                }

                progress.report({ increment: 30, message: '生成Collection名称...' });

                // 生成collection名称
                const crypto = require('crypto');
                const hasher = crypto.createHash('sha256');
                hasher.update(`${userId}_${deviceId}_${workspacePath}`);
                const collectionName = hasher.digest('hex');
                const databaseName = 'vectorservice-test';

                progress.report({ increment: 50, message: '删除Collection...' });

                // 删除collection
                const result = await chunkerInstance.vectorManager.vectorDB.implementation.dropCollection(databaseName, collectionName);

                progress.report({ increment: 90, message: '验证删除结果...' });

                // 验证删除是否成功
                try {
                    const collections = await chunkerInstance.vectorManager.vectorDB.implementation.listCollections(databaseName);
                    const collectionExists = collections && collections.collections && 
                        collections.collections.some((col: any) => col.collectionName === collectionName);
                    
                    if (collectionExists) {
                        throw new Error('Collection删除失败，仍然存在于数据库中');
                    }
                } catch (listError) {
                    console.warn('无法验证删除结果:', listError);
                }

                progress.report({ increment: 100, message: '删除完成！' });

                vscode.window.showInformationMessage(
                    `工作区 "${workspaceName}" 的云端向量数据已成功删除！\n\n` +
                    `Collection: ${collectionName.substring(0, 16)}...`
                );

            } catch (error) {
                console.error('[CodeChunker] 删除Collection失败:', error);
                vscode.window.showErrorMessage(`删除Collection失败: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
    }
} 