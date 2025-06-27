const path = require('path');
const BaseParser = require('./parsers/BaseParser');
const AstParser = require('./parsers/AstParser');
const ReadlineParser = require('./parsers/ReadlineParser');
const FilenameParser = require('./parsers/FilenameParser');

class ParserSelector {
    constructor(config) {
        this.config = config;
        this.parsers = new Map();
        this._initializeParsers();
    }

    _initializeParsers() {
        // 初始化所有可用的解析器
        this.parsers.set('ast', new AstParser(this.config));
        this.parsers.set('readline', new ReadlineParser(this.config));
        this.parsers.set('filename', new FilenameParser(this.config));
    }

    selectParser(filePath) {
        const extension = path.extname(filePath).toLowerCase();
        const languageMapping = this.config.languageMapping || {
            '.py': 'python',
            '.js': 'javascript',
            '.ts': 'typescript'
        };

        const language = languageMapping[extension];
        if (!language) {
            return this.parsers.get('readline'); // 默认使用行解析器
        }

        // 根据语言选择适当的解析器
        if (['python', 'javascript', 'typescript'].includes(language)) {
            return this.parsers.get('ast');
        }

        return this.parsers.get('readline');
    }
}

module.exports = ParserSelector; 