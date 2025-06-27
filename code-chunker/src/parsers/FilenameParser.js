const BaseParser = require('./BaseParser');
const path = require('path');

class FilenameParser extends BaseParser {
    async parse(filePath, content = null) {
        // 如果没有提供内容，读取文件
        if (!content) {
            const fs = require('fs').promises;
            content = await fs.readFile(filePath, 'utf-8');
        }
        
        // 从文件扩展名推断语言
        const ext = path.extname(filePath);
        const langMapping = this.config.languageMapping || {
            '.py': 'python',
            '.js': 'javascript',
            '.ts': 'typescript',
            '.java': 'java',
            '.cpp': 'cpp',
            '.c': 'c'
        };
        const language = langMapping[ext] || 'unknown';
        const relativePath = path.basename(filePath);
        const lineCount = content.split('\n').length;
        
        return [this._createChunk(content, 1, lineCount, relativePath, language, 'file')];
    }
}

module.exports = FilenameParser; 