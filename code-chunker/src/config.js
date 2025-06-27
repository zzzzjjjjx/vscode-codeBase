const path = require('path');
const fs = require('fs-extra');
const yaml = require('yaml');

class Config {
    constructor(userConfig = {}) {
        this.defaultConfig = this._loadDefaultConfig();
        this.apiConfig = this._loadApiConfig();
        this.config = this._mergeConfigs(userConfig);
    }

    _loadDefaultConfig() {
        const defaultConfigPath = path.join(__dirname, '..', 'config', 'default.yaml');
        let defaultConfig = {};
        
        try {
            if (fs.existsSync(defaultConfigPath)) {
                const defaultConfigContent = fs.readFileSync(defaultConfigPath, 'utf8');
                defaultConfig = yaml.parse(defaultConfigContent);
            }
        } catch (error) {
            console.warn('Error loading default config:', error);
        }

        return defaultConfig;
    }

    _loadApiConfig() {
        try {
            const backendApiConfig = require('../config/backend-api-config');
            return backendApiConfig;
        } catch (error) {
            console.warn('Error loading backend API config:', error);
            return null;
        }
    }

    _mergeConfigs(userConfig) {
        const mergedConfig = {
            // 基础配置（来自 default.yaml）
            ...this.defaultConfig,
            
            // API配置集成
            api: this.apiConfig ? {
                // 获取当前环境的API配置
                current: this.apiConfig.get(process.env.NODE_ENV || 'development'),
                // 提供访问其他环境配置的方法
                get: (env) => this.apiConfig.get(env),
                getApiUrl: (env, endpoint) => this.apiConfig.getApiUrl(env, endpoint),
                parseServerIP: (apiEndpoint) => this.apiConfig.constructor.parseServerIP(apiEndpoint),
                validate: (env) => this.apiConfig.validate(env)
            } : null,

            // 用户配置覆盖
            ...userConfig
        };

        // 如果有API配置，将其集成到相关组件中
        if (this.apiConfig) {
            const currentApiConfig = this.apiConfig.get(process.env.NODE_ENV || 'development');
            
            // 集成到发送配置中
            if (mergedConfig.batchSize && !mergedConfig.maxRetries) {
                mergedConfig.maxRetries = currentApiConfig.retry.maxAttempts;
                mergedConfig.retryDelay = currentApiConfig.retry.delay;
                mergedConfig.apiEndpoint = currentApiConfig.baseURL + currentApiConfig.endpoints.embed;
            }

            // 集成到vectorManager配置中
            if (mergedConfig.vectorManager) {
                mergedConfig.vectorManager.embedding = {
                    endpoint: currentApiConfig.baseURL + currentApiConfig.endpoints.embed,
                    timeout: currentApiConfig.processing.timeout,
                    auth: currentApiConfig.auth
                };
                mergedConfig.vectorManager.retry = {
                    maxAttempts: currentApiConfig.retry.maxAttempts,
                    delay: currentApiConfig.retry.delay
                };
            }
        }

        return mergedConfig;
    }

    get(key) {
        return this.config[key];
    }

    set(key, value) {
        this.config[key] = value;
    }

    getAll() {
        return this.config;
    }

    // 新增：获取API配置的便捷方法
    getApiConfig(env) {
        return this.config.api ? this.config.api.get(env) : null;
    }

    // 新增：获取API URL的便捷方法
    getApiUrl(endpoint = 'embed', env) {
        return this.config.api ? this.config.api.getApiUrl(env, endpoint) : null;
    }

    // 新增：验证配置
    validate(env) {
        if (this.config.api) {
            return this.config.api.validate(env);
        }
        return true;
    }

    // 新增：获取配置摘要（用于调试）
    getConfigSummary() {
        return {
            hasDefaultConfig: Object.keys(this.defaultConfig).length > 0,
            hasApiConfig: this.apiConfig !== null,
            currentEnvironment: process.env.NODE_ENV || 'development',
            configKeys: Object.keys(this.config),
            apiEndpoints: this.config.api ? Object.keys(this.config.api.current.endpoints) : []
        };
    }
}

module.exports = new Config(); 