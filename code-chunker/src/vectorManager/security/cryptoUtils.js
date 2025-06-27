const crypto = require('crypto');

class CryptoUtils {
    constructor(config) {
        this.algorithm = config.algorithm || 'aes-256-ctr';
        this.nonceLength = config.nonceLength || 6;
        this.encoding = config.encoding || 'base64';
    }

    encrypt(plaintext, key, nonce) {
        try {
            console.log('加密参数:', {
                plaintext,
                keyLength: key.length,
                nonceLength: nonce ? nonce.length : 0
            });
            
            // 创建cipher实例
            let cipher;
            
            // 如果提供了nonce，设置初始向量
            if (nonce) {
                const iv = Buffer.alloc(16);
                nonce.copy(iv, 0, 0, Math.min(nonce.length, 16));
                console.log('使用IV:', iv.toString('hex'));
                cipher = crypto.createCipheriv(this.algorithm, key, iv);
            } else {
                // 为兼容性，如果没有nonce则使用零初始向量
                const iv = Buffer.alloc(16, 0);
                cipher = crypto.createCipheriv(this.algorithm, key, iv);
            }
            
            // 加密数据
            let encrypted = cipher.update(plaintext, 'utf8', this.encoding);
            encrypted += cipher.final(this.encoding);
            
            // 如果使用了nonce，将其添加到结果前面
            if (nonce) {
                const nonceStr = nonce.toString(this.encoding);
                const result = nonceStr + '.' + encrypted;
                console.log('加密结果:', result);
                return result;
            }
            
            console.log('加密结果:', encrypted);
            return encrypted;
            
        } catch (error) {
            console.error('加密失败:', error);
            throw new Error(`Encryption failed: ${error.message}`);
        }
    }
    
    decrypt(ciphertext, key) {
        try {
            console.log('解密参数:', {
                ciphertext,
                keyLength: key.length
            });
            
            let nonce = null;
            let encrypted = ciphertext;
            
            // 检查是否包含nonce
            if (ciphertext.includes('.')) {
                const parts = ciphertext.split('.');
                if (parts.length === 2) {
                    nonce = Buffer.from(parts[0], this.encoding);
                    encrypted = parts[1];
                    console.log('提取的nonce:', nonce.toString('hex'));
                }
            }
            
            // 创建decipher实例
            let decipher;
            if (nonce) {
                const iv = Buffer.alloc(16);
                nonce.copy(iv, 0, 0, Math.min(nonce.length, 16));
                console.log('使用IV:', iv.toString('hex'));
                decipher = crypto.createDecipheriv(this.algorithm, key, iv);
            } else {
                // 为兼容性，如果没有nonce则使用零初始向量
                const iv = Buffer.alloc(16, 0);
                decipher = crypto.createDecipheriv(this.algorithm, key, iv);
            }
            
            // 解密数据
            let decrypted = decipher.update(encrypted, this.encoding, 'utf8');
            decrypted += decipher.final('utf8');
            
            console.log('解密结果:', decrypted);
            return decrypted;
            
        } catch (error) {
            console.error('解密失败:', error);
            throw new Error(`Decryption failed: ${error.message}`);
        }
    }

    hash(data, algorithm = 'sha256') {
        try {
            return crypto.createHash(algorithm).update(data).digest('hex');
        } catch (error) {
            throw new Error(`Hashing failed: ${error.message}`);
        }
    }

    generateRandomBytes(length) {
        return crypto.randomBytes(length);
    }

    generateSecureToken(length = 32) {
        return crypto.randomBytes(length).toString('hex');
    }

    verifyIntegrity(data, expectedHash, algorithm = 'sha256') {
        const actualHash = this.hash(data, algorithm);
        return actualHash === expectedHash;
    }
}

module.exports = CryptoUtils;