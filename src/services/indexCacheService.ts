import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

interface IndexedFileRecord {
    filePath: string;
    fileHash: string;
    indexedAt: number;
    workspacePath: string;
    userId: string;
    deviceId: string;
}

interface IndexCacheData {
    version: string;
    records: IndexedFileRecord[];
    lastUpdated: number;
}

export class IndexCacheService {
    private context: vscode.ExtensionContext;
    private cacheFilePath: string;
    private cache: Map<string, IndexedFileRecord> = new Map();
    private isInitialized = false;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.cacheFilePath = path.join(context.globalStorageUri.fsPath, 'indexed-files-cache.json');
    }

    /**
     * 初始化缓存服务
     */
    async initialize(): Promise<void> {
        try {
            // 确保全局存储目录存在
            await fs.promises.mkdir(path.dirname(this.cacheFilePath), { recursive: true });

            // 加载现有缓存
            await this.loadCache();
            this.isInitialized = true;

            
        } catch (error) {
            console.error('[IndexCacheService] 初始化失败:', error);
            this.isInitialized = true; // 即使失败也标记为已初始化，避免阻塞
        }
    }

    /**
     * 检查文件是否已经索引过
     */
    async isFileIndexed(
        filePath: string, 
        workspacePath: string, 
        userId: string, 
        deviceId: string
    ): Promise<boolean> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
            // 计算文件哈希
            const fileHash = await this.calculateFileHash(filePath);
            const cacheKey = this.generateCacheKey(filePath, workspacePath, userId, deviceId);

            const cachedRecord = this.cache.get(cacheKey);
            
            if (!cachedRecord) {
                return false;
            }

            // 检查文件是否被修改过
            if (cachedRecord.fileHash !== fileHash) {
                // 移除过期的缓存记录
                this.cache.delete(cacheKey);
                return false;
            }

            return true;
        } catch (error) {
            console.error(`[IndexCacheService] 检查文件索引状态失败: ${filePath}`, error);
            return false; // 出错时默认进行索引
        }
    }

    /**
     * 标记文件为已索引
     */
    async markFileAsIndexed(
        filePath: string, 
        workspacePath: string, 
        userId: string, 
        deviceId: string
    ): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
            const fileHash = await this.calculateFileHash(filePath);
            const cacheKey = this.generateCacheKey(filePath, workspacePath, userId, deviceId);

            const record: IndexedFileRecord = {
                filePath,
                fileHash,
                indexedAt: Date.now(),
                workspacePath,
                userId,
                deviceId
            };

            this.cache.set(cacheKey, record);
            
            // 异步保存缓存，不阻塞主流程
            this.saveCache().catch(error => {
                console.error('[IndexCacheService] 保存缓存失败:', error);
            });


        } catch (error) {
            console.error(`[IndexCacheService] 标记文件索引失败: ${filePath}`, error);
        }
    }

    /**
     * 批量检查文件索引状态
     */
    async filterUnindexedFiles(
        files: string[], 
        workspacePath: string, 
        userId: string, 
        deviceId: string
    ): Promise<{ indexed: string[]; unindexed: string[] }> {
        const indexed: string[] = [];
        const unindexed: string[] = [];

        for (const file of files) {
            const fullPath = path.isAbsolute(file) ? file : path.join(workspacePath, file);
            
            try {
                const isIndexed = await this.isFileIndexed(fullPath, workspacePath, userId, deviceId);
                if (isIndexed) {
                    indexed.push(file);
                } else {
                    unindexed.push(file);
                }
            } catch (error) {
                console.error(`[IndexCacheService] 检查文件失败: ${file}`, error);
                unindexed.push(file); // 出错时默认需要索引
            }
        }


        return { indexed, unindexed };
    }

    /**
     * 批量标记文件为已索引
     */
    async markFilesAsIndexed(
        files: string[], 
        workspacePath: string, 
        userId: string, 
        deviceId: string
    ): Promise<void> {
        for (const file of files) {
            const fullPath = path.isAbsolute(file) ? file : path.join(workspacePath, file);
            await this.markFileAsIndexed(fullPath, workspacePath, userId, deviceId);
        }
    }

    /**
     * 清除指定工作区的缓存
     */
    async clearWorkspaceCache(workspacePath: string, userId: string, deviceId: string): Promise<void> {
        const keysToDelete: string[] = [];
        
        for (const [key, record] of this.cache.entries()) {
            if (record.workspacePath === workspacePath && 
                record.userId === userId && 
                record.deviceId === deviceId) {
                keysToDelete.push(key);
            }
        }

        keysToDelete.forEach(key => this.cache.delete(key));
        
        await this.saveCache();

    }

    /**
     * 获取缓存统计信息
     */
    getCacheStats(): { totalFiles: number; totalSize: string; oldestRecord?: Date; newestRecord?: Date } {
        let oldestTime = Number.MAX_SAFE_INTEGER;
        let newestTime = 0;

        for (const record of this.cache.values()) {
            if (record.indexedAt < oldestTime) {
                oldestTime = record.indexedAt;
            }
            if (record.indexedAt > newestTime) {
                newestTime = record.indexedAt;
            }
        }

        const stats = {
            totalFiles: this.cache.size,
            totalSize: this.formatSize(JSON.stringify([...this.cache.values()]).length),
            oldestRecord: oldestTime === Number.MAX_SAFE_INTEGER ? undefined : new Date(oldestTime),
            newestRecord: newestTime === 0 ? undefined : new Date(newestTime)
        };

        return stats;
    }

    /**
     * 生成缓存键
     */
    private generateCacheKey(filePath: string, workspacePath: string, userId: string, deviceId: string): string {
        const relativePath = path.relative(workspacePath, filePath);
        const identifier = `${userId}_${deviceId}_${workspacePath}_${relativePath}`;
        return crypto.createHash('md5').update(identifier).digest('hex');
    }

    /**
     * 计算文件哈希
     */
    private async calculateFileHash(filePath: string): Promise<string> {
        try {
            const content = await fs.promises.readFile(filePath);
            return crypto.createHash('md5').update(content).digest('hex');
        } catch (error) {
            console.warn(`[IndexCacheService] 计算文件哈希失败: ${filePath}`, error);
            // 如果无法读取文件，使用文件路径和修改时间作为替代
            const stats = await fs.promises.stat(filePath);
            return crypto.createHash('md5').update(`${filePath}_${stats.mtime.getTime()}`).digest('hex');
        }
    }

    /**
     * 加载缓存数据
     */
    private async loadCache(): Promise<void> {
        try {
            if (!fs.existsSync(this.cacheFilePath)) {
                return;
            }

            const cacheContent = await fs.promises.readFile(this.cacheFilePath, 'utf8');
            const cacheData: IndexCacheData = JSON.parse(cacheContent);

            // 验证缓存版本兼容性
            if (!cacheData.version || cacheData.version !== '1.0') {
                return;
            }

            // 重建缓存映射
            this.cache.clear();
            for (const record of cacheData.records || []) {
                const key = this.generateCacheKey(
                    record.filePath, 
                    record.workspacePath, 
                    record.userId, 
                    record.deviceId
                );
                this.cache.set(key, record);
            }


        } catch (error) {
            console.error('[IndexCacheService] 加载缓存失败:', error);
            this.cache.clear();
        }
    }

    /**
     * 保存缓存数据
     */
    private async saveCache(): Promise<void> {
        try {
            const cacheData: IndexCacheData = {
                version: '1.0',
                records: [...this.cache.values()],
                lastUpdated: Date.now()
            };

            await fs.promises.writeFile(
                this.cacheFilePath, 
                JSON.stringify(cacheData, null, 2), 
                'utf8'
            );


        } catch (error) {
            console.error('[IndexCacheService] 保存缓存失败:', error);
        }
    }

    /**
     * 格式化文件大小
     */
    private formatSize(bytes: number): string {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;
        
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        
        return `${size.toFixed(2)} ${units[unitIndex]}`;
    }
} 