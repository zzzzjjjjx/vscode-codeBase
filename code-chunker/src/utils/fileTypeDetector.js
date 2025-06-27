const crypto = require('crypto');

/**
 * 文件类型检测工具类
 * 用于检测二进制文件和文本文件编码
 */
class FileTypeDetector {
    constructor() {
        // 常见二进制文件扩展名
        this.binaryExtensions = new Set([
            '.exe', '.dll', '.so', '.dylib', '.app',  // 可执行文件
            '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.ico', '.svg', '.webp',  // 图片
            '.mp3', '.wav', '.mp4', '.avi', '.mov', '.mkv', '.flv',  // 音视频
            '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz',  // 压缩文件
            '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',  // 办公文档
            '.bin', '.dat', '.db', '.sqlite', '.mdb',  // 数据库/二进制数据
            '.ttf', '.otf', '.woff', '.woff2',  // 字体文件
            '.class', '.jar', '.pyc', '.o', '.obj',  // 编译文件
        ]);

        // 常见文本文件扩展名
        this.textExtensions = new Set([
            '.txt', '.md', '.json', '.xml', '.html', '.htm', '.css', '.js', '.ts',
            '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.php', '.rb',
            '.go', '.rs', '.swift', '.kt', '.scala', '.sh', '.bat', '.ps1',
            '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.log',
            '.sql', '.r', '.m', '.pl', '.lua', '.vim', '.dockerfile'
        ]);

        // 常见文件魔数（前几个字节的特征）
        this.binarySignatures = [
            [0x89, 0x50, 0x4E, 0x47],  // PNG
            [0xFF, 0xD8, 0xFF],         // JPEG
            [0x47, 0x49, 0x46, 0x38],  // GIF
            [0x25, 0x50, 0x44, 0x46],  // PDF
            [0x50, 0x4B, 0x03, 0x04],  // ZIP
            [0x50, 0x4B, 0x05, 0x06],  // ZIP (empty)
            [0x50, 0x4B, 0x07, 0x08],  // ZIP (spanned)
            [0x52, 0x61, 0x72, 0x21],  // RAR
            [0x7F, 0x45, 0x4C, 0x46],  // ELF (Linux执行文件)
            [0x4D, 0x5A],               // Windows PE执行文件
            [0xCA, 0xFE, 0xBA, 0xBE],  // Java class文件
        ];
    }

    /**
     * 检测文件是否为二进制文件
     * @param {Buffer} buffer 文件内容缓冲区
     * @param {string} filePath 文件路径（用于扩展名检测）
     * @returns {boolean} 是否为二进制文件
     */
    isBinaryFile(buffer, filePath = '') {
        // 1. 根据扩展名快速判断
        const ext = this._getFileExtension(filePath).toLowerCase();
        if (this.binaryExtensions.has(ext)) {
            return true;
        }
        if (this.textExtensions.has(ext)) {
            return false;
        }

        // 2. 检查文件魔数
        if (this._hasBinarySignature(buffer)) {
            return true;
        }

        // 3. 检查是否包含空字节（null字符）
        // 大多数二进制文件包含空字节，而文本文件很少有
        const sampleSize = Math.min(8192, buffer.length);  // 检查前8KB
        const sample = buffer.slice(0, sampleSize);
        
        // 检查空字节
        if (sample.includes(0)) {
            return true;
        }

        // 4. 检查不可打印字符的比例
        let nonPrintableCount = 0;
        for (let i = 0; i < sampleSize; i++) {
            const byte = sample[i];
            // 不可打印的ASCII字符（除了常见的空白字符）
            if (byte < 9 || (byte > 13 && byte < 32) || byte === 127) {
                nonPrintableCount++;
            }
        }

        // 如果不可打印字符超过30%，认为是二进制文件
        const nonPrintableRatio = nonPrintableCount / sampleSize;
        if (nonPrintableRatio > 0.3) {
            return true;
        }

        // 5. 检查UTF-8编码的有效性
        try {
            buffer.toString('utf8');
            // 如果能成功转换为UTF-8且没有太多不可打印字符，认为是文本文件
            return false;
        } catch (error) {
            // 如果不能转换为有效的UTF-8，可能是二进制文件
            return true;
        }
    }

    /**
     * 检测文本文件的编码
     * @param {Buffer} buffer 文件内容缓冲区
     * @returns {string|null} 检测到的编码，如果检测失败返回null
     */
    detectEncoding(buffer) {
        // 检查BOM（字节顺序标记）
        if (buffer.length >= 3) {
            // UTF-8 BOM
            if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
                return 'utf8';
            }
        }
        
        if (buffer.length >= 2) {
            // UTF-16 LE BOM
            if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
                return 'utf16le';
            }
            // UTF-16 BE BOM
            if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
                return 'utf16be';
            }
        }

        // 尝试UTF-8检测
        if (this._isValidUTF8(buffer)) {
            return 'utf8';
        }

        // 简单的ASCII检测
        if (this._isAscii(buffer)) {
            return 'ascii';
        }

        // 如果无法确定，返回null让调用者决定
        return null;
    }

    /**
     * 读取文件内容并返回详细信息
     * @param {Buffer} buffer 文件内容缓冲区
     * @param {string} filePath 文件路径
     * @returns {Object} 文件信息对象
     */
    analyzeFile(buffer, filePath = '') {
        const isBinary = this.isBinaryFile(buffer, filePath);
        
        if (isBinary) {
            return {
                content: null,
                hash: crypto.createHash('sha256').update(buffer).digest('hex'),
                isBinary: true,
                encoding: null,
                size: buffer.length
            };
        } else {
            const encoding = this.detectEncoding(buffer) || 'utf8';
            let content;
            
            try {
                content = buffer.toString(encoding);
            } catch (error) {
                // 如果编码转换失败，退回到utf8
                try {
                    content = buffer.toString('utf8');
                } catch (utf8Error) {
                    // 如果连utf8都失败，可能是二进制文件被误判
                    return {
                        content: null,
                        hash: crypto.createHash('sha256').update(buffer).digest('hex'),
                        isBinary: true,
                        encoding: null,
                        size: buffer.length,
                        error: 'Encoding conversion failed'
                    };
                }
            }
            
            return {
                content: content,
                hash: crypto.createHash('sha256').update(buffer).digest('hex'),
                isBinary: false,
                encoding: encoding,
                size: buffer.length
            };
        }
    }

    /**
     * 获取文件扩展名
     * @private
     */
    _getFileExtension(filePath) {
        const lastDot = filePath.lastIndexOf('.');
        return lastDot === -1 ? '' : filePath.substring(lastDot);
    }

    /**
     * 检查是否有二进制文件魔数
     * @private
     */
    _hasBinarySignature(buffer) {
        if (buffer.length < 4) return false;
        
        for (const signature of this.binarySignatures) {
            if (this._matchesSignature(buffer, signature)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 检查缓冲区是否匹配特定的魔数
     * @private
     */
    _matchesSignature(buffer, signature) {
        if (buffer.length < signature.length) return false;
        
        for (let i = 0; i < signature.length; i++) {
            if (buffer[i] !== signature[i]) {
                return false;
            }
        }
        return true;
    }

    /**
     * 检查是否为有效的UTF-8编码
     * @private
     */
    _isValidUTF8(buffer) {
        try {
            const str = buffer.toString('utf8');
            // 检查转换后的字符串是否包含Unicode替换字符
            // 这通常表明原始数据不是有效的UTF-8
            return !str.includes('\uFFFD');
        } catch (error) {
            return false;
        }
    }

    /**
     * 检查是否为纯ASCII编码
     * @private
     */
    _isAscii(buffer) {
        for (let i = 0; i < buffer.length; i++) {
            if (buffer[i] > 127) {
                return false;
            }
        }
        return true;
    }
}

module.exports = FileTypeDetector;