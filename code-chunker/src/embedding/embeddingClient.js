const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const backendApiConfig = require('../config/backendApiConfig');
const config = require('../config/config');

/**
 * 后端API嵌入客户端
 * 基于API文档v1.0.3实现
 */
class EmbeddingClient {
    constructor(options = {}) {
        // 从现有配置系统获取配置
        const userConfig = config.getAll();
        
        // 解析API端点（支持<SERVER_IP>占位符格式）
        let apiEndpoint = options.apiEndpoint || userConfig.apiEndpoint;
        if (apiEndpoint && apiEndpoint.includes('<SERVER_IP>')) {
            const serverIP = process.env.BACKEND_API_SERVER_IP || '42.193.14.136:8087';
            const protocol = process.env.BACKEND_API_PROTOCOL || 'http';
            apiEndpoint = apiEndpoint.replace('<SERVER_IP>', serverIP);
            
            // 如果协议不匹配，更新协议
            if (apiEndpoint.startsWith('https://') && protocol === 'http') {
                apiEndpoint = apiEndpoint.replace('https://', 'http://');
            } else if (apiEndpoint.startsWith('http://') && protocol === 'https') {
                apiEndpoint = apiEndpoint.replace('http://', 'https://');
            }
        }
        
        // 解析URL获取基础信息
        const url = new URL(apiEndpoint || 'http://42.193.14.136:8087/embed');
        this.baseURL = `${url.protocol}//${url.host}`;
        this.hostname = url.hostname;
        this.port = url.port || (url.protocol === 'https:' ? 443 : 80);
        this.path = url.pathname;
        this.protocol = url.protocol;
        
        // API配置
        this.apiKey = options.apiKey || userConfig.apiKey || '';
        this.timeout = options.timeout || userConfig.timeout || 30000;
        this.maxRetries = options.maxRetries || userConfig.maxRetries || 3;
        this.retryDelay = options.retryDelay || userConfig.retryDelay || 1000;
        
        // 请求头配置
        this.headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'CodeChunker-EmbeddingClient/1.0',
            ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` })
        };
        
        // 日志前缀
        this.logPrefix = '[EmbeddingClient]';
        
        console.log(`${this.logPrefix} EmbeddingClient initialized with baseURL: ${this.baseURL}`);
    }
    
    /**
     * 生成文本嵌入向量
     * @param {Array<string>} texts - 要生成嵌入的文本数组
     * @param {Object} options - 可选参数
     * @returns {Promise<Object>} 嵌入结果
     */
    async generateEmbeddings(texts, options = {}) {
        if (!Array.isArray(texts) || texts.length === 0) {
            throw new Error('texts must be a non-empty array');
        }
        
        // 检查文本长度，如果太长则截断
        const processedTexts = texts.map(text => {
            if (typeof text !== 'string') {
                return String(text);
            }
            // 限制单个文本块的最大长度（约8000字符，留出余量）
            if (text.length > 8000) {
                console.log(`${this.logPrefix} 文本过长(${text.length}字符)，截断到8000字符`);
                return text.substring(0, 8000) + '...';
            }
            return text;
        });
        
        const data = {
            texts: processedTexts,
            model: options.model || 'text-embedding-ada-002',
            ...options
        };
        
        return await this._makeRequest(data);
    }
    
    /**
     * 发起HTTP请求
     * @param {Object} data - 请求数据
     * @returns {Promise<Object>} 响应结果
     */
    async _makeRequest(data) {
        let lastError;
        
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const requestData = JSON.stringify(data);
                const requestOptions = {
                    hostname: this.hostname,
                    port: this.port,
                    path: this.path,
                    method: 'POST',
                    headers: {
                        ...this.headers,
                        'Content-Length': Buffer.byteLength(requestData, 'utf8')
                    },
                    timeout: this.timeout,
                    // 禁用代理避免连接问题
                    agent: false
                };
                
                const result = await this._httpRequest(requestOptions, requestData);
                return result;
                
            } catch (error) {
                lastError = error;
                console.error(`${this.logPrefix} Request attempt ${attempt} failed:`, error.message);
                
                if (attempt < this.maxRetries) {
                    const delay = this.retryDelay * attempt;
                    console.log(`${this.logPrefix} Retrying in ${delay}ms...`);
                    await this._sleep(delay);
                }
            }
        }
        
        throw new Error(`Request failed after ${this.maxRetries} attempts: ${lastError.message}`);
    }
    
    /**
     * 执行HTTP请求
     * @param {Object} options - 请求选项
     * @param {string} data - 请求数据
     * @returns {Promise<Object>} 响应结果
     */
    _httpRequest(options, data) {
        return new Promise((resolve, reject) => {
            const httpModule = this.protocol === 'https:' ? https : http;
            
            const req = httpModule.request(options, (res) => {
                let responseData = '';
                
                res.on('data', (chunk) => {
                    responseData += chunk;
                });
                
                res.on('end', () => {
                    try {
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            const result = JSON.parse(responseData);
                            resolve(result);
                        } else {
                            reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
                        }
                    } catch (error) {
                        reject(new Error(`Failed to parse response: ${error.message}`));
                    }
                });
            });
            
            req.on('error', (error) => {
                reject(error);
            });
            
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
            
            req.write(data);
            req.end();
        });
    }
    
    /**
     * 睡眠指定时间
     * @param {number} ms - 毫秒数
     * @returns {Promise<void>}
     */
    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * 健康检查
     * @returns {Promise<Object>} 健康状态
     */
    async healthCheck() {
        try {
            const result = await this._makeRequest({ texts: ['health check'] });
            return { status: 'healthy', details: result };
        } catch (error) {
            return { status: 'unhealthy', error: error.message };
        }
    }
    
    /**
     * 获取客户端信息
     * @returns {Object} 客户端信息
     */
    getInfo() {
        return {
            baseURL: this.baseURL,
            timeout: this.timeout,
            maxRetries: this.maxRetries,
            retryDelay: this.retryDelay
        };
    }
}

module.exports = EmbeddingClient; 