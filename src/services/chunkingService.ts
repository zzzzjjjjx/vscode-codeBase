import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { CodeChunkerModule } from '../types';
import { CommonViews } from '../views/commonViews';
import { IndexCacheService } from './indexCacheService';

// 导入 code-chunker 模块
const codeChunker: CodeChunkerModule = require('../../code-chunker/index.js');

// 全局变量来跟踪活跃的chunker实例
let activeChunkerInstance: any = null;
let isProcessing = false;

export class ChunkingService {
    private indexCacheService: IndexCacheService | null = null;

    /**
     * 初始化索引缓存服务
     */
    private initializeIndexCache(context: vscode.ExtensionContext) {
        if (!this.indexCacheService) {
            this.indexCacheService = new IndexCacheService(context);
        }
    }
    
    /**
     * 执行代码分块
     */
    async executeCodeChunking(context?: vscode.ExtensionContext) {
        if (isProcessing) {
            vscode.window.showWarningMessage('代码分块正在进行中，请等待当前处理完成');
            return;
        }

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
        const ignorePatterns = config.get<string[]>('ignorePatterns') || [];

        // 检查必要的配置
        if (!userId || !deviceId || !token) {
            const result = await vscode.window.showErrorMessage(
                '缺少必要的配置信息（用户ID、设备ID或Token），是否现在配置？',
                '去配置',
                '取消'
            );
            if (result === '去配置') {
                await CommonViews.showConfiguration();
            }
            return;
        }

        const workspacePath = workspaceFolder.uri.fsPath;
        const workspaceName = path.basename(workspacePath);

        // 检查工作区是否存在
        if (!fs.existsSync(workspacePath)) {
            vscode.window.showErrorMessage(`工作区路径不存在: ${workspacePath}`);
            return;
        }

        isProcessing = true;

        // 初始化索引缓存服务
        if (context) {
            this.initializeIndexCache(context);
        }

        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: '代码分块处理中...',
            cancellable: false
        }, async (progress) => {
            try {
                progress.report({ increment: 0, message: '初始化处理环境...' });

                // 获取或创建chunker实例
                activeChunkerInstance = codeChunker.getChunkerInstance(userId, deviceId, workspacePath, token);

                progress.report({ increment: 10, message: '检查文件索引缓存...' });

                // 如果启用了索引缓存，先检查哪些文件需要处理
                let filesToProcess: string[] = [];
                let skippedFiles: string[] = [];

                if (this.indexCacheService) {
                    try {
                        // 扫描工作区获取文件列表
                        const allFiles = await this.scanWorkspaceFiles(workspacePath, ignorePatterns);
                        
                        // 检查哪些文件已经索引过
                        const { indexed, unindexed } = await this.indexCacheService.filterUnindexedFiles(
                            allFiles, workspacePath, userId, deviceId
                        );
                        
                        filesToProcess = unindexed;
                        skippedFiles = indexed;

                        progress.report({ 
                            increment: 10, 
                            message: `缓存检查完成：跳过 ${skippedFiles.length} 个文件，处理 ${filesToProcess.length} 个文件...` 
                        });

                        // 显示缓存统计
                        if (skippedFiles.length > 0) {
                
                        }
                    } catch (error) {
                        console.warn('[ChunkingService] 索引缓存检查失败，将处理所有文件:', error);
                        filesToProcess = []; // 空数组表示处理所有文件
                    }
                }

                progress.report({ increment: 10, message: '开始处理工作区文件...' });

                // 执行代码分块处理
                let success: boolean;
                try {
                    success = filesToProcess.length === 0 
                        ? await codeChunker.processWorkspace(userId, deviceId, workspacePath, token, ignorePatterns)
                        : await this.processSpecificFiles(userId, deviceId, workspacePath, token, filesToProcess);
                } catch (processingError) {
                    const error = processingError instanceof Error ? processingError : new Error(String(processingError));
                    console.error('🔥 代码分块处理出现异常:', error);
                    console.error('🔥 异常详情:', {
                        name: error.name,
                        message: error.message,
                        stack: error.stack
                    });
                    vscode.window.showErrorMessage(`代码分块处理失败: ${error.message || 'Unknown error'}`);
                    return false;
                }

                // 如果处理成功且启用了缓存，标记新处理的文件为已索引
                if (success && this.indexCacheService && filesToProcess.length > 0) {
                    try {
                        await this.indexCacheService.markFilesAsIndexed(filesToProcess, workspacePath, userId, deviceId);
            
                    } catch (error) {
                        console.warn('[ChunkingService] 标记文件索引状态失败:', error);
                    }
                }

                if (success) {
                    progress.report({ increment: 100, message: '处理完成！' });
                    vscode.window.showInformationMessage(`工作区 "${workspaceName}" 代码分块处理完成！`);
                    return true;
                } else {
                    vscode.window.showErrorMessage('代码分块处理失败');
                    return false;
                }
            } catch (error) {
                console.error('[CodeChunker] 处理过程出错:', error);
                vscode.window.showErrorMessage(`处理失败: ${error instanceof Error ? error.message : String(error)}`);
                return false;
            } finally {
                isProcessing = false;
            }
        });
    }

    /**
     * 查看分块进度
     */
    async checkChunkingProgress() {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('请先打开一个工作区');
            return;
        }

        const config = vscode.workspace.getConfiguration('codeChunker');
        const userId = config.get<string>('userId');
        const deviceId = config.get<string>('deviceId');
        const token = config.get<string>('token');

        if (!userId || !deviceId || !token) {
            vscode.window.showErrorMessage('缺少必要的配置信息，请先配置');
            return;
        }

        const workspacePath = workspaceFolder.uri.fsPath;

        try {
            // 使用缓存的实例或创建新实例
            const chunkerInstance = activeChunkerInstance || codeChunker.getChunkerInstance(userId, deviceId, workspacePath, token);

            if (!chunkerInstance || !chunkerInstance.progressTracker) {
                vscode.window.showInformationMessage('暂无进度信息，请先开始代码分块处理');
                return;
            }

            // 获取进度信息
            const overallProgress = chunkerInstance.progressTracker.getOverallProgress();
            const fileProgress = chunkerInstance.progressTracker.getFileProgress();
            const fileProgressSummary = chunkerInstance.progressTracker.getFileProgressSummary();

            // 计算文件级别的进度百分比
            const fileProgressPercentage = chunkerInstance.progressTracker.getFileProgressPercentage();

            // 显示进度信息
            await CommonViews.showProgressDetails(overallProgress, fileProgress, fileProgressSummary, fileProgressPercentage);

        } catch (error) {
            console.error('[CodeChunker] 获取进度信息失败:', error);
            vscode.window.showErrorMessage(`获取进度信息失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 清除处理缓存
     */
    async clearProcessingCache() {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('请先打开一个工作区');
            return;
        }

        const config = vscode.workspace.getConfiguration('codeChunker');
        const userId = config.get<string>('userId');
        const deviceId = config.get<string>('deviceId');
        const token = config.get<string>('token');

        if (!userId || !deviceId || !token) {
            vscode.window.showErrorMessage('缺少必要的配置信息');
            return;
        }

        const workspacePath = workspaceFolder.uri.fsPath;

        try {
            // 获取chunker实例
            const chunkerInstance = activeChunkerInstance || codeChunker.getChunkerInstance(userId, deviceId, workspacePath, token);

            if (!chunkerInstance.vectorManager) {
                vscode.window.showErrorMessage('VectorManager未初始化，无法清除缓存');
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '清除缓存中...',
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0, message: '获取缓存信息...' });

                // 获取向量信息
                const vectorInfo = await chunkerInstance.vectorManager.getVectorInfo();
                
                progress.report({ increment: 50, message: '清空临时向量存储...' });

                // 清空临时向量存储
                if (chunkerInstance.vectorManager.tempVectors) {
                    chunkerInstance.vectorManager.tempVectors.clear();
                }

                progress.report({ increment: 100, message: '临时存储清空完成！' });

                // 显示清空结果
                vscode.window.showInformationMessage(
                    `临时存储清空完成！\n` +
                    `清空向量数: ${vectorInfo.totalVectors}\n` +
                    `释放空间: ${(vectorInfo.cacheSize / 1024 / 1024).toFixed(2)} MB`
                );
            });

        } catch (error) {
            console.error('[CodeChunker] 清除缓存失败:', error);
            vscode.window.showErrorMessage(`清除缓存失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 计算文件进度
     */
    async calculateFileProgress(workspacePath: string, totalVectors: number): Promise<{
        totalFiles: number;
        processedFiles: number;
        progressPercentage: number;
    }> {
        const config = vscode.workspace.getConfiguration('codeChunker');
        const ignorePatterns = config.get<string[]>('ignorePatterns') || [];

        let totalFiles = 0;
        let processedFiles = 0;

        async function scanDirectory(dirPath: string) {
            try {
                const items = await fs.promises.readdir(dirPath, { withFileTypes: true });
                
                for (const item of items) {
                    const fullPath = path.join(dirPath, item.name);
                    const relativePath = path.relative(workspacePath, fullPath);

                    // 检查是否应该忽略
                    const shouldIgnore = ignorePatterns.some(pattern => {
                        return relativePath.includes(pattern.replace(/\*\*/g, '').replace(/\*/g, ''));
                    });

                    if (shouldIgnore) {
                        continue;
                    }

                    if (item.isDirectory()) {
                        await scanDirectory(fullPath);
                    } else if (item.isFile()) {
                        // 只统计代码文件
                        const ext = path.extname(item.name).toLowerCase();
                        const codeExtensions = ['.py', '.js', '.ts', '.java', '.cpp', '.c', '.go', '.rs', '.php', '.rb'];
                        
                        if (codeExtensions.includes(ext)) {
                            totalFiles++;
                            
                            // 简单估算：假设每个文件平均产生10个向量
                            const estimatedVectorsPerFile = 10;
                            if (totalVectors > (processedFiles * estimatedVectorsPerFile)) {
                                processedFiles++;
                            }
                        }
                    }
                }
            } catch (error) {
                console.warn(`扫描目录失败: ${dirPath}`, error);
            }
        }

        await scanDirectory(workspacePath);

        return {
            totalFiles,
            processedFiles,
            progressPercentage: totalFiles > 0 ? (processedFiles / totalFiles) * 100 : 0
        };
    }

    /**
     * 扫描工作区文件
     */
    private async scanWorkspaceFiles(workspacePath: string, ignorePatterns: string[]): Promise<string[]> {
        const files: string[] = [];

        async function scanDirectory(dirPath: string) {
            try {
                const items = await fs.promises.readdir(dirPath, { withFileTypes: true });
                
                for (const item of items) {
                    const fullPath = path.join(dirPath, item.name);
                    const relativePath = path.relative(workspacePath, fullPath);

                    // 检查是否应该忽略
                    const shouldIgnore = ignorePatterns.some(pattern => {
                        return relativePath.includes(pattern.replace(/\*\*/g, '').replace(/\*/g, ''));
                    });

                    if (shouldIgnore) {
                        continue;
                    }

                    if (item.isDirectory()) {
                        await scanDirectory(fullPath);
                    } else if (item.isFile()) {
                        // 只包含代码文件
                        const ext = path.extname(item.name).toLowerCase();
                        const codeExtensions = ['.py', '.js', '.ts', '.java', '.cpp', '.c', '.go', '.rs', '.php', '.rb', '.cs', '.css', '.html', '.json', '.xml', '.yaml', '.yml', '.md'];
                        
                        if (codeExtensions.includes(ext)) {
                            files.push(relativePath);
                        }
                    }
                }
            } catch (error) {
                console.warn(`扫描目录失败: ${dirPath}`, error);
            }
        }

        await scanDirectory(workspacePath);
        return files;
    }

    /**
     * 处理特定文件列表
     */
    private async processSpecificFiles(
        userId: string, 
        deviceId: string, 
        workspacePath: string, 
        token: string, 
        filesToProcess: string[]
    ): Promise<boolean> {
        try {
    
            
            // 这里可以调用 code-chunker 的特定文件处理方法
            // 如果 code-chunker 没有提供此方法，可以使用完整处理但只标记特定文件
            
            // 临时解决方案：仍然处理所有文件，但索引缓存会记录具体的文件状态
            const success = await codeChunker.processWorkspace(userId, deviceId, workspacePath, token);
            
            return success;
        } catch (error) {
            console.error('[ChunkingService] 处理特定文件失败:', error);
            return false;
        }
    }

    /**
     * 获取索引缓存统计信息
     */
    async getCacheStats(): Promise<any> {
        if (!this.indexCacheService) {
            return null;
        }
        
        return this.indexCacheService.getCacheStats();
    }

    /**
     * 清除工作区索引缓存
     */
    async clearWorkspaceIndexCache(workspacePath: string, userId: string, deviceId: string): Promise<void> {
        if (this.indexCacheService) {
            await this.indexCacheService.clearWorkspaceCache(workspacePath, userId, deviceId);
        }
    }

    /**
     * 生成网络性能分析报告
     */
    async generateNetworkPerformanceReport(): Promise<any> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('请先打开一个工作区');
                return null;
            }

            const config = vscode.workspace.getConfiguration('codeChunker');
            const userId = config.get<string>('userId');
            const deviceId = config.get<string>('deviceId');
            const token = config.get<string>('token');

            if (!userId || !deviceId || !token) {
                vscode.window.showErrorMessage('缺少必要的配置信息');
                return null;
            }

            const workspacePath = workspaceFolder.uri.fsPath;

            // 获取chunker实例
            const chunkerInstance = activeChunkerInstance || codeChunker.getChunkerInstance(userId, deviceId, workspacePath, token);

            if (!chunkerInstance.vectorManager || !chunkerInstance.vectorManager.embeddingClient) {
                vscode.window.showErrorMessage('EmbeddingClient未初始化，无法生成网络性能报告');
                return null;
            }

            // 调用embeddingClient的网络性能报告方法
            const report = chunkerInstance.vectorManager.embeddingClient.generateNetworkPerformanceReport();
            return report;

        } catch (error) {
            console.error('[ChunkingService] 生成网络性能报告失败:', error);
            throw error;
        }
    }

    /**
     * 清除网络性能数据
     */
    async clearNetworkPerformanceData(): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('请先打开一个工作区');
                return;
            }

            const config = vscode.workspace.getConfiguration('codeChunker');
            const userId = config.get<string>('userId');
            const deviceId = config.get<string>('deviceId');
            const token = config.get<string>('token');

            if (!userId || !deviceId || !token) {
                vscode.window.showErrorMessage('缺少必要的配置信息');
                return;
            }

            const workspacePath = workspaceFolder.uri.fsPath;

            // 获取chunker实例
            const chunkerInstance = activeChunkerInstance || codeChunker.getChunkerInstance(userId, deviceId, workspacePath, token);

            if (!chunkerInstance.vectorManager || !chunkerInstance.vectorManager.embeddingClient) {
                vscode.window.showErrorMessage('EmbeddingClient未初始化，无法清除网络性能数据');
                return;
            }

            // 调用embeddingClient的清除网络性能数据方法
            chunkerInstance.vectorManager.embeddingClient.clearNetworkPerformanceData();

        } catch (error) {
            console.error('[ChunkingService] 清除网络性能数据失败:', error);
            throw error;
        }
    }
} 