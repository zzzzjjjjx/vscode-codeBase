import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class SearchResultView {

    /**
     * 显示搜索结果
     */
    static async displaySearchResults(query: string, results: any[], workspaceName: string) {
        const outputChannel = vscode.window.createOutputChannel(`代码搜索结果 - ${workspaceName}`);
        
        try {
            outputChannel.clear();
            outputChannel.appendLine(`📊 智能代码搜索结果`);
            outputChannel.appendLine(`🔍 搜索关键词: "${query}"`);
            outputChannel.appendLine(`📁 工作区: ${workspaceName}`);
            outputChannel.appendLine(`📈 找到结果: ${results.length} 个相关代码片段`);
            outputChannel.appendLine(`⏰ 搜索时间: ${new Date().toLocaleString()}`);
            outputChannel.appendLine(`${'='.repeat(80)}\n`);

            // 按得分排序结果
            results.sort((a, b) => (b.score || 0) - (a.score || 0));

            // 显示每个搜索结果
            results.forEach((result, index) => {
                const score = result.score ? (result.score * 100).toFixed(1) : 'N/A';
                const fileName = result.fileName || result.filePath || 'unknown';
                const filePath = result.filePath || '';
                
                outputChannel.appendLine(`📄 结果 ${index + 1}: ${fileName}`);
                outputChannel.appendLine(`   📍 路径: ${filePath}`);
                outputChannel.appendLine(`   🎯 相似度: ${score}%`);
                
                if (result.content) {
                    // 限制内容显示长度
                    const maxLength = 200;
                    let content = result.content.trim();
                    if (content.length > maxLength) {
                        content = content.substring(0, maxLength) + '...';
                    }
                    
                    // 高亮显示查询关键词
                    const highlightedContent = this.highlightQuery(content, query);
                    outputChannel.appendLine(`   📝 内容预览:`);
                    outputChannel.appendLine(`      ${highlightedContent.replace(/\n/g, '\n      ')}`);
                }
                
                outputChannel.appendLine('');
            });

            outputChannel.appendLine(`${'='.repeat(80)}`);
            outputChannel.appendLine(`💡 提示: 双击结果列表中的文件可以直接打开`);
            
            // 显示输出面板
            outputChannel.show(true);

            // 提供交互式选择
            await this.showSearchResultPicker(results, workspaceName);

        } catch (error) {
            console.error('[SearchResultView] 显示搜索结果失败:', error);
            vscode.window.showErrorMessage(`显示搜索结果失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 高亮显示查询关键词
     */
    private static highlightQuery(content: string, query: string): string {
        if (!query || !content) return content;
        
        try {
            // 简单的关键词高亮 (用 >> << 包围)
            const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            return content.replace(regex, '>>$1<<');
        } catch (error) {
            return content;
        }
    }

    /**
     * 显示搜索结果选择器
     */
    private static async showSearchResultPicker(results: any[], workspaceName: string) {
        if (!results || results.length === 0) {
            return;
        }

        const quickPickItems = results.map((result, index) => {
            const score = result.score ? (result.score * 100).toFixed(1) : 'N/A';
            const fileName = result.fileName || result.filePath || 'unknown';
            const filePath = result.filePath || '';
            
            return {
                label: `$(file-code) ${fileName}`,
                description: `相似度: ${score}%`,
                detail: filePath,
                result: result,
                index: index
            };
        });

        const selected = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: `选择要打开的文件 (共找到 ${results.length} 个结果)`,
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected) {
            await this.openSearchResultFile(selected.result);
        }
    }

    /**
     * 打开搜索结果文件
     */
    private static async openSearchResultFile(result: any) {
        try {
            if (!result || !result.filePath) {
                vscode.window.showErrorMessage('无效的文件路径');
                return;
            }

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('请先打开一个工作区');
                return;
            }

            // 构建完整文件路径
            const fullPath = path.isAbsolute(result.filePath) 
                ? result.filePath 
                : path.join(workspaceFolder.uri.fsPath, result.filePath);

            // 检查文件是否存在
            if (!fs.existsSync(fullPath)) {
                vscode.window.showErrorMessage(`文件不存在: ${result.filePath}`);
                return;
            }

            // 打开文件
            const document = await vscode.workspace.openTextDocument(fullPath);
            const editor = await vscode.window.showTextDocument(document);

            // 如果有行号信息，跳转到指定位置
            if (result.startLine && result.startLine > 0) {
                const startLine = Math.max(0, result.startLine - 1); // VS Code 行号从0开始
                const endLine = result.endLine ? Math.max(startLine, result.endLine - 1) : startLine;
                
                const range = new vscode.Range(startLine, 0, endLine, 0);
                editor.selection = new vscode.Selection(range.start, range.end);
                editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            }

            vscode.window.showInformationMessage(`已打开文件: ${result.fileName || result.filePath}`);

        } catch (error) {
            console.error('[SearchResultView] 打开文件失败:', error);
            vscode.window.showErrorMessage(`打开文件失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
} 