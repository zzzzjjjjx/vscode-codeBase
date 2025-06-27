const Logger = require('./logger');

class PerformanceMonitor {
    constructor(config = {}) {
        this.config = config;
        this.logger = new Logger('PerformanceMonitor', config.logLevel);
        
        // 监控配置
        this.enableMetrics = config.enableMetrics !== false;
        this.sampleRate = config.sampleRate || 1.0; // 采样率
        this.maxHistorySize = config.maxHistorySize || 1000;
        
        // 监控数据
        this.metrics = new Map();
        this.timers = new Map();
        this.counters = new Map();
        this.histograms = new Map();
        
        // 内存监控
        this.memoryCheckInterval = config.memoryCheckInterval || 30000; // 30秒
        this.memoryHistory = [];
        
        // 启动内存监控
        if (this.enableMetrics) {
            this._startMemoryMonitoring();
        }
    }

    // 计时器
    startTimer(name) {
        if (!this._shouldSample()) return null;
        
        const timer = {
            name,
            startTime: process.hrtime.bigint(),
            startCPU: process.cpuUsage()
        };
        
        this.timers.set(name, timer);
        return timer;
    }

    endTimer(name) {
        const timer = this.timers.get(name);
        if (!timer) return null;
        
        const endTime = process.hrtime.bigint();
        const endCPU = process.cpuUsage(timer.startCPU);
        
        const duration = Number(endTime - timer.startTime) / 1000000; // 转换为毫秒
        
        const measurement = {
            name,
            duration,
            cpuUser: endCPU.user / 1000, // 微秒转毫秒
            cpuSystem: endCPU.system / 1000,
            timestamp: Date.now()
        };
        
        this._recordMeasurement(name, measurement);
        this.timers.delete(name);
        
        return measurement;
    }

    // 便捷的计时装饰器
    async measureAsync(name, asyncFn) {
        const timer = this.startTimer(name);
        
        try {
            const result = await asyncFn();
            const measurement = this.endTimer(name);
            
            if (measurement && measurement.duration > 1000) {
                this.logger.warn(`Slow operation detected: ${name} took ${measurement.duration.toFixed(2)}ms`);
            }
            
            return result;
            
        } catch (error) {
            this.endTimer(name);
            this.incrementCounter(`${name}.errors`);
            throw error;
        }
    }

    measureSync(name, syncFn) {
        const timer = this.startTimer(name);
        
        try {
            const result = syncFn();
            this.endTimer(name);
            return result;
            
        } catch (error) {
            this.endTimer(name);
            this.incrementCounter(`${name}.errors`);
            throw error;
        }
    }

    // 计数器
    incrementCounter(name, value = 1) {
        if (!this.enableMetrics) return;
        
        const current = this.counters.get(name) || 0;
        this.counters.set(name, current + value);
    }

    getCounter(name) {
        return this.counters.get(name) || 0;
    }

    resetCounter(name) {
        this.counters.set(name, 0);
    }

    // 直方图（用于统计分布）
    recordValue(name, value) {
        if (!this.enableMetrics || !this._shouldSample()) return;
        
        if (!this.histograms.has(name)) {
            this.histograms.set(name, []);
        }
        
        const histogram = this.histograms.get(name);
        histogram.push({
            value,
            timestamp: Date.now()
        });
        
        // 保持历史大小限制
        if (histogram.length > this.maxHistorySize) {
            histogram.shift();
        }
    }

    // 获取统计信息
    getStats(name) {
        const measurements = this.metrics.get(name) || [];
        
        if (measurements.length === 0) {
            return null;
        }
        
        const durations = measurements.map(m => m.duration);
        const sorted = durations.sort((a, b) => a - b);
        
        return {
            count: measurements.length,
            min: Math.min(...durations),
            max: Math.max(...durations),
            avg: durations.reduce((a, b) => a + b, 0) / durations.length,
            p50: this._percentile(sorted, 0.5),
            p95: this._percentile(sorted, 0.95),
            p99: this._percentile(sorted, 0.99),
            lastMeasurement: measurements[measurements.length - 1]
        };
    }

    getHistogramStats(name) {
        const histogram = this.histograms.get(name);
        
        if (!histogram || histogram.length === 0) {
            return null;
        }
        
        const values = histogram.map(h => h.value);
        const sorted = values.sort((a, b) => a - b);
        
        return {
            count: values.length,
            min: Math.min(...values),
            max: Math.max(...values),
            avg: values.reduce((a, b) => a + b, 0) / values.length,
            p50: this._percentile(sorted, 0.5),
            p95: this._percentile(sorted, 0.95),
            p99: this._percentile(sorted, 0.99)
        };
    }

    // 内存监控
    getMemoryUsage() {
        const usage = process.memoryUsage();
        
        return {
            rss: usage.rss,
            heapTotal: usage.heapTotal,
            heapUsed: usage.heapUsed,
            external: usage.external,
            timestamp: Date.now()
        };
    }

    getMemoryHistory() {
        return [...this.memoryHistory];
    }

    // 系统指标
    getSystemMetrics() {
        const cpuUsage = process.cpuUsage();
        const memUsage = this.getMemoryUsage();
        
        return {
            cpu: {
                user: cpuUsage.user,
                system: cpuUsage.system
            },
            memory: memUsage,
            uptime: process.uptime(),
            timestamp: Date.now()
        };
    }

    // 生成性能报告
    generateReport() {
        const report = {
            timestamp: new Date().toISOString(),
            system: this.getSystemMetrics(),
            timers: {},
            counters: Object.fromEntries(this.counters),
            histograms: {}
        };
        
        // 添加计时器统计
        for (const name of this.metrics.keys()) {
            const stats = this.getStats(name);
            if (stats) {
                report.timers[name] = stats;
            }
        }
        
        // 添加直方图统计
        for (const name of this.histograms.keys()) {
            const stats = this.getHistogramStats(name);
            if (stats) {
                report.histograms[name] = stats;
            }
        }
        
        return report;
    }

    // 内部方法
    _recordMeasurement(name, measurement) {
        if (!this.metrics.has(name)) {
            this.metrics.set(name, []);
        }
        
        const measurements = this.metrics.get(name);
        measurements.push(measurement);
        
        // 保持历史大小限制
        if (measurements.length > this.maxHistorySize) {
            measurements.shift();
        }
    }

    _shouldSample() {
        return Math.random() < this.sampleRate;
    }

    _percentile(sortedValues, percentile) {
        if (sortedValues.length === 0) return 0;
        
        const index = percentile * (sortedValues.length - 1);
        const lower = Math.floor(index);
        const upper = Math.ceil(index);
        
        if (lower === upper) {
            return sortedValues[lower];
        }
        
        const weight = index - lower;
        return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
    }

    _startMemoryMonitoring() {
        setInterval(() => {
            const memUsage = this.getMemoryUsage();
            this.memoryHistory.push(memUsage);
            
            // 保持历史大小限制
            if (this.memoryHistory.length > this.maxHistorySize) {
                this.memoryHistory.shift();
            }
            
            // 检查内存使用告警
            const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
            if (heapUsedMB > 500) { // 500MB 告警阈值
                this.logger.warn(`High memory usage detected: ${heapUsedMB.toFixed(2)}MB heap used`);
            }
            
        }, this.memoryCheckInterval);
    }

    // 清理方法
    reset() {
        this.metrics.clear();
        this.timers.clear();
        this.counters.clear();
        this.histograms.clear();
        this.memoryHistory = [];
    }

    close() {
        // 清理定时器等资源
        this.reset();
    }
}

module.exports = PerformanceMonitor;