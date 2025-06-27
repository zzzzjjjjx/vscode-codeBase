const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');
const Logger = require('../utils/logger');

class KeyManager {
    constructor(config = {}) {
        this.config = config;
        this.logger = new Logger('KeyManager', config.logLevel || 'info');
        
        // 密钥配置
        this.keyLength = config.keyLength || 32; // 256位密钥
        this.keyDerivationIterations = config.keyDerivationIterations || 100000;
        this.keyDerivationAlgorithm = config.keyDerivationAlgorithm || 'pbkdf2';
        
        // 存储配置
        this.keyStorePath = config.keyStorePath || path.join(process.cwd(), '.vector-keys');
        this.keyFileName = config.keyFileName || 'master.key';
        this.secureStorage = config.secureStorage !== false;
        
        // 内存中的密钥
        this.masterKey = null;
        this.derivedKeys = new Map(); // purpose -> key
        
        // 密钥轮换
        this.enableKeyRotation = config.enableKeyRotation !== false;
        
        // 根据环境设置不同的轮换间隔
        if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
            // 测试和开发环境：禁用自动轮换
            this.enableKeyRotation = false;
            this.keyRotationInterval = 60 * 60 * 1000; // 1小时（如果手动启用）
        } else {
            // 生产环境：30天
            this.keyRotationInterval = config.keyRotationInterval || 30 * 24 * 60 * 60 * 1000;
        }
        
        this.keyRotationTimer = null;
        
        // 如果父级配置明确禁用了VectorManager，也禁用密钥轮换
        if (config.enabled === false) {
            this.enableKeyRotation = false;
        }
    }

    
    async initialize() {
        try {
            this.logger.info('Initializing KeyManager...');
            
            // 1. 确保密钥存储目录存在
            await this._ensureKeyStoreDirectory();
            
            // 2. 加载或生成主密钥
            await this._loadOrGenerateMasterKey();
            
            // 3. 派生工作密钥
            await this._deriveWorkingKeys();
            
            // 4. 启动密钥轮换（如果启用）
            if (this.enableKeyRotation) {
                this._startKeyRotation();
            }
            
            this.logger.info('KeyManager initialized successfully');
            
        } catch (error) {
            this.logger.error('Failed to initialize KeyManager:', error);
            throw error;
        }
    }

    getEncryptionKey(purpose = 'default') {
        const key = this.derivedKeys.get(purpose);
        if (!key) {
            throw new Error(`No key found for purpose: ${purpose}`);
        }
        return key;
    }

    async generateNewKey(purpose = 'default') {
        try {
            const salt = crypto.randomBytes(16);
            const key = await this._deriveKey(this.masterKey, salt, purpose);
            
            this.derivedKeys.set(purpose, key);
            
            // 可选：持久化派生密钥信息（不包含密钥本身）
            await this._saveKeyMetadata(purpose, salt);
            
            this.logger.info(`Generated new key for purpose: ${purpose}`);
            return key;
            
        } catch (error) {
            this.logger.error(`Error generating key for purpose ${purpose}:`, error);
            throw error;
        }
    }

    async rotateKeys() {
        try {
            this.logger.info('Starting key rotation...');
            
            // 1. 生成新的主密钥
            const newMasterKey = crypto.randomBytes(this.keyLength);
            
            // 2. 备份当前密钥
            await this._backupCurrentKey();
            
            // 3. 更新主密钥
            this.masterKey = newMasterKey;
            
            // 4. 重新派生工作密钥
            await this._deriveWorkingKeys();
            
            // 5. 保存新密钥
            await this._saveMasterKey();
            
            this.logger.info('Key rotation completed successfully');
            
        } catch (error) {
            this.logger.error('Error during key rotation:', error);
            throw error;
        }
    }

    // 内部方法
    async _ensureKeyStoreDirectory() {
        try {
            await fs.ensureDir(this.keyStorePath);
            
            // 设置目录权限（仅所有者可访问）
            if (process.platform !== 'win32') {
                await fs.chmod(this.keyStorePath, 0o700);
            }
            
        } catch (error) {
            throw new Error(`Failed to create key store directory: ${error.message}`);
        }
    }

    async _loadOrGenerateMasterKey() {
        const keyFilePath = path.join(this.keyStorePath, this.keyFileName);

        try {
            if (await fs.pathExists(keyFilePath)) {
                // 加载现有密钥
                await this._loadMasterKey();
                this.logger.debug('Loaded existing master key');
            } else {
                // 生成新密钥
                await this._generateMasterKey();
                await this._saveMasterKey();
                this.logger.info('Generated new master key');
            }
            
        } catch (error) {
            console.error('加载或生成密钥失败:', error);
            throw new Error(`Failed to load or generate master key: ${error.message}`);
        }
    }

    async _generateMasterKey() {
        this.masterKey = crypto.randomBytes(this.keyLength);
    }

    async _loadMasterKey() {
        const keyFilePath = path.join(this.keyStorePath, this.keyFileName);
        
        try {
            const keyData = await fs.readFile(keyFilePath);
            
            // 检查空文件
            if (keyData.length === 0) {
                await fs.remove(keyFilePath);
                await this._generateMasterKey();
                await this._saveMasterKey();
                return;
            }
            
            if (this.secureStorage) {
                this.masterKey = this._decryptStoredKey(keyData);
            } else {
                // 如果密钥长度不足，用0填充
                if (keyData.length < this.keyLength) {
                    this.masterKey = Buffer.concat([keyData, Buffer.alloc(this.keyLength - keyData.length)]);
                } else if (keyData.length > this.keyLength) {
                    this.masterKey = keyData.slice(0, this.keyLength);
                } else {
                    this.masterKey = keyData;
                }
            }
            
            if (this.masterKey.length !== this.keyLength) {
                throw new Error(`Invalid key length: ${this.masterKey.length} (expected ${this.keyLength})`);
            }
            
        } catch (error) {
            console.error('加载密钥失败:', error);
            throw new Error(`Failed to load master key: ${error.message}`);
        }
    }

    async _saveMasterKey() {
        const keyFilePath = path.join(this.keyStorePath, this.keyFileName);
        
        try {
            let keyData = this.masterKey;
            
            if (this.secureStorage) {
                // 如果启用了安全存储，加密密钥后存储
                keyData = this._encryptKeyForStorage(this.masterKey);
            }
            
            await fs.writeFile(keyFilePath, keyData);
            
            // 设置文件权限（仅所有者可读写）
            if (process.platform !== 'win32') {
                await fs.chmod(keyFilePath, 0o600);
            }
            
        } catch (error) {
            throw new Error(`Failed to save master key: ${error.message}`);
        }
    }

    async _deriveWorkingKeys() {
        const purposes = ['default', 'path', 'metadata'];
        
        for (const purpose of purposes) {
            const salt = this._generateDeterministicSalt(purpose);
            const key = await this._deriveKey(this.masterKey, salt, purpose);
            this.derivedKeys.set(purpose, key);
        }
        
        this.logger.debug(`Derived ${purposes.length} working keys`);
    }

    async _deriveKey(masterKey, salt, purpose) {
        return new Promise((resolve, reject) => {
            crypto.pbkdf2(masterKey, salt, this.keyDerivationIterations, this.keyLength, 'sha256', (err, derivedKey) => {
                if (err) {
                    reject(new Error(`Key derivation failed for ${purpose}: ${err.message}`));
                } else {
                    resolve(derivedKey);
                }
            });
        });
    }

    _generateDeterministicSalt(purpose) {
        // 生成确定性盐值，基于用途和一些固定值
        const hash = crypto.createHash('sha256');
        hash.update(purpose);
        hash.update(this.config.applicationId || 'vectormanager');
        return hash.digest().subarray(0, 16); // 使用前16字节作为盐值
    }

    async _backupCurrentKey() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFileName = `master_${timestamp}.key.bak`;
        const backupPath = path.join(this.keyStorePath, backupFileName);
        
        try {
            const currentKeyPath = path.join(this.keyStorePath, this.keyFileName);
            
            if (await fs.pathExists(currentKeyPath)) {
                await fs.copy(currentKeyPath, backupPath);
                this.logger.debug(`Backed up current key to ${backupFileName}`);
            }
            
        } catch (error) {
            this.logger.warn(`Failed to backup current key: ${error.message}`);
        }
    }

    async _saveKeyMetadata(purpose, salt) {
        const metadataPath = path.join(this.keyStorePath, `${purpose}.metadata`);
        
        const metadata = {
            purpose: purpose,
            salt: salt.toString('base64'),
            createdAt: new Date().toISOString(),
            algorithm: this.keyDerivationAlgorithm,
            iterations: this.keyDerivationIterations
        };
        
        try {
            await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
            
        } catch (error) {
            this.logger.warn(`Failed to save key metadata for ${purpose}: ${error.message}`);
        }
    }

    _encryptKeyForStorage(key) {
        // 简化实现：使用系统特定的信息作为密码
        const password = this._getSystemPassword();
        const salt = crypto.randomBytes(16);
        const iv = crypto.randomBytes(16);
        
        const derivedKey = crypto.pbkdf2Sync(password, salt, 10000, 32, 'sha256');
        const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
        
        let encrypted = cipher.update(key);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        
        const authTag = cipher.getAuthTag();
        
        // 组合 salt + iv + authTag + encrypted
        return Buffer.concat([salt, iv, authTag, encrypted]);
    }

    _decryptStoredKey(encryptedData) {
        const password = this._getSystemPassword();
        // 解析组合数据
        const salt = encryptedData.subarray(0, 16);
        const iv = encryptedData.subarray(16, 32);
        const authTag = encryptedData.subarray(32, 48);
        const encrypted = encryptedData.subarray(48);
    

    
        const derivedKey = crypto.pbkdf2Sync(password, salt, 10000, 32, 'sha256');
        const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
        decipher.setAuthTag(authTag);
    
        let decrypted = decipher.update(encrypted);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
    
        return decrypted;
    }

    _getSystemPassword() {
        // 基于系统信息生成密码（简化实现）
        const systemInfo = [
            process.platform,
            process.arch,
            require('os').hostname(),
            this.config.applicationId || 'vectormanager'
        ].join('|');
        
        return crypto.createHash('sha256').update(systemInfo).digest();
    }

    _startKeyRotation() {
        // 防止重复启动定时器
        if (this.keyRotationTimer) {
            this.logger.warn('Key rotation timer already running, skipping start');
            return;
        }
        
        // 确保轮换间隔合理（至少1分钟）
        if (this.keyRotationInterval < 60000) {
            this.logger.warn(`Key rotation interval too short: ${this.keyRotationInterval}ms, setting to 1 hour`);
            this.keyRotationInterval = 60 * 60 * 1000; // 1小时
        }
        
        this.keyRotationTimer = setInterval(async () => {
            try {
                await this.rotateKeys();
            } catch (error) {
                this.logger.error('Automatic key rotation failed:', error);
            }
        }, this.keyRotationInterval);
        
        const dayInterval = this.keyRotationInterval / 1000 / 60 / 60 / 24;
        if (dayInterval >= 1) {
            this.logger.info(`Key rotation scheduled every ${dayInterval.toFixed(1)} days`);
        } else {
            const hourInterval = this.keyRotationInterval / 1000 / 60 / 60;
            this.logger.info(`Key rotation scheduled every ${hourInterval.toFixed(1)} hours`);
        }
    }

    async shutdown() {
        if (this.keyRotationTimer) {
            clearInterval(this.keyRotationTimer);
            this.keyRotationTimer = null;
        }
        
        // 清除内存中的密钥
        if (this.masterKey) {
            this.masterKey.fill(0);
            this.masterKey = null;
        }
        
        for (const [purpose, key] of this.derivedKeys) {
            key.fill(0);
        }
        this.derivedKeys.clear();
        
        this.logger.info('KeyManager shutdown completed');
    }
}

module.exports = KeyManager;