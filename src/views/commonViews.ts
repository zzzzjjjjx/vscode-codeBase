import * as vscode from 'vscode';

export class CommonViews {

    /**
     * 显示配置界面
     */
    static async showConfiguration() {
        const config = vscode.workspace.getConfiguration('codeChunker');
        
        // 获取当前配置值
        const currentUserId = config.get<string>('userId') || '';
        const currentDeviceId = config.get<string>('deviceId') || '';
        const currentToken = config.get<string>('token') || '';

        // 显示用户ID输入框
        const userId = await vscode.window.showInputBox({
            prompt: '请输入用户ID',
            value: currentUserId,
            placeHolder: '例如: user123',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return '用户ID不能为空';
                }
                if (value.trim().length < 3) {
                    return '用户ID至少需要3个字符';
                }
                return null;
            }
        });

        if (userId === undefined) {
            return; // 用户取消
        }

        // 显示设备ID输入框
        const deviceId = await vscode.window.showInputBox({
            prompt: '请输入设备ID',
            value: currentDeviceId,
            placeHolder: '例如: device456',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return '设备ID不能为空';
                }
                if (value.trim().length < 3) {
                    return '设备ID至少需要3个字符';
                }
                return null;
            }
        });

        if (deviceId === undefined) {
            return; // 用户取消
        }

        // 显示Token输入框
        const token = await vscode.window.showInputBox({
            prompt: '请输入访问令牌',
            value: currentToken,
            placeHolder: '例如: your_access_token',
            password: true, // 隐藏输入内容
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return '访问令牌不能为空';
                }
                if (value.trim().length < 10) {
                    return '访问令牌至少需要10个字符';
                }
                return null;
            }
        });

        if (token === undefined) {
            return; // 用户取消
        }

        try {
            // 保存配置
            await config.update('userId', userId.trim(), vscode.ConfigurationTarget.Global);
            await config.update('deviceId', deviceId.trim(), vscode.ConfigurationTarget.Global);
            await config.update('token', token.trim(), vscode.ConfigurationTarget.Global);

            vscode.window.showInformationMessage(
                `配置已保存！\n用户ID: ${userId}\n设备ID: ${deviceId}\nToken: ${token.substring(0, 6)}...`
            );

        } catch (error) {
            console.error('[CommonViews] 保存配置失败:', error);
            vscode.window.showErrorMessage(`保存配置失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 显示进度详情
     */
    static async showProgressDetails(
        overallProgress: any,
        fileProgress: any,
        fileProgressSummary: any[],
        fileProgressPercentage: number
    ) {
        const outputChannel = vscode.window.createOutputChannel('代码分块进度');
        
        try {
            outputChannel.clear();
            outputChannel.appendLine('📊 代码分块处理进度报告');
            outputChannel.appendLine(`⏰ 更新时间: ${new Date().toLocaleString()}`);
            outputChannel.appendLine(`${'='.repeat(60)}\n`);

            // 文件级别进度
            outputChannel.appendLine('📁 文件处理进度:');
            outputChannel.appendLine(`   总文件数: ${fileProgress.totalFiles}`);
            outputChannel.appendLine(`   已完成: ${fileProgress.completedFiles}`);
            outputChannel.appendLine(`   处理中: ${fileProgress.processingFiles}`);
            outputChannel.appendLine(`   等待中: ${fileProgress.pendingFiles}`);
            outputChannel.appendLine(`   失败: ${fileProgress.failedFiles}`);
            outputChannel.appendLine(`   进度: ${fileProgressPercentage.toFixed(2)}%\n`);

            // 代码块级别进度
            outputChannel.appendLine('🔗 代码块处理进度:');
            outputChannel.appendLine(`   总代码块: ${overallProgress.totalChunks}`);
            outputChannel.appendLine(`   已完成: ${overallProgress.completedChunks}`);
            outputChannel.appendLine(`   处理中: ${overallProgress.processingChunks}`);
            outputChannel.appendLine(`   等待中: ${overallProgress.pendingChunks}`);
            outputChannel.appendLine(`   失败: ${overallProgress.failedChunks}`);
            outputChannel.appendLine(`   成功率: ${overallProgress.successRate.toFixed(2)}%\n`);

            // 文件详细进度
            if (fileProgressSummary && fileProgressSummary.length > 0) {
                outputChannel.appendLine('📄 文件详细进度:');
                outputChannel.appendLine(`${'文件名'.padEnd(25)} ${'语言'.padEnd(12)} ${'完成'.padEnd(6)} ${'总计'.padEnd(6)} ${'成功率'.padEnd(8)}`);
                outputChannel.appendLine('-'.repeat(60));
                
                fileProgressSummary.forEach(fileInfo => {
                    const fileName = fileInfo.file.length > 23 ? fileInfo.file.substring(0, 20) + '...' : fileInfo.file;
                    const language = fileInfo.language || 'unknown';
                    const completed = fileInfo.completed.toString();
                    const total = fileInfo.total.toString();
                    const successRate = fileInfo.successRate.toFixed(1) + '%';
                    
                    outputChannel.appendLine(
                        `${fileName.padEnd(25)} ${language.padEnd(12)} ${completed.padEnd(6)} ${total.padEnd(6)} ${successRate.padEnd(8)}`
                    );
                });
            }

            outputChannel.appendLine(`\n${'='.repeat(60)}`);
            outputChannel.appendLine('💡 提示: 如果处理停滞，可以尝试重新运行代码分块命令');

            // 显示输出面板
            outputChannel.show(true);

            // 显示摘要通知
            const summaryMessage = `处理进度: 文件 ${fileProgress.completedFiles}/${fileProgress.totalFiles} (${fileProgressPercentage.toFixed(1)}%), ` +
                                 `代码块 ${overallProgress.completedChunks}/${overallProgress.totalChunks} (${overallProgress.successRate.toFixed(1)}%)`;
            
            vscode.window.showInformationMessage(summaryMessage);

        } catch (error) {
            console.error('[CommonViews] 显示进度详情失败:', error);
            vscode.window.showErrorMessage(`显示进度详情失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 显示简单的信息消息
     */
    static showInfo(message: string) {
        vscode.window.showInformationMessage(message);
    }

    /**
     * 显示警告消息
     */
    static showWarning(message: string) {
        vscode.window.showWarningMessage(message);
    }

    /**
     * 显示错误消息
     */
    static showError(message: string) {
        vscode.window.showErrorMessage(message);
    }

    /**
     * 显示带进度的任务
     */
    static async showProgress<T>(
        title: string,
        task: (progress: vscode.Progress<{ increment?: number; message?: string }>) => Promise<T>
    ): Promise<T> {
        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: title,
            cancellable: false
        }, task);
    }
} 