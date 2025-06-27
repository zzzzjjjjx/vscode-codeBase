const Logger = require('./logger');

class RetryHelper {
    constructor(config = {}) {
        this.config = config;
        this.logger = new Logger('RetryHelper', config.logLevel);
        
        // 重试配置
        this.maxRetries = config.maxRetries || 3;
        this.baseDelay = config.baseDelay || 1000; // 1秒
        this.maxDelay = config.maxDelay || 30000; // 30秒
        this.backoffFactor = config.backoffFactor || 2;
        this.jitter = config.jitter !== false; // 添加随机性
        
        // 重试条件配置
        this.retryableErrors = config.retryableErrors || [
            'ECONNRESET',
            'ETIMEDOUT', 
            'ECONNREFUSED',
            'ENETUNREACH',
            'EAI_AGAIN'
        ];
        
        this.retryableHttpCodes = config.retryableHttpCodes || [
            408, // Request Timeout
            429, // Too Many Requests
            500, // Internal Server Error
            502, // Bad Gateway
            503, // Service Unavailable
            504  // Gateway Timeout
        ];
        
        // 统计信息
        this.stats = {
            totalAttempts: 0,
            successfulRetries: 0,
            failedRetries: 0,
            totalDelayTime: 0
        };
    }

    async executeWithRetry(operation, context = '', options = {}) {
        const mergedOptions = { ...this.config, ...options };
        const maxRetries = mergedOptions.maxRetries || this.maxRetries;
        
        let lastError;
        let attempt = 0;
        
        console.log('开始重试执行，maxRetries:', maxRetries);
        
        while (attempt < maxRetries) {
            console.log('当前尝试次数:', attempt);
            try {
                attempt++;
                this.stats.totalAttempts++;
                
                console.log('执行操作，当前attempt:', attempt);
                
                if (attempt > 1) {
                    this.logger.debug(`Retry attempt ${attempt}/${maxRetries} for: ${context}`);
                }
                
                const result = await this._executeOperation(operation);
                
                if (attempt > 1) {
                    this.stats.successfulRetries++;
                    this.logger.info(`Operation succeeded after ${attempt} retries: ${context}`);
                }
                
                return result;
                
            } catch (error) {
                lastError = error;
                console.log('操作失败，当前attempt:', attempt, '错误:', error.message);
                
                if (attempt >= maxRetries) {
                    console.log('达到最大重试次数，退出循环');
                    break;
                }
                
                const delay = this._calculateDelay(attempt, mergedOptions);
                
                this.logger.warn(`Operation failed (attempt ${attempt}), retrying in ${delay}ms: ${context}`, {
                    error: error.message,
                    attempt: attempt,
                    maxRetries: maxRetries
                });
                
                await this._delay(delay);
            }
        }
        
        this.stats.failedRetries++;
        this.logger.error(`Operation failed after ${maxRetries} retries: ${context}`, {
            finalError: lastError.message,
            totalAttempts: attempt
        });
        
        throw new Error(`Operation failed after ${maxRetries} retries: ${lastError.message}`);
    }

    async executeWithCircuitBreaker(operation, context = '', circuitConfig = {}) {
        const circuitBreaker = this._getCircuitBreaker(context, circuitConfig);
        
        if (circuitBreaker.isOpen()) {
            throw new Error(`Circuit breaker is open for: ${context}`);
        }
        
        try {
            const result = await this.executeWithRetry(operation, context);
            circuitBreaker.recordSuccess();
            return result;
            
        } catch (error) {
            circuitBreaker.recordFailure();
            throw error;
        }
    }

    // 批量重试执行
    async executeBatchWithRetry(operations, context = '', options = {}) {
        const batchOptions = { ...this.config, ...options };
        const concurrency = batchOptions.concurrency || 5;
        const failFast = batchOptions.failFast !== false;
        
        const results = [];
        const errors = [];
        
        // 分批处理
        for (let i = 0; i < operations.length; i += concurrency) {
            const batch = operations.slice(i, i + concurrency);
            
            const batchPromises = batch.map(async (operation, index) => {
                try {
                    const result = await this.executeWithRetry(
                        operation, 
                        `${context}[${i + index}]`, 
                        batchOptions
                    );
                    return { index: i + index, result, success: true };
                    
                } catch (error) {
                    const errorInfo = { index: i + index, error, success: false };
                    
                    if (failFast) {
                        throw errorInfo;
                    }
                    
                    return errorInfo;
                }
            });
            
            const batchResults = await Promise.allSettled(batchPromises);
            
            for (const promiseResult of batchResults) {
                if (promiseResult.status === 'fulfilled') {
                    const operationResult = promiseResult.value;
                    
                    if (operationResult.success) {
                        results[operationResult.index] = operationResult.result;
                    } else {
                        errors.push(operationResult);
                    }
                    
                } else {
                    // failFast模式下的错误
                    throw promiseResult.reason;
                }
            }
        }
        
        return {
            results,
            errors,
            successCount: results.filter(r => r !== undefined).length,
            errorCount: errors.length
        };
    }

    // 内部方法
    async _executeOperation(operation) {
        if (typeof operation === 'function') {
            return await operation();
        } else if (operation && typeof operation.then === 'function') {
            return await operation;
        } else {
            throw new Error('Operation must be a function or Promise');
        }
    }

    _shouldRetry(error) {
        // 检查错误代码
        if (error.code && this.retryableErrors.includes(error.code)) {
            return true;
        }
        
        // 检查HTTP状态码
        if (error.response && this.retryableHttpCodes.includes(error.response.status)) {
            return true;
        }
        
        // 检查错误消息中的关键词
        const retryableKeywords = ['timeout', 'reset', 'refused', 'unavailable'];
        const errorMessage = error.message.toLowerCase();
        
        return retryableKeywords.some(keyword => errorMessage.includes(keyword));
    }

    _calculateDelay(attempt, options = {}) {
        const baseDelay = options.baseDelay || this.baseDelay;
        const maxDelay = options.maxDelay || this.maxDelay;
        const backoffFactor = options.backoffFactor || this.backoffFactor;
        const jitter = options.jitter !== false;
        
        // 指数退避
        let delay = baseDelay * Math.pow(backoffFactor, attempt);
        
        // 限制最大延迟
        delay = Math.min(delay, maxDelay);
        
        // 添加随机抖动
        if (jitter) {
            const jitterAmount = delay * 0.1; // 10%的抖动
            delay += (Math.random() - 0.5) * 2 * jitterAmount;
        }
        
        this.stats.totalDelayTime += delay;
        
        return Math.max(0, Math.floor(delay));
    }

    async _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    _getCircuitBreaker(context, config) {
        // 简化的断路器实现
        if (!this.circuitBreakers) {
            this.circuitBreakers = new Map();
        }
        
        if (!this.circuitBreakers.has(context)) {
            this.circuitBreakers.set(context, new CircuitBreaker(config));
        }
        
        return this.circuitBreakers.get(context);
    }

    // 统计方法
    getStats() {
        return {
            ...this.stats,
            averageDelayTime: this.stats.totalAttempts > 0 ? 
                this.stats.totalDelayTime / this.stats.totalAttempts : 0
        };
    }

    resetStats() {
        this.stats = {
            totalAttempts: 0,
            successfulRetries: 0,
            failedRetries: 0,
            totalDelayTime: 0
        };
    }
}

// 简化的断路器实现
class CircuitBreaker {
    constructor(config = {}) {
        this.failureThreshold = config.failureThreshold || 5;
        this.timeout = config.timeout || 60000; // 1分钟
        this.monitoringPeriod = config.monitoringPeriod || 10000; // 10秒
        
        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.lastSuccessTime = null;
    }

    isOpen() {
        if (this.state === 'OPEN') {
            // 检查是否应该转为半开状态
            if (Date.now() - this.lastFailureTime > this.timeout) {
                this.state = 'HALF_OPEN';
                return false;
            }
            return true;
        }
        
        return false;
    }

    recordSuccess() {
        this.failureCount = 0;
        this.lastSuccessTime = Date.now();
        this.state = 'CLOSED';
    }

    recordFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        
        if (this.failureCount >= this.failureThreshold) {
            this.state = 'OPEN';
        }
    }
}

module.exports = RetryHelper;