const Parser = require('tree-sitter');
const Python = require('tree-sitter-python');
const BaseParser = require('./BaseParser');
const crypto = require('crypto');
const path = require('path');

class AstParser extends BaseParser {
    constructor(config) {
        super(config);
        // 静态语言解析器池
        this.languageParserPool = {};
        this.languageDict = {
            python: PythonParser
        };
        // 10KB限制（留1KB余量）
        this.maxChunkSize = 9 * 1024;
        this._initializeParsers();
    }

    _initializeParsers() {
        try {
            // 预初始化支持的语言解析器
            for (const [lang, parserClass] of Object.entries(this.languageDict)) {
                if (!this.languageParserPool[lang]) {
                    this.languageParserPool[lang] = new parserClass(this.config);
                }
            }
        } catch (error) {
            console.warn('Warning: tree-sitter initialization failed. AST parsing may not be available:', error);
        }
    }

    getParserForLanguage(language) {
        // 检查语言是否支持
        if (!this.languageDict[language]) {
            throw new Error(`Unsupported language: ${language}`);
        }

        // 检查池中是否有该语言的解析器
        if (!this.languageParserPool[language]) {
            const parserClass = this.languageDict[language];
            this.languageParserPool[language] = new parserClass(this.config);
        }

        return this.languageParserPool[language];
    }

    async parse(filePath, content = null, language = null) {
        // 如果没有提供内容，读取文件
        if (!content) {
            const fs = require('fs').promises;
            content = await fs.readFile(filePath, 'utf-8');
        }

        if (!language) {
            // 尝试从文件扩展名确定语言
            const ext = path.extname(filePath);
            const langMapping = this.config.languageMapping || {
                '.py': 'python',
                '.js': 'javascript',
                '.ts': 'typescript'
            };
            language = langMapping[ext] || 'unknown';
        }

        try {
            if (!this.languageDict[language]) {
                // 如果语言不支持，使用父类的智能分割方法
                return this._splitIntoChunks(content, filePath, language);
            }

            // 获取适当的语言解析器
            const langParser = this.getParserForLanguage(language);
            
            // 使用语言特定的解析器解析内容
            const chunks = await langParser.parseContent(content, filePath);
            
            // 检查并分割过大的块
            return this._ensureChunkSizeLimit(chunks);

        } catch (error) {
            console.error(`Error parsing file ${filePath}:`, error);
            return [];
        }
    }

    // 确保所有块都在大小限制内
    _ensureChunkSizeLimit(chunks) {
        const result = [];
        
        for (const chunk of chunks) {
            const chunkSize = Buffer.byteLength(chunk.content, 'utf8');
            
            if (chunkSize <= this.maxChunkSize) {
                result.push(chunk);
            } else {
                // 分割过大的块
                const splitChunks = this._splitLargeChunk(chunk);
                result.push(...splitChunks);
            }
        }
        
        return result;
    }

    // 分割过大的代码块
    _splitLargeChunk(chunk) {
        const lines = chunk.content.split('\n');
        const chunks = [];
        let currentLines = [];
        let currentStartLine = chunk.startLine;
        
        for (let i = 0; i < lines.length; i++) {
            currentLines.push(lines[i]);
            const currentContent = currentLines.join('\n');
            const currentSize = Buffer.byteLength(currentContent, 'utf8');
            
            // 如果达到大小限制或是最后一行
            if (currentSize >= this.maxChunkSize || i === lines.length - 1) {
                if (currentSize > this.maxChunkSize && currentLines.length > 1) {
                    // 移除最后一行，保存当前块
                    currentLines.pop();
                    const finalContent = currentLines.join('\n');
                    
                    chunks.push({
                        ...chunk,
                        content: finalContent,
                        startLine: currentStartLine,
                        endLine: currentStartLine + currentLines.length - 1,
                        chunkId: this.generateChunkId(chunk.filePath, currentStartLine, currentStartLine + currentLines.length - 1)
                    });
                    
                    // 从当前行重新开始 - 修复Bug: 应该基于处理的行数更新起始行号
                    const processedLines = currentLines.length;
                    currentLines = [lines[i]];
                    currentStartLine = currentStartLine + processedLines;
                } else {
                    // 保存当前块
                    chunks.push({
                        ...chunk,
                        content: currentContent,
                        startLine: currentStartLine,
                        endLine: currentStartLine + currentLines.length - 1,
                        chunkId: this.generateChunkId(chunk.filePath, currentStartLine, currentStartLine + currentLines.length - 1)
                    });
                    
                    // 重置 - 修复Bug: 在重置currentLines之前先保存长度
                    const processedLines = currentLines.length;
                    currentLines = [];
                    currentStartLine = currentStartLine + processedLines;
                }
            }
        }
        
        return chunks;
    }

    generateChunkId(filePath, startLine, endLine) {
        const identifier = `${filePath}:${startLine}:${endLine}`;
        return crypto.createHash('sha256').update(identifier).digest('hex');
    }
}

class PythonParser extends BaseParser {
    constructor(config) {
        super(config);
        // 节点类型分类
        this.nodeTypes = {
            import: ['import_statement', 'import_from_statement'],
            class: ['class_definition'],
            function: ['function_definition'],
            variable: ['expression_statement', 'assignment']
        };
        
        // 初始化tree-sitter Python解析器
        this.parser = new Parser();
        this.parser.setLanguage(Python);
        
        // 10KB限制（留1KB余量）
        this.maxChunkSize = 9 * 1024;
    }

    // 修复多字节字符处理问题的辅助方法
    _extractNodeCode(code, startByte, endByte) {
        // 将字符串转换为Buffer，使用字节索引进行切片，然后转换回字符串
        const buffer = Buffer.from(code, 'utf-8');
        return buffer.slice(startByte, endByte).toString('utf-8');
    }

    async parseContent(content, filePath = null) {
        try {
            // 验证输入内容
            if (!content || typeof content !== 'string') {
                console.warn(`Invalid content for Python parsing in file: ${filePath || 'unknown'}`);
                return [];
            }

            // 检查内容是否为空或过大
            if (content.length === 0) {
                console.warn(`Empty content for Python parsing in file: ${filePath || 'unknown'}`);
                return [];
            }

            if (content.length > 10 * 1024 * 1024) { // 10MB限制
                console.warn(`Content too large for Python parsing in file: ${filePath || 'unknown'} (${content.length} bytes)`);
                return [];
            }

            // 清理可能导致解析器问题的字符
            let cleanContent = content.replace(/\0/g, ''); // 移除null字符
            
            // 如果文件很大，先尝试截取前面部分进行解析
            if (cleanContent.length > 1024 * 1024) { // 1MB
                console.warn(`Large Python file detected: ${filePath || 'unknown'} (${cleanContent.length} bytes), truncating for parsing`);
                cleanContent = cleanContent.substring(0, 1024 * 1024); // 截取前1MB
            }

            // 尝试解析AST，使用更强的错误处理
            let tree;
            try {
                tree = this.parser.parse(cleanContent);
            } catch (parseError) {
                console.warn(`Direct parsing failed for ${filePath || 'unknown'}: ${parseError.message}`);
                
                // 尝试进一步清理内容
                cleanContent = cleanContent
                    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // 移除控制字符
                    .replace(/\r\n/g, '\n') // 标准化换行符
                    .replace(/\r/g, '\n');
                
                try {
                    tree = this.parser.parse(cleanContent);
                } catch (secondError) {
                    console.warn(`Second parsing attempt failed for ${filePath || 'unknown'}: ${secondError.message}`);
                    
                    // 最后尝试：只解析前几行
                    const lines = cleanContent.split('\n').slice(0, 100); // 只取前100行
                    const truncatedContent = lines.join('\n');
                    try {
                        tree = this.parser.parse(truncatedContent);
                        console.warn(`Successfully parsed truncated version of ${filePath || 'unknown'} (first 100 lines)`);
                    } catch (finalError) {
                        console.error(`All parsing attempts failed for ${filePath || 'unknown'}: ${finalError.message}`);
                        return [];
                    }
                }
            }
            
            // 检查解析结果
            if (!tree || !tree.rootNode) {
                console.warn(`Failed to parse AST for file: ${filePath || 'unknown'}`);
                return [];
            }

            const relativePath = filePath ? path.basename(filePath) : 'unknown';

            // 提取不同类型的代码块
            const imports = this._extractImports(tree, cleanContent);
            const classes = this._extractClasses(tree, cleanContent);
            const functions = this._extractFunctions(tree, cleanContent);
            const variables = this._extractVariables(tree, cleanContent);
            const other = this._extractOther(tree, cleanContent);

            // 合并所有chunks并按类型合并相邻的chunks
            const allChunks = [...imports, ...classes, ...functions, ...variables, ...other];
            const mergedChunks = this._mergeAdjacentChunks(allChunks);

            // 格式化chunks
            return mergedChunks.map(chunk => ({
                chunkId: this.generateChunkId(relativePath, chunk.startLine, chunk.endLine),
                filePath: relativePath,
                language: 'python',
                startLine: chunk.startLine,
                endLine: chunk.endLine,
                content: chunk.content,
                parser: 'python_parser',
                type: chunk.type,
                ...(chunk.name && { name: chunk.name })
            }));

        } catch (error) {
            console.error(`Error parsing Python content in file: ${filePath || 'unknown'}:`, error);
            // 返回空数组而不是抛出错误，让处理继续进行
            return [];
        }
    }

    _extractImports(tree, code) {
        const imports = [];
        
        for (const child of tree.rootNode.children) {
            if (this.nodeTypes.import.includes(child.type)) {
                // 使用字节索引和Buffer进行正确的多字节字符处理
                const nodeCode = this._extractNodeCode(code, child.startIndex, child.endIndex);
                imports.push({
                    type: 'import',
                    content: nodeCode,
                    startLine: child.startPosition.row + 1,
                    endLine: child.endPosition.row + 1
                });
            }
        }
        
        return imports;
    }

    _extractClasses(tree, code) {
        const classes = [];
        
        for (const child of tree.rootNode.children) {
            if (this.nodeTypes.class.includes(child.type)) {
                const className = this._getDefinitionName(child);
                // 使用字节索引和Buffer进行正确的多字节字符处理
                const nodeCode = this._extractNodeCode(code, child.startIndex, child.endIndex);
                
                classes.push({
                    type: 'class',
                    name: className,
                    content: nodeCode,
                    startLine: child.startPosition.row + 1,
                    endLine: child.endPosition.row + 1
                });
            }
        }
        
        return classes;
    }

    _extractFunctions(tree, code) {
        const functions = [];
        
        for (const child of tree.rootNode.children) {
            if (this.nodeTypes.function.includes(child.type)) {
                const funcName = this._getDefinitionName(child);
                // 使用字节索引和Buffer进行正确的多字节字符处理
                const nodeCode = this._extractNodeCode(code, child.startIndex, child.endIndex);
                
                functions.push({
                    type: 'function',
                    name: funcName,
                    content: nodeCode,
                    startLine: child.startPosition.row + 1,
                    endLine: child.endPosition.row + 1
                });
            }
        }
        
        return functions;
    }

    _extractVariables(tree, code) {
        const variables = [];
        
        for (const child of tree.rootNode.children) {
            if (this.nodeTypes.variable.includes(child.type)) {
                // 使用字节索引和Buffer进行正确的多字节字符处理
                const nodeCode = this._extractNodeCode(code, child.startIndex, child.endIndex);
                
                variables.push({
                    type: 'variable',
                    content: nodeCode,
                    startLine: child.startPosition.row + 1,
                    endLine: child.endPosition.row + 1
                });
            }
        }
        
        return variables;
    }

    _extractOther(tree, code) {
        const other = [];
        // 获取所有已定义的节点类型
        const allDefinedTypes = Object.values(this.nodeTypes).flat();
        
        for (const child of tree.rootNode.children) {
            if (!allDefinedTypes.includes(child.type)) {
                // 使用字节索引和Buffer进行正确的多字节字符处理
                const nodeCode = this._extractNodeCode(code, child.startIndex, child.endIndex);
                
                other.push({
                    type: 'other',
                    content: nodeCode,
                    startLine: child.startPosition.row + 1,
                    endLine: child.endPosition.row + 1
                });
            }
        }
        
        return other;
    }

    _mergeAdjacentChunks(chunks) {
        if (!chunks.length) return [];

        // 按起始行排序
        const sortedChunks = chunks.sort((a, b) => a.startLine - b.startLine);
        const merged = [];
        let current = sortedChunks[0];

        for (let i = 1; i < sortedChunks.length; i++) {
            const next = sortedChunks[i];
            
            // 如果是相同类型且相邻或非常接近（最多1行间隔）
            if (current.type === next.type && next.startLine <= current.endLine + 2) {
                // 合并chunks
                let content = current.content;
                if (next.startLine > current.endLine) {
                    content += '\n'.repeat(next.startLine - current.endLine);
                }
                content += next.content;

                current = {
                    type: current.type,
                    content: content,
                    startLine: current.startLine,
                    endLine: next.endLine,
                    ...(current.name && { name: current.name }),
                    ...(next.name && !current.name && { name: next.name })
                };
            } else {
                merged.push(current);
                current = next;
            }
        }
        
        merged.push(current);
        return merged;
    }

    _getDefinitionName(node) {
        for (const child of node.children) {
            if (child.type === 'identifier') {
                return child.text;
            }
        }
        return '';
    }

    generateChunkId(filePath, startLine, endLine) {
        const identifier = `${filePath}:${startLine}:${endLine}`;
        return crypto.createHash('sha256').update(identifier).digest('hex');
    }
}

module.exports = AstParser;