const axios = require('axios');
const Logger = require('../utils/logger');
const TencentVectorDB = require('./tencentVectorDB');

class DBConnection {
    constructor(config) {
        this.config = config;
        this.logger = new Logger('DBConnection', config.logLevel);
        
        // 连接配置
        this.host = config.host;
        this.port = config.port || 80;
        this.database = config.database;
        this.username = config.username;
        this.apiKey = config.apiKey;
        
        // HTTP 客户端配置
        this.timeout = config.timeout || 30000;
        this.maxRetries = config.maxRetries || 3;
        
        // 连接池配置
        this.maxConnections = config.maxConnections || 10;
        this.keepAlive = config.keepAlive !== false;
        
        // HTTP 客户端实例
        this.httpClient = null;
        
        // 连接状态
        this.isInitialized = false;
        this.lastError = null;
    }

    async initialize() {
        try {
            this.logger.info(`Initializing database connection to ${this.host}:${this.port}`);
            
            // 验证配置
            this._validateConfig();
            
            // 创建 HTTP 客户端
            this._createHttpClient();
            
            // 测试连接并自动创建数据库（如果需要）
            await this._testConnectionAndEnsureDatabase();
            
            this.isInitialized = true;
            this.logger.info('Database connection initialized successfully');
            
        } catch (error) {
            this.lastError = error;
            this.logger.error('Failed to initialize database connection:', error);
            throw error;
        }
    }

    async get(path, params = {}) {
        return this._makeRequest('GET', path, null, params);
    }

    async post(path, data, params = {}) {
        return this._makeRequest('POST', path, data, params);
    }

    async put(path, data, params = {}) {
        return this._makeRequest('PUT', path, data, params);
    }

    async delete(path, params = {}) {
        return this._makeRequest('DELETE', path, null, params);
    }

    // 内部方法
    _validateConfig() {
        const requiredFields = ['host', 'database', 'username', 'apiKey'];
        
        for (const field of requiredFields) {
            if (!this.config[field]) {
                throw new Error(`Missing required database config field: ${field}`);
            }
        }
    }

    _createHttpClient() {
        // 检查host是否已经包含协议前缀
        let baseURL;
        if (this.host.startsWith('http://') || this.host.startsWith('https://')) {
            // 如果host已经包含协议，直接使用
            baseURL = this.port && this.port !== 80 && this.port !== 443 
                ? `${this.host}:${this.port}` 
                : this.host;
        } else {
            // 如果host不包含协议，添加http前缀
            baseURL = `http://${this.host}:${this.port}`;
        }
        
        this.httpClient = axios.create({
            baseURL: baseURL,
            timeout: this.timeout,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': this._getAuthHeader()
            },
            // 连接池配置
            maxRedirects: 5,
            // 保持连接活跃
            ...(this.keepAlive && {
                'Connection': 'keep-alive',
                'Keep-Alive': 'timeout=30'
            }),
            // 禁用代理避免连接问题
            proxy: false
        });
        
        // 添加请求拦截器
        this.httpClient.interceptors.request.use(
            config => {
                this.logger.debug(`Making request: ${config.method?.toUpperCase()} ${config.url}`);
                return config;
            },
            error => {
                this.logger.error('Request interceptor error:', error);
                return Promise.reject(error);
            }
        );
        
        // 添加响应拦截器
        this.httpClient.interceptors.response.use(
            response => {
                this.logger.debug(`Response received: ${response.status} ${response.statusText}`);
                return response.data; // 直接返回数据部分
            },
            error => {
                this._handleResponseError(error);
                return Promise.reject(error);
            }
        );
    }

    _getAuthHeader() {
        // 构建认证头
        return `Bearer account=${this.username}&api_key=${this.apiKey}`;
    }

    async _makeRequest(method, path, data = null, params = {}) {
        if (!this.isInitialized) {
            throw new Error('Database connection not initialized');
        }
        
        try {
            const config = {
                method: method,
                url: path,
                params: params
            };
            
            if (data) {
                config.data = data;
            }
            
            const response = await this.httpClient.request(config);
            return response;
            
        } catch (error) {
            this.logger.error(`Request failed: ${method} ${path}`, error);
            throw this._processError(error);
        }
    }

    async _testConnectionAndEnsureDatabase() {
        try {
            // 对于腾讯云向量数据库，先测试连接再确保数据库存在
            if (this.config.type === 'tencent') {
                await this._testTencentConnection();
                await this._ensureDatabaseExists();
            } else {
                // 其他数据库类型的连接测试
                const response = await this.httpClient.get('/database/info');
                
                if (response.code !== 0) {
                    throw new Error(`Connection test failed: ${response.msg}`);
                }
                this.logger.debug('Database connection test passed');
            }
            
        } catch (error) {
            throw new Error(`Database connection test failed: ${error.message}`);
        }
    }

    async _testTencentConnection() {
        try {
            const response = await this.httpClient.get('/collections');
            this.logger.debug('Tencent VectorDB connection test passed');
        } catch (error) {
            // 如果是404错误，认为连接是正常的
            if (error.response && error.response.status === 404) {
                this.logger.warn('Connection test endpoint not found, but connection to Tencent VectorDB is working');
                return; // 连接测试通过
            }
            throw error;
        }
    }

    async _ensureDatabaseExists() {
        if (!this.database) {
            this.logger.warn('No database name specified, skipping database creation check');
            return;
        }

        try {
            this.logger.info(`Checking if database ${this.database} exists...`);
            
            // 创建腾讯云向量数据库客户端实例
            const tencentDB = new TencentVectorDB({
                host: this.host,
                port: this.port,
                username: this.username,
                apiKey: this.apiKey,
                timeout: this.timeout
            });
            
            await tencentDB.initialize();
            
            // 先尝试列出所有数据库，检查目标数据库是否存在
            let databaseExists = false;
            try {
                const databaseListResult = await tencentDB.listDatabases();
                const databases = databaseListResult.data?.databases || [];
                databaseExists = databases.some(db => db.database === this.database || db.name === this.database);
                
                if (databaseExists) {
                    this.logger.info(`Database ${this.database} exists in the database list`);
                } else {
                    this.logger.info(`Database ${this.database} not found in database list, needs to be created`);
                }
            } catch (error) {
                this.logger.warn(`Unable to list databases, will try direct access: ${error.message}`);
                // 如果无法列出数据库，就尝试直接访问
            }
            
            // 如果数据库不存在（或者无法确定），尝试创建
            if (!databaseExists) {
                try {
                    this.logger.info(`Attempting to create database ${this.database}...`);
                    const createResult = await tencentDB.createDatabase(this.database);
                    
                    if (createResult.success || createResult.message === 'Database already exists') {
                        this.logger.info(`Database ${this.database} created successfully`);
                        databaseExists = true;
                    } else {
                        this.logger.warn(`Database creation result unclear: ${JSON.stringify(createResult)}`);
                    }
                } catch (createError) {
                    if (createError.message.includes('already exist')) {
                        this.logger.info(`Database ${this.database} already exists`);
                        databaseExists = true;
                    } else {
                        this.logger.error(`Failed to create database: ${createError.message}`);
                        // 不抛出错误，继续尝试验证数据库
                    }
                }
            }
            
            // 最后验证数据库是否可访问
            try {
                await tencentDB.listCollections(this.database);
                this.logger.info(`Database ${this.database} is accessible`);
            } catch (error) {
                if (error.message.includes('can not find database') || 
                    error.message.includes('not exist')) {
                    throw new Error(`Database ${this.database} still does not exist after creation attempt`);
                } else {
                    // 其他错误可能不是致命的，只记录警告
                    this.logger.warn(`Database access test failed, but may be due to other reasons: ${error.message}`);
                }
            }
            
            await tencentDB.close();
            
        } catch (error) {
            this.logger.error(`Error ensuring database exists: ${error.message}`);
            throw error;
        }
    }

    _handleResponseError(error) {
        if (error.response) {
            // 服务器返回错误状态码
            const status = error.response.status;
            const message = error.response.data?.msg || error.response.statusText;
            
            switch (status) {
                case 401:
                    this.logger.error('Authentication failed - check API key');
                    break;
                case 403:
                    this.logger.error('Access forbidden - check permissions');
                    break;
                case 404:
                    this.logger.error('Resource not found');
                    break;
                case 429:
                    this.logger.error('Rate limit exceeded');
                    break;
                case 500:
                    this.logger.error('Database server error');
                    break;
                default:
                    this.logger.error(`HTTP error ${status}: ${message}`);
            }
            
        } else if (error.request) {
            // 网络错误
            this.logger.error('Network error:', error.message);
            
        } else {
            // 其他错误
            this.logger.error('Request setup error:', error.message);
        }
    }

    _processError(error) {
        // 根据错误类型进行分类处理
        if (error.code === 'ECONNREFUSED') {
            return new Error('Database connection refused - check host and port');
        }
        
        if (error.code === 'ETIMEDOUT') {
            return new Error('Database request timeout');
        }
        
        if (error.response && error.response.status === 401) {
            return new Error('Database authentication failed');
        }
        
        return error;
    }

    async close() {
        if (this.httpClient) {
            // 清理 HTTP 客户端
            this.httpClient = null;
        }
        
        this.isInitialized = false;
        this.logger.info('Database connection closed');
    }
}

module.exports = DBConnection;