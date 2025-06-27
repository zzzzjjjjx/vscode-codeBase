const fs = require('fs-extra');
const path = require('path');
const os = require('os');

/**
 * 代码分块性能分析器
 * 监控整个处理流程中各个环节的耗时，生成详细的性能报告
 */
class PerformanceAnalyzer {
    constructor() {
        this.metrics = {
            // 总体时间
            totalTime: { start: 0, end: 0, duration: 0 },
            
            // 文件扫描阶段
            fileScanning: { start: 0, end: 0, duration: 0, fileCount: 0, skippedCount: 0 },
            
            // 文件解析阶段
            fileParsing: { 
                start: 0, end: 0, duration: 0, 
                totalFiles: 0, 
                successFiles: 0, 
                failedFiles: 0,
                workerCreationFailures: 0,
                syncProcessingCount: 0,
                workerProcessingCount: 0
            },
            
            // 分块生成阶段
            chunkGeneration: { 
                start: 0, end: 0, duration: 0, 
                totalChunks: 0,
                averageChunkSize: 0,
                largestChunk: 0
            },
            
            // Embedding生成阶段
            embeddingGeneration: { 
                start: 0, end: 0, duration: 0, 
                totalRequests: 0,
                successRequests: 0,
                failedRequests: 0,
                averageRequestTime: 0,
                batchSizes: [],
                networkCommunicationTime: 0,
                serverProcessingTime: 0
            },
            
            // 网络请求阶段 - 扩展更详细的网络监控
            networkRequests: {
                embedding: { 
                    count: 0, 
                    totalTime: 0, 
                    failures: 0, 
                    averageTime: 0,
                    minTime: Infinity,
                    maxTime: 0,
                    networkTime: 0,
                    serverTime: 0
                },
                vectorDB: { 
                    count: 0, 
                    totalTime: 0, 
                    failures: 0, 
                    averageTime: 0,
                    minTime: Infinity,
                    maxTime: 0,
                    insertOperations: 0,
                    queryOperations: 0
                }
            },
            
            // 向量数据库操作 - 细化各种操作
            vectorDatabase: { 
                start: 0, end: 0, duration: 0,
                collectionOps: { 
                    create: { count: 0, totalTime: 0 }, 
                    delete: { count: 0, totalTime: 0 }, 
                    insert: { count: 0, totalTime: 0 }, 
                    query: { count: 0, totalTime: 0 } 
                },
                insertedVectors: 0,
                batchInsertCount: 0,
                averageBatchSize: 0
            },
            
            // 模块详细耗时追踪
            moduleTimings: {
                fileScanner: { initTime: 0, scanTime: 0, filterTime: 0 },
                parserSelector: { initTime: 0, parseTime: 0, chunkTime: 0 },
                dispatcher: { initTime: 0, dispatchTime: 0, workerTime: 0 },
                sender: { initTime: 0, prepareTime: 0, sendTime: 0, batchTime: 0 },
                vectorManager: { initTime: 0, cacheTime: 0, dbTime: 0, embeddingTime: 0 },
                merkleTree: { buildTime: 0, proofTime: 0 }
            },
            
            // 系统资源使用
            systemResources: {
                initialMemory: 0,
                peakMemory: 0,
                finalMemory: 0,
                cpuUsage: [],
                processId: process.pid,
                memoryTimeline: []
            }
        };
        
        this.timers = new Map();
        this.isAnalyzing = false;
        this.reportPath = null;
        this.workspaceInfo = {};
        this.reportFolder = null; // 固定报告文件夹
    }

    /**
     * 开始性能分析
     */
    startAnalysis(workspacePath, userId, deviceId) {
        this.isAnalyzing = true;
        this.workspaceInfo = {
            path: workspacePath,
            name: path.basename(workspacePath),
            userId,
            deviceId,
            timestamp: new Date().toISOString()
        };
        
        // 创建固定的报告文件夹
        this.reportFolder = path.join(workspacePath, 'performance-reports');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' + 
                         new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
        
        this.reportPath = path.join(this.reportFolder, `性能测速报告_${timestamp}.json`);
        
        this.metrics.totalTime.start = Date.now();
        this.metrics.systemResources.initialMemory = this._getMemoryUsage();
        this.metrics.systemResources.memoryTimeline.push({
            timestamp: Date.now(),
            memory: this._getMemoryUsage(),
            phase: 'start'
        });
        
        console.log(`📊 [性能分析] 开始监控项目性能 - 报告将保存到: ${this.reportFolder}`);
    }

    /**
     * 结束性能分析并生成报告
     */
    async endAnalysis() {
        if (!this.isAnalyzing) return;
        
        this.metrics.totalTime.end = Date.now();
        this.metrics.totalTime.duration = this.metrics.totalTime.end - this.metrics.totalTime.start;
        this.metrics.systemResources.finalMemory = this._getMemoryUsage();
        
        const report = await this._generateReport();
        await this._saveReport(report);
        

        
        this.isAnalyzing = false;
        return report;
    }

    /**
     * 记录文件扫描开始
     */
    startFileScanning() {
        this.metrics.fileScanning.start = Date.now();

    }

    /**
     * 记录文件扫描结束
     */
    endFileScanning(fileCount, skippedCount) {
        this.metrics.fileScanning.end = Date.now();
        this.metrics.fileScanning.duration = this.metrics.fileScanning.end - this.metrics.fileScanning.start;
        this.metrics.fileScanning.fileCount = fileCount;
        this.metrics.fileScanning.skippedCount = skippedCount;
        

    }

    /**
     * 记录文件解析开始
     */
    startFileParsing(totalFiles) {
        this.metrics.fileParsing.start = Date.now();
        this.metrics.fileParsing.totalFiles = totalFiles;

    }

    /**
     * 记录文件解析结束
     */
    endFileParsing(successFiles, failedFiles, workerFailures, syncCount, workerCount) {
        this.metrics.fileParsing.end = Date.now();
        this.metrics.fileParsing.duration = this.metrics.fileParsing.end - this.metrics.fileParsing.start;
        this.metrics.fileParsing.successFiles = successFiles;
        this.metrics.fileParsing.failedFiles = failedFiles;
        this.metrics.fileParsing.workerCreationFailures = workerFailures;
        this.metrics.fileParsing.syncProcessingCount = syncCount;
        this.metrics.fileParsing.workerProcessingCount = workerCount;
        

    }

    /**
     * 记录分块生成信息
     */
    recordChunkGeneration(totalChunks, chunkSizes) {
        this.metrics.chunkGeneration.totalChunks = totalChunks;
        if (chunkSizes && chunkSizes.length > 0) {
            this.metrics.chunkGeneration.averageChunkSize = Math.round(chunkSizes.reduce((a, b) => a + b, 0) / chunkSizes.length);
            this.metrics.chunkGeneration.largestChunk = Math.max(...chunkSizes);
        }
        

    }

    /**
     * 记录Embedding生成开始
     */
    startEmbeddingGeneration() {
        this.metrics.embeddingGeneration.start = Date.now();

    }

    /**
     * 记录Embedding生成结束
     */
    endEmbeddingGeneration(totalRequests, successRequests, failedRequests) {
        this.metrics.embeddingGeneration.end = Date.now();
        this.metrics.embeddingGeneration.duration = this.metrics.embeddingGeneration.end - this.metrics.embeddingGeneration.start;
        this.metrics.embeddingGeneration.totalRequests = totalRequests;
        this.metrics.embeddingGeneration.successRequests = successRequests;
        this.metrics.embeddingGeneration.failedRequests = failedRequests;
        
        if (totalRequests > 0) {
            this.metrics.embeddingGeneration.averageRequestTime = Math.round(this.metrics.embeddingGeneration.duration / totalRequests);
        }
        

    }

    /**
     * 记录网络请求
     */
    recordNetworkRequest(type, duration, success = true) {
        if (!this.metrics.networkRequests[type]) {
            this.metrics.networkRequests[type] = { count: 0, totalTime: 0, failures: 0, averageTime: 0 };
        }
        
        this.metrics.networkRequests[type].count++;
        this.metrics.networkRequests[type].totalTime += duration;
        if (!success) {
            this.metrics.networkRequests[type].failures++;
        }
        this.metrics.networkRequests[type].averageTime = Math.round(this.metrics.networkRequests[type].totalTime / this.metrics.networkRequests[type].count);
    }

    /**
     * 记录向量数据库操作开始
     */
    startVectorDBOperations() {
        this.metrics.vectorDatabase.start = Date.now();

    }

    /**
     * 记录向量数据库操作结束
     */
    endVectorDBOperations(insertedVectors, batchCount) {
        this.metrics.vectorDatabase.end = Date.now();
        this.metrics.vectorDatabase.duration = this.metrics.vectorDatabase.end - this.metrics.vectorDatabase.start;
        this.metrics.vectorDatabase.insertedVectors = insertedVectors;
        this.metrics.vectorDatabase.batchInsertCount = batchCount;
        

    }

    /**
     * 记录数据库操作
     */
    recordDBOperation(operation, duration = 0) {
        if (this.metrics.vectorDatabase.collectionOps[operation]) {
            this.metrics.vectorDatabase.collectionOps[operation].count++;
            this.metrics.vectorDatabase.collectionOps[operation].totalTime += duration;
        }
    }

    /**
     * 记录模块计时开始
     */
    startModuleTimer(moduleName, operation) {
        const key = `${moduleName}_${operation}`;
        this.timers.set(key, Date.now());
    }

    /**
     * 记录模块计时结束
     */
    endModuleTimer(moduleName, operation) {
        const key = `${moduleName}_${operation}`;
        const startTime = this.timers.get(key);
        if (startTime) {
            const duration = Date.now() - startTime;
            this.timers.delete(key);
            
            // 记录到模块计时中
            if (this.metrics.moduleTimings[moduleName] && this.metrics.moduleTimings[moduleName][operation] !== undefined) {
                this.metrics.moduleTimings[moduleName][operation] += duration;
            }
            
            return duration;
        }
        return 0;
    }

    /**
     * 记录网络请求详细信息（包含网络通信时间分析）
     */
    recordDetailedNetworkRequest(type, totalTime, networkTime, serverTime, success = true) {
        if (!this.metrics.networkRequests[type]) return;
        
        const metric = this.metrics.networkRequests[type];
        metric.count++;
        metric.totalTime += totalTime;
        
        if (totalTime < metric.minTime) metric.minTime = totalTime;
        if (totalTime > metric.maxTime) metric.maxTime = totalTime;
        
        if (networkTime !== undefined) metric.networkTime += networkTime;
        if (serverTime !== undefined) metric.serverTime += serverTime;
        
        if (!success) metric.failures++;
        
        metric.averageTime = Math.round(metric.totalTime / metric.count);
        
        // 更新embedding生成的网络分析数据
        if (type === 'embedding') {
            this.metrics.embeddingGeneration.networkCommunicationTime += networkTime || 0;
            this.metrics.embeddingGeneration.serverProcessingTime += serverTime || 0;
        }
    }

    /**
     * 记录内存使用情况
     */
    recordMemoryUsage(phase) {
        const currentMemory = this._getMemoryUsage();
        this.metrics.systemResources.memoryTimeline.push({
            timestamp: Date.now(),
            memory: currentMemory,
            phase: phase
        });
        
        if (currentMemory > this.metrics.systemResources.peakMemory) {
            this.metrics.systemResources.peakMemory = currentMemory;
        }
    }

    /**
     * 更新内存峰值
     */
    updatePeakMemory() {
        const currentMemory = this._getMemoryUsage();
        if (currentMemory > this.metrics.systemResources.peakMemory) {
            this.metrics.systemResources.peakMemory = currentMemory;
        }
    }

    /**
     * 获取内存使用情况
     */
    _getMemoryUsage() {
        const usage = process.memoryUsage();
        return Math.round(usage.heapUsed / 1024 / 1024); // MB
    }

    /**
     * 生成性能报告
     */
    async _generateReport() {
        const report = {
            metadata: {
                generatedAt: new Date().toISOString(),
                workspace: this.workspaceInfo,
                system: {
                    platform: os.platform(),
                    arch: os.arch(),
                    nodeVersion: process.version,
                    totalMemory: Math.round(os.totalmem() / 1024 / 1024), // MB
                    cpuCount: os.cpus().length
                }
            },
            
            summary: {
                totalDuration: this.metrics.totalTime.duration,
                totalFiles: this.metrics.fileScanning.fileCount,
                skippedFiles: this.metrics.fileScanning.skippedCount,
                processedFiles: this.metrics.fileParsing.successFiles,
                totalChunks: this.metrics.chunkGeneration.totalChunks,
                totalEmbeddingRequests: this.metrics.embeddingGeneration.totalRequests,
                insertedVectors: this.metrics.vectorDatabase.insertedVectors
            },
            
            performance: {
                breakdown: this._calculatePerformanceBreakdown(),
                bottlenecks: this._identifyBottlenecks(),
                recommendations: this._generateRecommendations()
            },
            
            detailed: this.metrics
        };

        return report;
    }

    /**
     * 计算性能分解
     */
    _calculatePerformanceBreakdown() {
        const total = this.metrics.totalTime.duration;
        if (total === 0) return {};

        return {
            fileScanning: {
                duration: this.metrics.fileScanning.duration,
                percentage: Math.round((this.metrics.fileScanning.duration / total) * 100)
            },
            fileParsing: {
                duration: this.metrics.fileParsing.duration,
                percentage: Math.round((this.metrics.fileParsing.duration / total) * 100)
            },
            embeddingGeneration: {
                duration: this.metrics.embeddingGeneration.duration,
                percentage: Math.round((this.metrics.embeddingGeneration.duration / total) * 100)
            },
            vectorDatabase: {
                duration: this.metrics.vectorDatabase.duration,
                percentage: Math.round((this.metrics.vectorDatabase.duration / total) * 100)
            }
        };
    }

    /**
     * 识别性能瓶颈
     */
    _identifyBottlenecks() {
        const breakdown = this._calculatePerformanceBreakdown();
        const bottlenecks = [];

        // 识别耗时最多的环节
        const phases = Object.entries(breakdown).sort((a, b) => b[1].percentage - a[1].percentage);
        
        if (phases.length > 0) {
            const topPhase = phases[0];
            if (topPhase[1].percentage > 40) {
                bottlenecks.push({
                    phase: topPhase[0],
                    impact: 'high',
                    percentage: topPhase[1].percentage,
                    description: this._getBottleneckDescription(topPhase[0])
                });
            }
        }

        // 检查Worker失败率
        if (this.metrics.fileParsing.workerCreationFailures > 5) {
            bottlenecks.push({
                phase: 'workerCreation',
                impact: 'medium',
                count: this.metrics.fileParsing.workerCreationFailures,
                description: 'Worker创建失败过多，影响并发处理效率'
            });
        }

        // 检查网络请求失败率
        const embeddingFailureRate = this.metrics.embeddingGeneration.failedRequests / Math.max(this.metrics.embeddingGeneration.totalRequests, 1);
        if (embeddingFailureRate > 0.1) {
            bottlenecks.push({
                phase: 'networkRequests',
                impact: 'high',
                failureRate: Math.round(embeddingFailureRate * 100),
                description: 'Embedding服务请求失败率过高'
            });
        }

        return bottlenecks;
    }

    /**
     * 获取瓶颈描述
     */
    _getBottleneckDescription(phase) {
        const descriptions = {
            fileScanning: '文件扫描耗时过长，可能是由于文件数量过多或磁盘IO性能问题',
            fileParsing: '文件解析耗时过长，可能是Worker创建失败导致同步处理过多',
            embeddingGeneration: 'Embedding生成耗时过长，可能是网络延迟或服务器响应慢',
            vectorDatabase: '向量数据库操作耗时过长，可能是网络连接或数据库性能问题'
        };
        return descriptions[phase] || '未知性能问题';
    }

    /**
     * 生成优化建议
     */
    _generateRecommendations() {
        const recommendations = [];
        const breakdown = this._calculatePerformanceBreakdown();

        // 基于瓶颈给出建议
        if (breakdown.fileScanning.percentage > 30) {
            recommendations.push({
                category: 'fileScanning',
                priority: 'medium',
                suggestion: '考虑增加更多文件类型到忽略列表，或启用更激进的智能筛选',
                impact: '可减少文件扫描时间20-40%'
            });
        }

        if (breakdown.embeddingGeneration.percentage > 50) {
            recommendations.push({
                category: 'embedding',
                priority: 'high',
                suggestion: '考虑增加批处理大小、使用本地embedding服务或切换到更快的embedding模型',
                impact: '可减少embedding生成时间30-60%'
            });
        }

        if (this.metrics.fileParsing.workerCreationFailures > this.metrics.fileParsing.totalFiles * 0.3) {
            recommendations.push({
                category: 'workerOptimization',
                priority: 'high',
                suggestion: '减少最大Worker数量，优化Worker创建策略，或完全使用同步处理',
                impact: '可提高处理稳定性和速度'
            });
        }

        if (breakdown.vectorDatabase.percentage > 25) {
            recommendations.push({
                category: 'vectorDB',
                priority: 'medium',
                suggestion: '考虑增加批量插入大小、优化网络连接或使用本地向量数据库',
                impact: '可减少数据库操作时间20-50%'
            });
        }

        return recommendations;
    }

    /**
     * 保存报告到文件
     */
    async _saveReport(report) {
        try {
            await fs.ensureDir(path.dirname(this.reportPath));
            await fs.writeJson(this.reportPath, report, { spaces: 2 });
            
            // 同时生成一个简化的markdown报告
            const markdownPath = this.reportPath.replace('.json', '.md');
            await this._generateMarkdownReport(report, markdownPath);
            
        } catch (error) {
            console.error('❌ [PerformanceAnalyzer] 保存报告失败:', error);
        }
    }

    /**
     * 生成Markdown格式的报告
     */
    async _generateMarkdownReport(report, markdownPath) {
        const formatTime = (ms) => {
            if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
            return `${ms.toFixed(0)}ms`;
        };

        const formatMemory = (mb) => {
            if (mb >= 1024) return `${(mb / 1024).toFixed(2)}GB`;
            return `${mb.toFixed(0)}MB`;
        };

        // 计算各模块的总耗时和占比
        const moduleTimings = report.detailed.moduleTimings || {};

        const md = `# 🚀 智能代码分块工具 - 性能测速报告

## 📊 项目基本信息
- **项目名称**: ${report.metadata.workspace.name}
- **项目路径**: \`${report.metadata.workspace.path}\`
- **用户ID**: ${report.metadata.workspace.userId}
- **设备ID**: ${report.metadata.workspace.deviceId}
- **分析时间**: ${new Date(report.metadata.generatedAt).toLocaleString('zh-CN')}
- **总处理时间**: **${formatTime(report.summary.totalDuration)}**

## 📈 处理结果统计
| 指标 | 数量 | 备注 |
|------|------|------|
| 📁 扫描文件总数 | ${report.summary.totalFiles} | 符合条件的代码文件 |
| ⏭️ 跳过文件数 | ${report.summary.skippedFiles} | 被过滤器排除的文件 |
| ✅ 成功处理文件 | ${report.summary.processedFiles} | 成功解析并分块的文件 |
| 🧩 生成代码块 | ${report.summary.totalChunks} | 总共生成的代码分块数 |
| 🌐 Embedding请求 | ${report.summary.totalEmbeddingRequests} | 发送给向量化服务的请求数 |
| 📊 插入向量数 | ${report.summary.insertedVectors} | 成功插入数据库的向量数 |

## ⏱️ 各阶段性能分解
| 阶段 | 耗时 | 占总时间比例 | 状态 |
|------|------|-------------|------|
| 🔍 文件扫描 | ${formatTime(report.performance.breakdown.fileScanning?.duration || 0)} | ${report.performance.breakdown.fileScanning?.percentage || 0}% | ${(report.performance.breakdown.fileScanning?.percentage || 0) < 10 ? '✅ 良好' : (report.performance.breakdown.fileScanning?.percentage || 0) < 30 ? '⚠️ 一般' : '🔴 较慢'} |
| 🔧 文件解析 | ${formatTime(report.performance.breakdown.fileParsing?.duration || 0)} | ${report.performance.breakdown.fileParsing?.percentage || 0}% | ${(report.performance.breakdown.fileParsing?.percentage || 0) < 20 ? '✅ 良好' : (report.performance.breakdown.fileParsing?.percentage || 0) < 40 ? '⚠️ 一般' : '🔴 较慢'} |
| 🧠 Embedding生成 | ${formatTime(report.performance.breakdown.embeddingGeneration?.duration || 0)} | ${report.performance.breakdown.embeddingGeneration?.percentage || 0}% | ${(report.performance.breakdown.embeddingGeneration?.percentage || 0) < 40 ? '✅ 良好' : (report.performance.breakdown.embeddingGeneration?.percentage || 0) < 60 ? '⚠️ 一般' : '🔴 较慢'} |
| 🗄️ 向量数据库 | ${formatTime(report.performance.breakdown.vectorDatabase?.duration || 0)} | ${report.performance.breakdown.vectorDatabase?.percentage || 0}% | ${(report.performance.breakdown.vectorDatabase?.percentage || 0) < 20 ? '✅ 良好' : (report.performance.breakdown.vectorDatabase?.percentage || 0) < 40 ? '⚠️ 一般' : '🔴 较慢'} |

## 🔧 模块详细耗时分析

### 📂 FileScanner (文件扫描器)
- **初始化时间**: ${formatTime(moduleTimings.fileScanner?.initTime || 0)}
- **扫描时间**: ${formatTime(moduleTimings.fileScanner?.scanTime || 0)}
- **过滤时间**: ${formatTime(moduleTimings.fileScanner?.filterTime || 0)}

### 🔍 ParserSelector (解析器选择器)
- **初始化时间**: ${formatTime(moduleTimings.parserSelector?.initTime || 0)}
- **解析时间**: ${formatTime(moduleTimings.parserSelector?.parseTime || 0)}
- **分块时间**: ${formatTime(moduleTimings.parserSelector?.chunkTime || 0)}

### 🚀 Dispatcher (任务调度器)
- **初始化时间**: ${formatTime(moduleTimings.dispatcher?.initTime || 0)}
- **调度时间**: ${formatTime(moduleTimings.dispatcher?.dispatchTime || 0)}
- **Worker处理时间**: ${formatTime(moduleTimings.dispatcher?.workerTime || 0)}

### 📤 Sender (数据发送器)
- **初始化时间**: ${formatTime(moduleTimings.sender?.initTime || 0)}
- **准备时间**: ${formatTime(moduleTimings.sender?.prepareTime || 0)}
- **发送时间**: ${formatTime(moduleTimings.sender?.sendTime || 0)}
- **批处理时间**: ${formatTime(moduleTimings.sender?.batchTime || 0)}

### 📊 VectorManager (向量管理器)
- **初始化时间**: ${formatTime(moduleTimings.vectorManager?.initTime || 0)}
- **缓存操作时间**: ${formatTime(moduleTimings.vectorManager?.cacheTime || 0)}
- **数据库操作时间**: ${formatTime(moduleTimings.vectorManager?.dbTime || 0)}
- **向量化时间**: ${formatTime(moduleTimings.vectorManager?.embeddingTime || 0)}

### 🌳 MerkleTree (默克尔树)
- **构建时间**: ${formatTime(moduleTimings.merkleTree?.buildTime || 0)}
- **证明生成时间**: ${formatTime(moduleTimings.merkleTree?.proofTime || 0)}

## 🌐 网络性能分析

### Embedding服务网络表现
- **总请求数**: ${report.detailed.networkRequests.embedding?.count || 0}
- **总网络时间**: ${formatTime(report.detailed.networkRequests.embedding?.totalTime || 0)}
- **平均请求时间**: ${formatTime(report.detailed.networkRequests.embedding?.averageTime || 0)}
- **最快请求**: ${formatTime(report.detailed.networkRequests.embedding?.minTime === Infinity ? 0 : report.detailed.networkRequests.embedding?.minTime || 0)}
- **最慢请求**: ${formatTime(report.detailed.networkRequests.embedding?.maxTime || 0)}
- **失败次数**: ${report.detailed.networkRequests.embedding?.failures || 0}
- **成功率**: ${report.detailed.networkRequests.embedding?.count > 0 ? (((report.detailed.networkRequests.embedding.count - (report.detailed.networkRequests.embedding.failures || 0)) / report.detailed.networkRequests.embedding.count) * 100).toFixed(1) : 0}%

### 向量数据库网络表现
- **总请求数**: ${report.detailed.networkRequests.vectorDB?.count || 0}
- **总网络时间**: ${formatTime(report.detailed.networkRequests.vectorDB?.totalTime || 0)}
- **平均请求时间**: ${formatTime(report.detailed.networkRequests.vectorDB?.averageTime || 0)}
- **插入操作数**: ${report.detailed.networkRequests.vectorDB?.insertOperations || 0}
- **查询操作数**: ${report.detailed.networkRequests.vectorDB?.queryOperations || 0}
- **失败次数**: ${report.detailed.networkRequests.vectorDB?.failures || 0}

## 🗄️ 数据库操作详情
| 操作类型 | 执行次数 | 总耗时 | 平均耗时 |
|---------|---------|--------|----------|
| 创建集合 | ${report.detailed.vectorDatabase.collectionOps?.create?.count || 0} | ${formatTime(report.detailed.vectorDatabase.collectionOps?.create?.totalTime || 0)} | ${report.detailed.vectorDatabase.collectionOps?.create?.count > 0 ? formatTime((report.detailed.vectorDatabase.collectionOps.create.totalTime || 0) / report.detailed.vectorDatabase.collectionOps.create.count) : '0ms'} |
| 删除集合 | ${report.detailed.vectorDatabase.collectionOps?.delete?.count || 0} | ${formatTime(report.detailed.vectorDatabase.collectionOps?.delete?.totalTime || 0)} | ${report.detailed.vectorDatabase.collectionOps?.delete?.count > 0 ? formatTime((report.detailed.vectorDatabase.collectionOps.delete.totalTime || 0) / report.detailed.vectorDatabase.collectionOps.delete.count) : '0ms'} |
| 插入向量 | ${report.detailed.vectorDatabase.collectionOps?.insert?.count || 0} | ${formatTime(report.detailed.vectorDatabase.collectionOps?.insert?.totalTime || 0)} | ${report.detailed.vectorDatabase.collectionOps?.insert?.count > 0 ? formatTime((report.detailed.vectorDatabase.collectionOps.insert.totalTime || 0) / report.detailed.vectorDatabase.collectionOps.insert.count) : '0ms'} |
| 查询向量 | ${report.detailed.vectorDatabase.collectionOps?.query?.count || 0} | ${formatTime(report.detailed.vectorDatabase.collectionOps?.query?.totalTime || 0)} | ${report.detailed.vectorDatabase.collectionOps?.query?.count > 0 ? formatTime((report.detailed.vectorDatabase.collectionOps.query.totalTime || 0) / report.detailed.vectorDatabase.collectionOps.query.count) : '0ms'} |

## 🚨 性能瓶颈识别
${report.performance.bottlenecks.length > 0 ? 
  report.performance.bottlenecks.map(b => `### ${b.impact === 'high' ? '🔴' : b.impact === 'medium' ? '🟡' : '🟢'} ${b.phase} (${b.impact === 'high' ? '高影响' : b.impact === 'medium' ? '中等影响' : '低影响'})
- **问题**: ${b.description}
- **影响程度**: ${b.percentage ? `占总时间 ${b.percentage}%` : b.failureRate ? `失败率 ${b.failureRate}%` : b.count ? `失败 ${b.count} 次` : '影响较小'}`).join('\n\n') : 
  '✅ 未检测到明显的性能瓶颈，整体运行良好！'
}

## 💡 性能优化建议
${report.performance.recommendations.length > 0 ? 
  report.performance.recommendations.map(r => `### ${r.priority === 'high' ? '🔴' : r.priority === 'medium' ? '🟡' : '🟢'} ${r.category} (${r.priority === 'high' ? '高优先级' : r.priority === 'medium' ? '中优先级' : '低优先级'})
- **建议**: ${r.suggestion}
- **预期效果**: ${r.impact}`).join('\n\n') : 
  '✅ 当前性能表现良好，暂无特殊优化建议。'
}

## 🖥️ 系统环境信息
- **操作系统**: ${report.metadata.system.platform} (${report.metadata.system.arch})
- **Node.js版本**: ${report.metadata.system.nodeVersion}
- **CPU核心数**: ${report.metadata.system.cpuCount}
- **系统总内存**: ${formatMemory(report.metadata.system.totalMemory)}
- **进程ID**: ${report.detailed.systemResources.processId}

## 📊 内存使用情况
- **初始内存**: ${formatMemory(report.detailed.systemResources.initialMemory)}
- **峰值内存**: ${formatMemory(report.detailed.systemResources.peakMemory)}
- **结束内存**: ${formatMemory(report.detailed.systemResources.finalMemory)}
- **内存增长**: ${formatMemory(report.detailed.systemResources.finalMemory - report.detailed.systemResources.initialMemory)}

## 📈 性能评分

### 🎯 总体性能评分
${this._calculatePerformanceScore(report)}/100 分

### 📋 评分说明
- **90-100分**: 🏆 优秀 - 性能表现卓越
- **80-89分**: 🥇 良好 - 性能表现良好
- **70-79分**: 🥈 一般 - 性能可接受，有优化空间
- **60-69分**: 🥉 较差 - 存在明显性能问题
- **<60分**: ❌ 差 - 需要立即优化

---

**📋 报告生成时间**: ${new Date().toLocaleString('zh-CN')}  
**🔧 生成工具**: 智能代码分块工具 v0.1.0  
**📁 报告位置**: \`${markdownPath}\`

> 💡 **提示**: 此报告包含了项目处理的详细性能数据，建议定期生成报告以监控性能趋势。如有性能问题，请参考上述优化建议进行改进。
`;

        await fs.writeFile(markdownPath, md, 'utf8');
        console.log(`📄 [性能分析] 详细测速报告已生成: ${markdownPath}`);
    }

    /**
     * 计算性能评分
     */
    _calculatePerformanceScore(report) {
        let score = 100;
        
        // 根据各阶段耗时占比扣分
        const breakdown = report.performance.breakdown;
        if (breakdown.fileScanning?.percentage > 30) score -= 10;
        if (breakdown.fileParsing?.percentage > 40) score -= 15;
        if (breakdown.embeddingGeneration?.percentage > 60) score -= 20;
        if (breakdown.vectorDatabase?.percentage > 40) score -= 15;
        
        // 根据失败率扣分
        const embeddingFailureRate = (report.detailed.embeddingGeneration.failedRequests || 0) / 
                                   Math.max(report.detailed.embeddingGeneration.totalRequests || 1, 1);
        if (embeddingFailureRate > 0.1) score -= 20;
        if (embeddingFailureRate > 0.05) score -= 10;
        
        // 根据Worker失败率扣分
        const workerFailureRate = (report.detailed.fileParsing.workerCreationFailures || 0) / 
                                 Math.max(report.detailed.fileParsing.totalFiles || 1, 1);
        if (workerFailureRate > 0.3) score -= 15;
        if (workerFailureRate > 0.1) score -= 5;
        
        return Math.max(score, 0);
    }
}

module.exports = PerformanceAnalyzer; 