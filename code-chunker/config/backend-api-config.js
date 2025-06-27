/**
 * Code Chunker 后端API集成配置
 * 基于后端API文档v1.0.3
 */

const path = require('path');

class BackendAPIConfig {
    constructor() {
        this.config = this._loadConfig();
    }

    _loadConfig() {
        // 从环境变量获取服务器IP，如果没有则使用默认值
        const serverIP = process.env.BACKEND_API_SERVER_IP || '42.193.14.136:8087';
        const protocol = process.env.BACKEND_API_PROTOCOL || 'http';
        
        // 构建基础URL
        const baseURL = `${protocol}://${serverIP}`;
        
        return {
            development: {
                baseURL: baseURL,
                endpoints: {
                    health: '/healthz',
                    version: '/version',
                    embed: '/api/v1/codebase/embed',
                    embedStatus: '/api/v1/codebase/embed/status',
                    embedResults: '/api/v1/codebase/embed/results',
                },
                auth: {
                    token: process.env.BACKEND_API_TOKEN || 'test_auth_token',
                },
                processing: {
                    mode: 'auto', // 'sync', 'async', 'auto'
                    syncThreshold: 20, // 小于等于20个块使用同步模式
                    batchSize: 15, // 推荐批次大小
                    maxConcurrency: 3,
                    timeout: 30000,
                },
                retry: {
                    maxAttempts: 3,
                    delay: 1000,
                    backoffMultiplier: 2,
                },
                async: {
                    pollInterval: 2000,
                    maxPollAttempts: 30,
                },
                monitoring: {
                    enabled: true,
                    logLevel: 'info',
                    metrics: {
                        collectResponseTimes: true,
                        collectErrorRates: true,
                    },
                },
            },
            production: {
                baseURL: baseURL,
                endpoints: {
                    health: '/healthz',
                    version: '/version',
                    embed: '/api/v1/codebase/embed',
                    embedStatus: '/api/v1/codebase/embed/status',
                    embedResults: '/api/v1/codebase/embed/results',
                },
                auth: {
                    token: process.env.BACKEND_API_TOKEN || 'test_auth_token',
                },
                processing: {
                    mode: 'auto',
                    syncThreshold: 20,
                    batchSize: 15,
                    maxConcurrency: 5,
                    timeout: 45000,
                },
                retry: {
                    maxAttempts: 5,
                    delay: 2000,
                    backoffMultiplier: 2,
                },
                async: {
                    pollInterval: 3000,
                    maxPollAttempts: 50,
                },
                monitoring: {
                    enabled: true,
                    logLevel: 'warn',
                    metrics: {
                        collectResponseTimes: true,
                        collectErrorRates: true,
                    },
                },
            },
            test: {
                baseURL: baseURL,
                endpoints: {
                    health: '/healthz',
                    version: '/version',
                    embed: '/api/v1/codebase/embed',
                    embedStatus: '/api/v1/codebase/embed/status',
                    embedResults: '/api/v1/codebase/embed/results',
                },
                auth: {
                    token: process.env.BACKEND_API_TOKEN || 'test_auth_token',
                },
                processing: {
                    mode: 'sync',
                    syncThreshold: 10,
                    batchSize: 5,
                    maxConcurrency: 2,
                    timeout: 15000,
                },
                retry: {
                    maxAttempts: 2,
                    delay: 500,
                    backoffMultiplier: 1.5,
                },
                async: {
                    pollInterval: 1000,
                    maxPollAttempts: 10,
                },
                monitoring: {
                    enabled: true,
                    logLevel: 'debug',
                    metrics: {
                        collectResponseTimes: true,
                        collectErrorRates: true,
                    },
                },
            },
        };
    }

    get(env = 'development') {
        return this.config[env] || this.config.development;
    }

    // 获取完整的API URL
    getApiUrl(env = 'development', endpoint = 'embed') {
        const config = this.get(env);
        return `${config.baseURL}${config.endpoints[endpoint]}`;
    }

    // 从配置字符串中解析服务器IP（支持现有的<SERVER_IP>格式）
    static parseServerIP(apiEndpoint) {
        if (typeof apiEndpoint !== 'string') {
            return null;
        }
        
        // 如果包含<SERVER_IP>占位符，使用环境变量替换
        if (apiEndpoint.includes('<SERVER_IP>')) {
            const serverIP = process.env.BACKEND_API_SERVER_IP || '42.193.14.136:8087';
            return apiEndpoint.replace('<SERVER_IP>', serverIP);
        }
        
        return apiEndpoint;
    }

    // 验证配置
    validate(env = 'development') {
        const config = this.get(env);
        const errors = [];

        if (!config.baseURL) {
            errors.push('baseURL is required');
        }

        if (!config.auth.token) {
            errors.push('auth.token is required');
        }

        if (!config.endpoints.embed) {
            errors.push('endpoints.embed is required');
        }

        if (errors.length > 0) {
            throw new Error(`Backend API configuration validation failed: ${errors.join(', ')}`);
        }

        return true;
    }
}

module.exports = new BackendAPIConfig(); 