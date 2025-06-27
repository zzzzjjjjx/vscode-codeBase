const crypto = require('crypto');

class BaseParser {
    constructor(config, workspacePath = null) {
        this.config = config || {};
        this.workspacePath = workspacePath;
        this.linesPerChunk = this.config.linesPerChunk || 15;
        this.maxChunkSize = 9 * 1024;
    }

    async parse(filePath) {
        // 抽象方法，子类需要实现
        throw new Error('parse method must be implemented by subclass');
    }

    generateChunkId(filePath, startLine, endLine) {
        const identifier = `${filePath}:${startLine}:${endLine}`;
        return crypto.createHash('sha256').update(identifier).digest('hex');
    }

    _createChunk(content, startLine, endLine, filePath = 'unknown', language = 'unknown', type = 'default') {
        return {
            chunkId: this.generateChunkId(filePath, startLine, endLine),    
            filePath: filePath,
            language: language,
            startLine: startLine,
            endLine: endLine,
            content: content,
            parser: this.constructor.name.toLowerCase().replace('parser', '') + '_parser',
            type: type
        };
    }

    _splitIntoChunks(content, filePath = 'unknown', language = 'unknown') {
        const lines = content.split('\n');
        const chunks = [];
        
        let currentLines = [];
        let currentStartLine = 1;
        
        // 调试信息：记录文件的基本信息

        
        // 检查是否有空行在文件末尾
        const lastLine = lines[lines.length - 1];
        if (lastLine === '' || lastLine.trim() === '') {

        }
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // 跳过空行，避免创建空内容代码块
            if (line.trim() === '' && currentLines.length === 0) {

                currentStartLine = i + 2; // 更新起始行号
                continue;
            }
            
            currentLines.push(line);
            
            const shouldEnd = currentLines.length >= this.linesPerChunk ||
                             Buffer.byteLength(currentLines.join('\n'), 'utf8') >= this.maxChunkSize;
            
            if (shouldEnd || i === lines.length - 1) {
                const chunkContent = currentLines.join('\n');
                const contentSize = Buffer.byteLength(chunkContent, 'utf8');
                
                if (contentSize > this.maxChunkSize && currentLines.length > 1) {
                    const midPoint = Math.floor(currentLines.length / 2);
                    const firstHalf = currentLines.slice(0, midPoint);
                    const secondHalf = currentLines.slice(midPoint);
                    
                    chunks.push(this._createChunk(
                        firstHalf.join('\n'),
                        currentStartLine,
                        currentStartLine + firstHalf.length - 1,
                        filePath,
                        language,
                        'default'   
                    ));
                    
                    currentLines = secondHalf;
                    currentStartLine = currentStartLine + firstHalf.length;
                    i--;
                } else {
                    // 检查内容是否为空，避免创建空内容代码块
                    if (!chunkContent || chunkContent.trim() === '') {
        
                        console.log(`   内容: "${chunkContent}"`);
                        console.log(`   行数组: ${JSON.stringify(currentLines)}`);
                        
                        // 跳过这个空代码块，但继续处理
                        currentStartLine = currentStartLine + currentLines.length;
                        currentLines = [];
                        continue;
                    }
                    
                    const chunk = this._createChunk(
                        chunkContent,
                        currentStartLine,
                        currentStartLine + currentLines.length - 1,
                        filePath,
                        language,
                        'default'
                    );
                    
                    chunks.push(chunk);
                    
                    // 修复Bug: 正确计算下一个代码块的起始行号
                    currentStartLine = currentStartLine + currentLines.length;
                    currentLines = [];
                }
            }
        }
        

        
        return chunks;
    }
}

module.exports = BaseParser; 