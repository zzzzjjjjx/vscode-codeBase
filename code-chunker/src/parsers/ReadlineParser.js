const BaseParser = require('./BaseParser');
const path = require('path');

class ReadlineParser extends BaseParser {
    constructor(config, workspacePath = null) {
        super(config, workspacePath);
        // 确保使用更小的行数以避免10KB限制
        this.linesPerChunk = this.config.linesPerChunk || 15;
    }

    async parse(filePath, content) {
        if (!content || content.trim().length === 0) {
            return [];
        }

        // 使用父类的智能分割方法，自动处理大小限制
        return this._splitIntoChunks(content, filePath, this._detectLanguage(filePath));
    }

    _detectLanguage(filePath) {
        const ext = filePath.split('.').pop()?.toLowerCase();
        const languageMap = {
            'py': 'python',
            'js': 'javascript',
            'ts': 'typescript',
            'cs': 'csharp',
            'java': 'java',
            'cpp': 'cpp',
            'c': 'c',
            'h': 'c',
            'hpp': 'cpp'
        };
        return languageMap[ext] || 'unknown';
    }
}

module.exports = ReadlineParser; 