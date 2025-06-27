class Formatter {
    constructor(config = {}) {
        this.config = config;
    }

    // 格式化向量数据
    formatVector(vector) {
        if (!Array.isArray(vector)) {
            throw new Error('Vector must be an array');
        }
        
        return {
            values: vector,
            dimension: vector.length,
            type: 'float32'
        };
    }

    // 格式化向量元数据
    formatVectorMetadata(metadata) {
        return {
            id: metadata.id || this._generateId(),
            filePath: metadata.filePath,
            timestamp: metadata.timestamp || new Date().toISOString(),
            tags: metadata.tags || [],
            properties: metadata.properties || {}
        };
    }

    // 格式化搜索结果
    formatSearchResult(results, query) {
        return {
            query: query,
            timestamp: new Date().toISOString(),
            results: results.map(result => ({
                id: result.id,
                score: result.score,
                metadata: result.metadata
            })),
            total: results.length
        };
    }

    // 格式化错误响应
    formatError(error, context = '') {
        return {
            error: {
                message: error.message,
                code: error.code || 'UNKNOWN_ERROR',
                context: context,
                timestamp: new Date().toISOString()
            }
        };
    }

    // 格式化成功响应
    formatSuccess(data, message = '') {
        return {
            success: true,
            message: message,
            data: data,
            timestamp: new Date().toISOString()
        };
    }

    // 格式化批量操作结果
    formatBatchResult(results) {
        const successCount = results.filter(r => r.success).length;
        const failureCount = results.length - successCount;
        
        return {
            total: results.length,
            success: successCount,
            failure: failureCount,
            results: results,
            timestamp: new Date().toISOString()
        };
    }

    // 格式化性能指标
    formatPerformanceMetrics(metrics) {
        return {
            timestamp: new Date().toISOString(),
            metrics: {
                cpu: this._formatCPUUsage(metrics.cpu),
                memory: this._formatMemoryUsage(metrics.memory),
                operations: this._formatOperationMetrics(metrics.operations)
            }
        };
    }

    // 格式化缓存统计
    formatCacheStats(stats) {
        return {
            timestamp: new Date().toISOString(),
            stats: {
                size: stats.size,
                hitCount: stats.hitCount,
                missCount: stats.missCount,
                hitRate: stats.hitCount / (stats.hitCount + stats.missCount),
                evictionCount: stats.evictionCount
            }
        };
    }

    // 内部方法
    _generateId() {
        return 'vec_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    _formatCPUUsage(cpu) {
        return {
            user: this._formatTime(cpu.user),
            system: this._formatTime(cpu.system),
            total: this._formatTime(cpu.user + cpu.system)
        };
    }

    _formatMemoryUsage(memory) {
        return {
            rss: this._formatBytes(memory.rss),
            heapTotal: this._formatBytes(memory.heapTotal),
            heapUsed: this._formatBytes(memory.heapUsed),
            external: this._formatBytes(memory.external)
        };
    }

    _formatOperationMetrics(operations) {
        return Object.entries(operations).reduce((acc, [name, metrics]) => {
            acc[name] = {
                count: metrics.count,
                avgDuration: this._formatTime(metrics.avgDuration),
                minDuration: this._formatTime(metrics.minDuration),
                maxDuration: this._formatTime(metrics.maxDuration),
                errorRate: metrics.errorCount / metrics.count
            };
            return acc;
        }, {});
    }

    _formatTime(microseconds) {
        if (microseconds < 1000) {
            return `${microseconds.toFixed(2)}µs`;
        } else if (microseconds < 1000000) {
            return `${(microseconds / 1000).toFixed(2)}ms`;
        } else {
            return `${(microseconds / 1000000).toFixed(2)}s`;
        }
    }

    _formatBytes(bytes) {
        const units = ['B', 'KB', 'MB', 'GB'];
        let value = bytes;
        let unitIndex = 0;
        
        while (value >= 1024 && unitIndex < units.length - 1) {
            value /= 1024;
            unitIndex++;
        }
        
        return `${value.toFixed(2)}${units[unitIndex]}`;
    }
}

module.exports = Formatter;