const Logger = require('../utils/logger');

class SecurityValidator {
    constructor(config) {
        this.config = config;
        this.logger = new Logger('SecurityValidator', config.logLevel);
        
        // 验证规则配置
        this.pathLengthLimit = config.pathLengthLimit || 4096;
        this.allowedCharacters = config.allowedCharacters || /^[a-zA-Z0-9\/\\\-_\.\s\u4e00-\u9fff]+$/;
        this.sensitivePatterns = config.sensitivePatterns || [
            /password/i,
            /secret/i,
            /token/i,
            /key/i,
            /credential/i
        ];
    }

    validatePath(path) {
        const violations = [];
        
        // 检查路径长度
        if (path.length > this.pathLengthLimit) {
            violations.push(`Path length exceeds limit: ${path.length} > ${this.pathLengthLimit}`);
        }
        
        // 检查字符合法性
        if (!this.allowedCharacters.test(path)) {
            violations.push('Path contains invalid characters');
        }
        
        // 检查路径遍历攻击
        if (this._containsPathTraversal(path)) {
            violations.push('Path contains potential directory traversal');
        }
        
        // 检查敏感信息
        if (this._containsSensitiveInfo(path)) {
            violations.push('Path may contain sensitive information');
        }
        
        return {
            isValid: violations.length === 0,
            violations: violations
        };
    }

    validateEncryptedData(encryptedData) {
        const violations = [];
        
        // 检查加密数据格式
        if (!encryptedData || typeof encryptedData !== 'string') {
            violations.push('Invalid encrypted data format');
        }
        
        // 检查数据长度合理性
        if (encryptedData.length < 10 || encryptedData.length > 10000) {
            violations.push('Encrypted data length is suspicious');
        }
        
        // 检查是否包含明文特征
        if (this._containsPlaintextFeatures(encryptedData)) {
            violations.push('Data may not be properly encrypted');
        }
        
        return {
            isValid: violations.length === 0,
            violations: violations
        };
    }

    validateVectorData(vectorData) {
        const violations = [];
        
        // 检查必要字段
        const requiredFields = ['id', 'vector', 'filePath'];
        for (const field of requiredFields) {
            if (!vectorData[field]) {
                violations.push(`Missing required field: ${field}`);
            }
        }
        
        // 检查向量格式
        if (vectorData.vector) {
            if (!Array.isArray(vectorData.vector)) {
                violations.push('Vector must be an array');
            } else if (vectorData.vector.some(v => typeof v !== 'number')) {
                violations.push('Vector must contain only numbers');
            }
        }
        
        // 检查ID格式
        if (vectorData.id && (typeof vectorData.id !== 'string' || vectorData.id.length === 0)) {
            violations.push('ID must be a non-empty string');
        }
        
        return {
            isValid: violations.length === 0,
            violations: violations
        };
    }

    // 内部方法
    _containsPathTraversal(path) {
        const traversalPatterns = [
            /\.\./,
            /\.\/\.\./,
            /\.\.\\/,
            /%2e%2e/i,
            /%252e%252e/i
        ];
        
        return traversalPatterns.some(pattern => pattern.test(path));
    }

    _containsSensitiveInfo(path) {
        return this.sensitivePatterns.some(pattern => pattern.test(path));
    }

    _containsPlaintextFeatures(data) {
        // 检查是否包含明显的明文特征
        const plaintextPatterns = [
            /^[a-zA-Z0-9\/\\]+$/, // 纯路径字符
            /\.(txt|log|conf|ini)$/i, // 常见文件扩展名
            /^(C:|D:|\/home|\/usr|\/var)/i // 常见路径前缀
        ];
        
        return plaintextPatterns.some(pattern => pattern.test(data));
    }

    sanitizePath(path) {
        // 清理路径中的危险字符
        let sanitized = path;
        
        // 移除路径遍历序列
        sanitized = sanitized.replace(/\.\.+/g, '.');
        
        // 标准化路径分隔符
        sanitized = sanitized.replace(/[\\\/]+/g, '/');
        
        // 移除多余的空格
        sanitized = sanitized.trim();
        
        // 限制长度
        if (sanitized.length > this.pathLengthLimit) {
            sanitized = sanitized.substring(0, this.pathLengthLimit);
        }
        
        return sanitized;
    }

    maskSensitiveData(data) {
        let masked = data;
        
        // 遮蔽敏感信息
        for (const pattern of this.sensitivePatterns) {
            masked = masked.replace(pattern, '***');
        }
        
        return masked;
    }
}

module.exports = SecurityValidator;