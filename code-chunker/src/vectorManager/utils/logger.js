const fs = require('fs-extra');
const path = require('path');

class Logger {
    constructor(name, level = 'info', config = {}) {
        this.name = name;
        this.level = level;
        this.config = config;

        // 【修改】测试环境下关闭日志
        this.enableConsole = process.env.NODE_ENV !== 'test' && (config.enableConsole !== false);
        this.enableFile = process.env.NODE_ENV !== 'test' && (config.enableFile !== false);
        
        // 日志级别映射
        this.levels = {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3,
            trace: 4
        };
        
        // 当前日志级别
        this.currentLevel = this.levels[level] || this.levels.info;
        
        // 输出配置
        this.enableConsole = config.enableConsole !== false;
        this.enableFile = config.enableFile !== false;
        this.logDir = config.logDir || path.join(process.cwd(), 'logs');
        this.maxFileSize = config.maxFileSize || 10 * 1024 * 1024; // 10MB
        this.maxFiles = config.maxFiles || 10;
        
        // 格式化配置
        this.includeTimestamp = config.includeTimestamp !== false;
        this.includeLevel = config.includeLevel !== false;
        this.includeName = config.includeName !== false;
        this.colorize = config.colorize !== false && process.stdout.isTTY;
        
        // 颜色配置
        this.colors = {
            error: '\x1b[31m',   // 红色
            warn: '\x1b[33m',    // 黄色
            info: '\x1b[36m',    // 青色
            debug: '\x1b[37m',   // 白色
            trace: '\x1b[90m',   // 灰色
            reset: '\x1b[0m'     // 重置
        };
        
        // 文件流管理
        this.fileStreams = new Map();
        
        // 初始化日志目录
        this._initializeLogDirectory();
    }

    error(message, ...args) {
        this._log('error', message, ...args);
    }

    warn(message, ...args) {
        this._log('warn', message, ...args);
    }

    info(message, ...args) {
        this._log('info', message, ...args);
    }

    debug(message, ...args) {
        this._log('debug', message, ...args);
    }

    trace(message, ...args) {
        this._log('trace', message, ...args);
    }

    // 格式化对象日志
    logObject(level, label, obj) {
        const formatted = this._formatObject(obj);
        this._log(level, `${label}:\n${formatted}`);
    }

    // 性能日志
    logPerformance(operation, duration, metadata = {}) {
        const perfLog = {
            operation,
            duration: `${duration}ms`,
            timestamp: new Date().toISOString(),
            ...metadata
        };
        
        this.info(`Performance: ${operation} completed in ${duration}ms`, perfLog);
    }

    // 错误日志（带堆栈）
    logError(error, context = '') {
        const errorInfo = {
            message: error.message,
            stack: error.stack,
            context: context,
            timestamp: new Date().toISOString()
        };
        
        this.error(`Error${context ? ` in ${context}` : ''}:`, errorInfo);
    }

    // 内部方法
    _log(level, message, ...args) {
        if (this.levels[level] > this.currentLevel) {
            return; // 跳过低于当前级别的日志
        }
        
        const logEntry = this._formatLogEntry(level, message, args);
        
        // 控制台输出
        if (this.enableConsole) {
            this._writeToConsole(level, logEntry);
        }
        
        // 文件输出
        if (this.enableFile) {
            this._writeToFile(level, logEntry);
        }
    }

    _formatLogEntry(level, message, args) {
        let formattedMessage = message;
        
        // 处理参数
        if (args.length > 0) {
            const additionalInfo = args.map(arg => 
                typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
            ).join(' ');
            formattedMessage += ` ${additionalInfo}`;
        }
        
        // 构建日志条目
        const parts = [];
        
        if (this.includeTimestamp) {
            parts.push(new Date().toISOString());
        }
        
        if (this.includeLevel) {
            parts.push(`[${level.toUpperCase()}]`);
        }
        
        if (this.includeName) {
            parts.push(`[${this.name}]`);
        }
        
        parts.push(formattedMessage);
        
        return parts.join(' ');
    }

    _writeToConsole(level, logEntry) {
        const colorized = this.colorize ? 
            `${this.colors[level]}${logEntry}${this.colors.reset}` : 
            logEntry;
        
        if (level === 'error') {
            console.error(colorized);
        } else if (level === 'warn') {
            console.warn(colorized);
        } else {
            console.log(colorized);
        }
    }

    _writeToFile(level, logEntry) {
        try {
            const logFileName = this._getLogFileName(level);
            const logFilePath = path.join(this.logDir, logFileName);
            
            // 检查文件大小，如果需要则轮转
            this._rotateLogFileIfNeeded(logFilePath);
            
            // 写入日志
            const logLine = logEntry + '\n';
            fs.appendFileSync(logFilePath, logLine, 'utf8');
            
        } catch (error) {
            console.error(`Failed to write log to file: ${error.message}`);
        }
    }

    _getLogFileName(level) {
        const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        return `${this.name}-${level}-${date}.log`;
    }

    _rotateLogFileIfNeeded(logFilePath) {
        try {
            if (!fs.existsSync(logFilePath)) {
                return;
            }
            
            const stats = fs.statSync(logFilePath);
            if (stats.size < this.maxFileSize) {
                return;
            }
            
            // 生成备份文件名
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupPath = logFilePath.replace('.log', `.${timestamp}.log`);
            
            // 移动当前文件到备份
            fs.moveSync(logFilePath, backupPath);
            
            // 清理旧的备份文件
            this._cleanupOldLogFiles(path.dirname(logFilePath));
            
        } catch (error) {
            console.error(`Failed to rotate log file: ${error.message}`);
        }
    }

    _cleanupOldLogFiles(logDir) {
        try {
            const files = fs.readdirSync(logDir)
                .filter(file => file.includes(this.name) && file.endsWith('.log'))
                .map(file => ({
                    name: file,
                    path: path.join(logDir, file),
                    stats: fs.statSync(path.join(logDir, file))
                }))
                .sort((a, b) => b.stats.mtime - a.stats.mtime);
            
            // 删除超过最大文件数的旧文件
            const filesToDelete = files.slice(this.maxFiles);
            for (const file of filesToDelete) {
                fs.unlinkSync(file.path);
            }
            
        } catch (error) {
            console.error(`Failed to cleanup old log files: ${error.message}`);
        }
    }

    _formatObject(obj) {
        try {
            return JSON.stringify(obj, null, 2);
        } catch (error) {
            return `[Object cannot be serialized: ${error.message}]`;
        }
    }

    _initializeLogDirectory() {
        if (this.enableFile) {
            try {
                fs.ensureDirSync(this.logDir);
            } catch (error) {
                console.error(`Failed to create log directory: ${error.message}`);
                this.enableFile = false;
            }
        }
    }

    // 工具方法
    setLevel(level) {
        if (this.levels.hasOwnProperty(level)) {
            this.level = level;
            this.currentLevel = this.levels[level];
        }
    }

    createChild(childName) {
        const fullName = `${this.name}:${childName}`;
        return new Logger(fullName, this.level, this.config);
    }

    close() {
        // 关闭文件流
        for (const stream of this.fileStreams.values()) {
            if (stream && typeof stream.close === 'function') {
                stream.close();
            }
        }
        this.fileStreams.clear();
    }
}

module.exports = Logger;