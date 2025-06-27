const crypto = require('crypto');
const path = require('path');
const KeyManager = require('./keyManager');
const CryptoUtils = require('./cryptoUtils');
const Logger = require('../utils/logger');

class PathEncryption {
    constructor(config = {}) {
        this.config = config;
        this.logger = new Logger('PathEncryption', config.logLevel || 'info');
        
        // 加密配置
        this.algorithm = config.algorithm || 'aes-256-ctr';
        this.nonceLength = config.nonceLength || 6; // 6字节nonce
        this.encoding = config.encoding || 'base64';
        
        // 密钥管理器
        this.keyManager = null;
        this.cryptoUtils = null;
        
        // 缓存配置
        this.enableCache = config.enableCache !== false;
        this.encryptionCache = new Map(); // path -> encrypted
        this.decryptionCache = new Map(); // encrypted -> path
        this.maxCacheSize = config.maxCacheSize || 1000;
        
        // 分隔符配置
        this.pathSeparator = config.pathSeparator || '/';
        this.extensionSeparator = config.extensionSeparator || '.';
    }

    async initialize() {
        try {
            this.logger.info('Initializing PathEncryption...');
            
            // 检查是否启用安全功能
            if (this.config.enabled === false) {
                this.logger.info('Security is disabled, PathEncryption will use passthrough mode');
                return;
            }
            
            // 1. 初始化密钥管理器
            this.keyManager = new KeyManager(this.config.keyManager);
            await this.keyManager.initialize();
            
            // 2. 初始化加密工具
            this.cryptoUtils = new CryptoUtils({
                algorithm: this.algorithm,
                nonceLength: this.nonceLength
            });
            
            // 3. 验证加密设置（仅在生产环境）
            if (process.env.NODE_ENV === 'production') {
                await this._validateEncryptionSetup();
            } else {
                this.logger.info('Skipping encryption validation in non-production environment');
            }
            
            this.logger.info('PathEncryption initialized successfully');
            
        } catch (error) {
            this.logger.error('Failed to initialize PathEncryption:', error);
            throw error;
        }
    }

    encryptPath(originalPath) {
        if (!originalPath || typeof originalPath !== 'string') {
            throw new Error('Invalid path for encryption');
        }
        
        // 如果安全功能禁用，直接返回原始路径
        if (this.config.enabled === false) {
            return originalPath;
        }
        
        try {
            // 检查缓存
            if (this.enableCache && this.encryptionCache.has(originalPath)) {
                return this.encryptionCache.get(originalPath);
            }
            
            // 标准化路径
            const normalizedPath = this._normalizePath(originalPath);
            console.log('标准化路径:', normalizedPath);
            
            // 分解路径
            const pathInfo = this._segmentPath(normalizedPath);
            console.log('路径分段结果:', JSON.stringify(pathInfo, null, 2));
            
            if (!pathInfo || !pathInfo.segments || !Array.isArray(pathInfo.segments)) {
                throw new Error('Invalid path segmentation result');
            }
            
            // 加密每个段
            const encryptedSegments = {
                isAbsolute: pathInfo.isAbsolute,
                segments: pathInfo.segments.map(segment => this._encryptSegment(segment))
            };
            
            // 重组路径
            const encryptedPath = this._reassemblePath(encryptedSegments, pathInfo.isAbsolute);
            
            // 更新缓存
            if (this.enableCache) {
                this._updateEncryptionCache(originalPath, encryptedPath);
            }
            
            this.logger.debug(`Encrypted path: ${originalPath.length} chars -> ${encryptedPath.length} chars`);
            
            return encryptedPath;
            
        } catch (error) {
            this.logger.error(`Error encrypting path "${originalPath}":`, error);
            throw error;
        }
    }

    decryptPath(encryptedPath) {
        if (!encryptedPath || typeof encryptedPath !== 'string') {
            throw new Error('Invalid encrypted path for decryption');
        }
        
        // 如果安全功能禁用，直接返回原始路径
        if (this.config.enabled === false) {
            return encryptedPath;
        }
        
        try {
            // 检查缓存
            if (this.enableCache && this.decryptionCache.has(encryptedPath)) {
                return this.decryptionCache.get(encryptedPath);
            }
            
            // 分解加密路径
            const encryptedSegments = this._segmentEncryptedPath(encryptedPath);
            console.log('加密路径分段结果:', JSON.stringify(encryptedSegments, null, 2));
            
            if (!encryptedSegments || !encryptedSegments.segments || !Array.isArray(encryptedSegments.segments)) {
                throw new Error('Invalid encrypted path segmentation result');
            }
            
            // 解密每个段
            const decryptedSegments = {
                isAbsolute: encryptedSegments.isAbsolute,
                segments: encryptedSegments.segments.map(segment => this._decryptSegment(segment))
            };
            
            // 重组原始路径
            const originalPath = this._reassembleOriginalPath(decryptedSegments, encryptedPath);
            
            // 更新缓存
            if (this.enableCache) {
                this._updateDecryptionCache(encryptedPath, originalPath);
            }
            
            this.logger.debug(`Decrypted path: ${encryptedPath.length} chars -> ${originalPath.length} chars`);
            
            return originalPath;
            
        } catch (error) {
            this.logger.error(`Error decrypting path "${encryptedPath}":`, error);
            throw error;
        }
    }

    // 批量加密
    encryptPaths(paths) {
        if (!Array.isArray(paths)) {
            throw new Error('Paths must be an array');
        }
        
        return paths.map(path => ({
            original: path,
            encrypted: this.encryptPath(path)
        }));
    }

    // 批量解密
    decryptPaths(encryptedPaths) {
        if (!Array.isArray(encryptedPaths)) {
            throw new Error('Encrypted paths must be an array');
        }
        
        return encryptedPaths.map(encryptedPath => ({
            encrypted: encryptedPath,
            decrypted: this.decryptPath(encryptedPath)
        }));
    }

    // 内部方法
    _normalizePath(pathStr) {
        // 标准化路径分隔符
        return pathStr.replace(/\\/g, this.pathSeparator);
    }

    _segmentPath(pathStr) {
        // 分解路径为段
        const segments = [];
        
        // 处理绝对路径标识
        let workingPath = pathStr;
        let isAbsolute = false;
        
        if (workingPath.startsWith(this.pathSeparator)) {
            isAbsolute = true;
            workingPath = workingPath.substring(1);
        }
        
        // 分割路径段
        const pathParts = workingPath.split(this.pathSeparator).filter(part => part.length > 0);
        
        for (const part of pathParts) {
            // 处理文件名和扩展名
            if (part.includes(this.extensionSeparator)) {
                const lastDotIndex = part.lastIndexOf(this.extensionSeparator);
                const filename = part.substring(0, lastDotIndex);
                const extension = part.substring(lastDotIndex + 1);
                
                if (filename.length > 0) {
                    segments.push({ type: 'filename', value: filename });
                }
                if (extension.length > 0) {
                    segments.push({ type: 'extension', value: extension });
                }
            } else {
                segments.push({ type: 'directory', value: part });
            }
        }
        
        return {
            isAbsolute,
            segments
        };
    }

    _encryptSegment(segment) {
        const key = this.keyManager.getEncryptionKey();
        const nonce = this._generateNonce(segment.value);
        
        // 加密数据
        const encrypted = this.cryptoUtils.encrypt(segment.value, key, nonce);
        
        // 返回加密后的段
        return {
            type: segment.type,
            value: encrypted
        };
    }

    _decryptSegment(encryptedSegment) {
        const key = this.keyManager.getEncryptionKey();
        
        try {
            // 直接传递加密字符串给cryptoUtils.decrypt
            const decrypted = this.cryptoUtils.decrypt(encryptedSegment.value, key);
            
            return {
                type: encryptedSegment.type,
                value: decrypted
            };
        } catch (error) {
            this.logger.error(`Failed to decrypt segment: ${error.message}`);
            throw error;
        }
    }

    _generateNonce(value) {
        // 生成确定性nonce
        const hash = crypto.createHash('sha256').update(value).digest();
        return hash.subarray(0, this.nonceLength);
    }

    _reassemblePath(encryptedSegments, originalPath) {
        const { isAbsolute, segments } = encryptedSegments;
        
        let path = '';
        if (isAbsolute) {
            path = this.pathSeparator;
        }
        
        let currentFileName = '';
        
        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            
            switch (segment.type) {
                case 'directory':
                    if (currentFileName) {
                        path += currentFileName + this.pathSeparator;
                        currentFileName = '';
                    }
                    path += segment.value + this.pathSeparator;
                    break;
                    
                case 'filename':
                    if (currentFileName) {
                        path += currentFileName + this.pathSeparator;
                    }
                    currentFileName = segment.value;
                    break;
                    
                case 'extension':
                    if (currentFileName) {
                        currentFileName += this.extensionSeparator + segment.value;
                    } else {
                        path += this.extensionSeparator + segment.value;
                    }
                    break;
            }
        }
        
        if (currentFileName) {
            path += currentFileName;
        }
        
        // 移除末尾的分隔符（如果不是根目录）
        if (path.length > 1 && path.endsWith(this.pathSeparator)) {
            path = path.substring(0, path.length - 1);
        }
        
        return path;
    }

    _segmentEncryptedPath(encryptedPath) {
        // 分解路径为段
        const segments = [];
        
        // 处理绝对路径标识
        let workingPath = encryptedPath;
        let isAbsolute = false;
        
        if (workingPath.startsWith(this.pathSeparator)) {
            isAbsolute = true;
            workingPath = workingPath.substring(1);
        }
        
        // 分割路径段
        const pathParts = workingPath.split(this.pathSeparator).filter(part => part.length > 0);
        
        for (let i = 0; i < pathParts.length; i++) {
            const part = pathParts[i];
            const isLastPart = i === pathParts.length - 1;
            
            if (isLastPart && part.includes('.')) {
                // 处理最后一个部分，它可能包含文件名和扩展名
                const parts = part.split('.');
                if (parts.length >= 2) {
                    // 第一个部分是文件名
                    segments.push({
                        type: 'filename',
                        value: parts[0] + '.' + parts[1]
                    });
                    // 第二个部分是扩展名
                    if (parts.length >= 3) {
                        segments.push({
                            type: 'extension',
                            value: parts[2] + '.' + parts[3]
                        });
                    }
                } else {
                    segments.push({
                        type: 'directory',
                        value: part
                    });
                }
            } else {
                segments.push({
                    type: 'directory',
                    value: part
                });
            }
        }
        
        return {
            isAbsolute,
            segments
        };
    }

    _reassembleOriginalPath(decryptedSegments, originalEncryptedPath) {
        return this._reassemblePath(decryptedSegments, originalEncryptedPath);
    }

    _updateEncryptionCache(original, encrypted) {
        if (this.encryptionCache.size >= this.maxCacheSize) {
            // 简单的LRU策略：删除最早的条目
            const firstKey = this.encryptionCache.keys().next().value;
            this.encryptionCache.delete(firstKey);
        }
        
        this.encryptionCache.set(original, encrypted);
    }

    _updateDecryptionCache(encrypted, decrypted) {
        if (this.decryptionCache.size >= this.maxCacheSize) {
            const firstKey = this.decryptionCache.keys().next().value;
            this.decryptionCache.delete(firstKey);
        }
        
        this.decryptionCache.set(encrypted, decrypted);
    }

    async _validateEncryptionSetup() {
        try {
            const testPath = '/test/path/file.txt';
            console.log('验证加密设置，测试路径:', testPath);
            
            // 测试路径分段
            const pathInfo = this._segmentPath(testPath);
            console.log('路径分段结果:', JSON.stringify(pathInfo, null, 2));
            
            // 测试加密
            const encrypted = this.encryptPath(testPath);
            console.log('加密结果:', encrypted);
            
            // 测试解密
            const decrypted = this.decryptPath(encrypted);
            console.log('解密结果:', decrypted);
            
            if (decrypted !== testPath) {
                throw new Error(`Encryption/decryption validation failed: ${decrypted} !== ${testPath}`);
            }
            
            this.logger.debug('Encryption setup validation passed');
            
        } catch (error) {
            console.error('加密设置验证失败:', error);
            throw new Error(`Encryption setup validation failed: ${error.message}`);
        }
    }

    // 工具方法
    clearCache() {
        this.encryptionCache.clear();
        this.decryptionCache.clear();
        this.logger.debug('Encryption cache cleared');
    }

    getCacheStats() {
        return {
            encryptionCacheSize: this.encryptionCache.size,
            decryptionCacheSize: this.decryptionCache.size,
            maxCacheSize: this.maxCacheSize
        };
    }

    async shutdown() {
        try {
            if (this.keyManager) {
                await this.keyManager.shutdown();
                this.keyManager = null;
            }
            
            if (this.enableCache) {
                this.clearCache();
            }
            
            this.logger.info('PathEncryption shutdown completed');
            
        } catch (error) {
            this.logger.error('Error during PathEncryption shutdown:', error);
        }
    }
}

module.exports = PathEncryption;