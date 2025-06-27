const fs = require('fs-extra');
const path = require('path');
const { minimatch } = require('minimatch');
const crypto = require('crypto');
const PathUtils = require('./utils/pathUtils');
const FileTypeDetector = require('./utils/fileTypeDetector');
const IntelligentFileFilter = require('./utils/intelligentFileFilter');

class FileScanner {
    constructor(config, performanceAnalyzer = null) {
        this.config = config;
        this.performanceAnalyzer = performanceAnalyzer;
        
        // 🔥 完全依赖配置文件的白名单，移除硬编码默认值
        if (!config.scanFileExtensions || !Array.isArray(config.scanFileExtensions) || config.scanFileExtensions.length === 0) {
            throw new Error('❌ scanFileExtensions配置缺失或无效！必须在配置文件中指定要处理的文件扩展名白名单。');
        }
        
        this.scanFileExtensions = new Set(
            config.scanFileExtensions.map(ext => ext.toLowerCase())
        );
        
        // 🔥 完全依赖配置的忽略模式，移除硬编码
        this.ignorePatterns = config.ignorePatterns || [];
        
        this.maxFileSize = config.maxFileSize || 2 * 1024 * 1024; // 默认2MB
        this.workspacePath = config.workspacePath || null;
        
            // 添加符号链接循环检测
            this.visitedPaths = new Set(); // 用于检测循环引用
            this.processSymlinks = config.processSymlinks !== false; // 默认处理符号链接
            this.maxSymlinkDepth = config.maxSymlinkDepth || 10; // 最大符号链接深度
            
            // 添加递归深度控制
            this.maxDepth = config.maxDepth || 100; // 默认最大目录深度

            // 添加文件类型检测器
            this.fileTypeDetector = new FileTypeDetector();
            this.includeTextContentOnly = config.includeTextContentOnly !== false; // 默认只包含文本内容
            this.processBinaryFiles = config.processBinaryFiles !== false; // 默认处理二进制文件但不包含内容
        
        // 🎯 添加智能文件筛选器
        this.intelligentFilter = new IntelligentFileFilter();
        this.enableIntelligentFiltering = config.enableIntelligentFiltering !== false; // 默认启用智能筛选
        
        // 🔥 完全依赖配置的目录忽略列表
        this.ignoredDirectories = new Set(config.ignoredDirectories || []);
        }

    async scanWorkspace(workspacePath) {
        // 开始计时：FileScanner初始化
        if (this.performanceAnalyzer) {
            this.performanceAnalyzer.startModuleTimer('fileScanner', 'initTime');
            this.performanceAnalyzer.recordMemoryUsage('fileScanner_start');
        }

        // 参数验证
        if (!workspacePath || typeof workspacePath !== 'string') {
            throw new Error('Invalid workspace path: path must be a non-empty string');
        }
    
        // 路径存在性和类型检查
        try {
            const stats = await fs.stat(workspacePath);
            if (!stats.isDirectory()) {
                throw new Error(`Path is not a directory: ${workspacePath}`);
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                throw new Error(`Workspace path does not exist: ${workspacePath}`);
            } else if (error.code === 'EACCES') {
                throw new Error(`Permission denied to access workspace: ${workspacePath}`);
            }
            throw error;
        }
    
        // 权限检查
        try {
            await fs.access(workspacePath, fs.constants.R_OK);
        } catch (error) {
            throw new Error(`No read permission for workspace: ${workspacePath}`);
        }
    
        this.workspacePath = path.resolve(workspacePath); // 规范化路径
        this.visitedPaths.clear(); // 清理之前的访问记录
        const fileList = [];
        const fileHashes = {};
        const fileContents = [];
        const fileInfos = [];
    
        // 添加统计信息跟踪
        this.scanStats = {
            totalFilesScanned: 0,
            skippedFiles: 0,
            processedFiles: 0,
            skippedDirectories: 0
        };
    
        // 结束初始化，开始扫描
        if (this.performanceAnalyzer) {
            this.performanceAnalyzer.endModuleTimer('fileScanner', 'initTime');
            this.performanceAnalyzer.startModuleTimer('fileScanner', 'scanTime');
        }
    
        try {
            await this._scanDirectory(this.workspacePath, fileList, fileHashes, fileContents, fileInfos, 0, 0);
            
            // 结束扫描，开始过滤
            if (this.performanceAnalyzer) {
                this.performanceAnalyzer.endModuleTimer('fileScanner', 'scanTime');
                this.performanceAnalyzer.startModuleTimer('fileScanner', 'filterTime');
            }
            
            const merkleTree = await this._buildMerkleTree(fileList, fileHashes, fileInfos);
            
            // 结束过滤
            if (this.performanceAnalyzer) {
                this.performanceAnalyzer.endModuleTimer('fileScanner', 'filterTime');
                this.performanceAnalyzer.recordMemoryUsage('fileScanner_end');
            }
            
            console.log(`[FileScanner] ✅ 扫描完成: 发现 ${fileList.length} 个文件`);
            
            return { 
                fileList, 
                merkleTree: merkleTree, 
                fileContents, 
                fileHashes,
                scanStats: this.scanStats
            };
        } catch (error) {
            console.error('[FileScanner] ❌ 扫描工作区时出错:', error);
            throw error;
        }
    }

    async _scanDirectory(dir, fileList, fileHashes, fileContents, fileInfos, symlinkDepth = 0, depth = 0) {
        // 检查递归深度
        if (depth > this.maxDepth) {
            const relativePath = path.relative(this.workspacePath, dir);
            console.warn(`Maximum directory depth (${this.maxDepth}) exceeded: ${relativePath || '.'}`);
            return;
        }
        
        // 🔥 目录级别的快速忽略检查 - 提前终止整个目录树的扫描
        const dirName = path.basename(dir);
        if (this.ignoredDirectories.has(dirName)) {
            return;
        }
        
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            let relativePath = path.relative(this.workspacePath, fullPath);

            // 标准化路径为正斜杠格式（跨平台兼容）
            relativePath = PathUtils.normalizePath(relativePath);

            // 🔥 增强的忽略检查 - 先检查目录级忽略，再检查模式匹配
            if (entry.isDirectory()) {
                // 目录级快速忽略
                if (this.ignoredDirectories.has(entry.name)) {
                    this.scanStats.skippedDirectories++;
                continue;
            }

                // 使用新的扫描逻辑检查目录
                if (!this._shouldScan(relativePath + '/')) { // 目录路径加斜杠
                    this.scanStats.skippedDirectories++;
                    continue;
                }

                await this._scanDirectory(fullPath, fileList, fileHashes, fileContents, fileInfos, symlinkDepth, depth + 1);
            } else if (entry.isFile()) {
                this.scanStats.totalFilesScanned++;
                
                // 1. 🔥 新的白名单扫描检查
                if (!this._shouldScan(relativePath)) {
                    this.scanStats.skippedFiles++;
                    continue;
                }
                
                // 2. 🎯 智能文件筛选检查
                if (this.enableIntelligentFiltering) {
                    if (!this.intelligentFilter.isValuableFile(relativePath)) {
                        this.scanStats.skippedFiles++;
                        continue;
                    }
                }
                
                await this._processFile(fullPath, relativePath, fileList, fileHashes, fileContents, fileInfos);
                this.scanStats.processedFiles++;
            } else if (entry.isSymbolicLink()) {
                // 检查符号链接是否应该扫描
                if (!this._shouldScan(relativePath)) {
                    continue;
                }
                
                // 处理符号链接
                await this._processSymbolicLink(fullPath, relativePath, fileList, fileHashes, fileContents, symlinkDepth);
            } else {
                // 记录其他特殊文件类型
                this._logSpecialFileType(entry, relativePath);
            }
        }
    }

    /**
     * 🔥 新方法：基于白名单的文件扫描判断
     * 只扫描配置中指定的文件扩展名，大大提升扫描效率
     */
    _shouldScan(filePath) {
        // 🔥 快速路径检查 - 检查是否包含被忽略的目录段
        const pathSegments = filePath.split('/');
        for (const segment of pathSegments) {
            if (this.ignoredDirectories.has(segment)) {
                return false; // 路径中包含被忽略的目录
            }
        }
        
        // 🔥 目录特殊处理：目录本身应该允许扫描（不受扩展名限制）
        if (filePath.endsWith('/')) {
            // 这是目录，只检查模式匹配
            return !this.ignorePatterns.some(pattern => minimatch(filePath, pattern));
        }
        
        // 🔥 特殊文件检查 - 优先级最高的忽略逻辑
        const fileBaseName = path.basename(filePath).toLowerCase();
        
        // 忽略 CUDA 相关的大型生成文件
        if (fileBaseName.includes('.cubin.') || fileBaseName.includes('_cubin.') || 
            fileBaseName.includes('.ptx.') || fileBaseName.includes('_ptx.') ||
            fileBaseName.includes('.fatbin.') || fileBaseName.includes('_fatbin.') ||
            fileBaseName.includes('cubin.cpp') || fileBaseName.includes('ptx.cpp')) {
            console.log(`🚫 Ignoring CUDA binary file: ${filePath}`);
            return false;
        }
        
        // 🔥 白名单扩展名检查 - 这是核心逻辑（只对文件生效）
        const ext = path.extname(filePath).toLowerCase();
        if (!ext || !this.scanFileExtensions.has(ext)) {
            // 添加调试信息来确认文件是否被正确忽略
            if (filePath.includes('.cubin')) {
                console.log(`🚫 Ignoring cubin file: ${filePath} (extension: ${ext || 'none'})`);
            }
            return false; // 没有扩展名或扩展名不在白名单中
        }
        
        // 🔥 特殊文件名检查（即使扩展名正确也要忽略）
        const fileName = fileBaseName;
        const specialIgnoredFiles = [
            '.ds_store', 'thumbs.db', 'desktop.ini',
            // 编译和压缩文件（即使扩展名匹配也要忽略）
            '.min.js', '.min.css', '.bundle.js', '.bundle.css',
            '.chunk.js', '.chunk.css'
        ];
        if (specialIgnoredFiles.includes(fileName)) {
            return false;
        }
        
        // 检查是否是编译/压缩文件
        if (fileName.includes('.min.') || fileName.includes('.bundle.') || fileName.includes('.chunk.')) {
            return false;
        }
        
        // 🔥 最后使用模式匹配进行额外检查（最耗时，放在最后）
        if (this.ignorePatterns.some(pattern => {
            const match = minimatch(filePath, pattern);
            if (match && filePath.includes('.cubin')) {
                console.log(`🚫 Ignoring cubin file by pattern: ${filePath} (matched pattern: ${pattern})`);
            }
            return match;
        })) {
            return false;
        }
        
        return true; // 通过所有检查，应该扫描此文件
    }
    
    /**
     * 🔥 保留原有方法名的兼容性封装
     * @deprecated 建议使用 _shouldScan 方法
     */
    _shouldIgnore(filePath) {
        return !this._shouldScan(filePath);
    }

        // 提取文件处理逻辑为独立方法
        async _processFile(fullPath, relativePath, fileList, fileHashes, fileContents, fileInfos) {
            try {
                const stats = await fs.stat(fullPath);
                
                // 🔥 提前检查文件大小 - 避免读取大文件
                if (stats.size > this.maxFileSize) {
                    console.warn(`File ${relativePath} exceeds maximum size limit (${stats.size} bytes, max: ${this.maxFileSize} bytes)`);
                    this.scanStats.skippedFiles++;
                    return;
                }
        
                // 使用新的文件读取和类型检测逻辑
                const buffer = await fs.readFile(fullPath);
                const fileInfo = this.fileTypeDetector.analyzeFile(buffer, relativePath);
                
                // 处理文件信息
                if (fileInfo.error) {
                    console.warn(`Failed to analyze file ${relativePath}: ${fileInfo.error}`);
                    return;
                }
                
                // 决定是否处理此文件
                if (fileInfo.isBinary && !this.processBinaryFiles) {
                    return;
                }
                
                // 关键修复：只有所有操作都成功后，才同时添加到所有数据结构
                // 这确保了 fileList、fileContents 和 fileHashes 的索引对应关系
                fileList.push(relativePath);
                fileHashes[relativePath] = fileInfo.hash;

                fileInfos.push({
                    path: relativePath,
                    fullPath: fullPath,
                    stats: stats,
                    hash: fileInfo.hash,
                    isBinary: fileInfo.isBinary,
                    encoding: fileInfo.encoding
                });
                
                if (fileInfo.isBinary) {
                    // 对于二进制文件，存储特殊标记而不是内容
                    if (this.includeTextContentOnly) {
                        fileContents.push(`[BINARY FILE: ${stats.size} bytes, type: ${this._getFileType(relativePath)}]`);
                    } else {
                        // 如果需要包含二进制文件，可以存储base64编码
                        fileContents.push(`[BINARY:${buffer.toString('base64')}]`);
                    }
                } else {
                    // 对于文本文件，存储内容
                    fileContents.push(fileInfo.content);
                }
                
            } catch (error) {
                // 完整的错误处理：处理各种可能的错误情况
                if (error.code === 'ENOENT') {
                    console.warn(`File ${relativePath} was deleted during scan`);
                } else if (error.code === 'EACCES') {
                    console.warn(`Permission denied reading file ${relativePath}`);
                } else if (error.code === 'EISDIR') {
                    console.warn(`Expected file but found directory: ${relativePath}`);
                } else if (error.code === 'EMFILE' || error.code === 'ENFILE') {
                    console.warn(`Too many open files, skipping ${relativePath}`);
                } else if (error.message.includes('invalid byte sequence') || 
                           error.message.includes('malformed UTF-8') ||
                           error.message.includes('Invalid or incomplete UTF-8')) {
                    console.warn(`File ${relativePath} contains non-UTF-8 content, skipping`);
                } else {
                    console.warn(`Failed to process file ${relativePath}: ${error.message}`);
                }
                // 处理失败的文件不会被添加到任何数组中，保持数据一致性
            }
        }
    
        // 符号链接处理方法
        async _processSymbolicLink(fullPath, relativePath, fileList, fileHashes, fileContents, symlinkDepth) {
            if (!this.processSymlinks) {
                console.debug(`Skipping symbolic link (disabled): ${relativePath}`);
                return;
            }
    
            // 检查符号链接深度
            if (symlinkDepth >= this.maxSymlinkDepth) {
                console.warn(`Maximum symbolic link depth exceeded: ${relativePath} (depth: ${symlinkDepth})`);
                return;
            }
    
            try {
                // 读取符号链接目标
                const linkTarget = await fs.readlink(fullPath);
                const resolvedPath = path.resolve(path.dirname(fullPath), linkTarget);
                
                // 检查循环引用
                if (this._isCircularReference(resolvedPath, fullPath)) {
                    console.warn(`Circular reference detected: ${relativePath} -> ${linkTarget}`);
                    return;
                }
    
                // 检查链接目标是否存在并获取其状态
                let targetStats;
                try {
                    targetStats = await fs.stat(resolvedPath);
                } catch (statError) {
                    if (statError.code === 'ENOENT') {
                        console.warn(`Broken symbolic link: ${relativePath} -> ${linkTarget} (target not found)`);
                    } else if (statError.code === 'EACCES') {
                        console.warn(`Broken symbolic link: ${relativePath} -> ${linkTarget} (permission denied)`);
                    } else {
                        console.warn(`Broken symbolic link: ${relativePath} -> ${linkTarget} (${statError.message})`);
                    }
                    return;
                }
    
                // 检查是否指向工作区外部
                const resolvedRelative = path.relative(this.workspacePath, resolvedPath);
                if (resolvedRelative.startsWith('..') || path.isAbsolute(resolvedRelative)) {
                    console.warn(`Symbolic link points outside workspace: ${relativePath} -> ${linkTarget}`);
                    return;
                }
    
                // 记录访问的路径以检测循环
                this.visitedPaths.add(path.resolve(fullPath));
    
                try {
                    if (targetStats.isDirectory()) {
                        // 处理目录符号链接
                        await this._scanDirectory(resolvedPath, fileList, fileHashes, fileContents, fileInfos, symlinkDepth + 1, depth + 1);
                    } else if (targetStats.isFile()) {
                        // 处理文件符号链接
                        await this._processFile(resolvedPath, relativePath, fileList, fileHashes, fileContents, fileInfos);
                    }
                } finally {
                    // 清理访问记录
                    this.visitedPaths.delete(path.resolve(fullPath));
                }
    
            } catch (error) {
                console.warn(`Error processing symbolic link ${relativePath}: ${error.message}`);
            }
        }
    
        // 循环引用检测
        _isCircularReference(resolvedPath, currentPath) {
            const normalizedResolved = path.resolve(resolvedPath);
            const normalizedCurrent = path.resolve(currentPath);
            
            // 检查是否指向自己
            if (normalizedResolved === normalizedCurrent) {
                return true;
            }
            
            // 检查是否已经访问过
            if (this.visitedPaths.has(normalizedResolved)) {
                return true;
            }
            
            // 检查是否指向父目录（可能造成循环）
            let parent = path.dirname(normalizedCurrent);
            while (parent !== path.dirname(parent)) { // 直到根目录
                if (normalizedResolved === parent) {
                    return true;
                }
                parent = path.dirname(parent);
            }
            
            return false;
        }
    
        // 特殊文件类型记录
        _logSpecialFileType(entry, relativePath) {
            let fileType = 'unknown';
            
            if (entry.isBlockDevice()) {
                fileType = 'block device';
            } else if (entry.isCharacterDevice()) {
                fileType = 'character device';
            } else if (entry.isFIFO()) {
                fileType = 'FIFO/pipe';
            } else if (entry.isSocket()) {
                fileType = 'socket';
            }
            

        }

        // 添加文件类型判断方法
        _getFileType(filePath) {
            const ext = path.extname(filePath).toLowerCase();
            const typeMap = {
                '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.gif': 'image', '.bmp': 'image',
                '.mp3': 'audio', '.wav': 'audio', '.mp4': 'video', '.avi': 'video',
                '.zip': 'archive', '.rar': 'archive', '.7z': 'archive', '.tar': 'archive',
                '.pdf': 'document', '.doc': 'document', '.docx': 'document',
                '.exe': 'executable', '.dll': 'executable', '.so': 'executable'
            };
            return typeMap[ext] || 'binary';
        }

    async _calculateFileHash(filePath) {
        const content = await fs.readFile(filePath);
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    async _buildMerkleTree(fileList, fileHashes, fileInfos) {
        const merkleTree = {
            // 根节点信息
            root: {
                hash: this._calculateRootHash(fileHashes),
                timestamp: Date.now(),
                fileCount: fileList.length
            },
            
            // 文件节点映射
            files: {},
            
            // 目录节点映射
            directories: {},
            
            // 快速索引
            index: {
                byExtension: {},
                bySize: { small: [], medium: [], large: [] },
                recentlyModified: []
            },
            
            // 元数据
            metadata: {
                version: "2.0",
                createdAt: Date.now(),
                workspace: this.workspacePath,
                totalSize: 0,
                treeDepth: 0
            }
        };

        // 构建文件和目录映射
        await this._buildFileDirectoryMappings(fileInfos, fileHashes, merkleTree);
        
        // 构建索引
        await this._buildIndexes(fileInfos, merkleTree);
        
        return merkleTree;
    }

    async _buildFileDirectoryMappings(fileInfos, fileHashes, tree) {
        const directoryContents = {};
        
        for (const fileInfo of fileInfos) {
            const { path: relativePath, stats } = fileInfo;  // ✅ 复用已有的stats信息
            const parentDir = PathUtils.getParentDir(relativePath);
            
            // 添加文件信息 - 使用已收集的stats，避免重复系统调用
            tree.files[relativePath] = {
                hash: fileInfo.hash,
                size: stats.size,
                lastModified: stats.mtime.getTime(),
                path: relativePath,
                parentPath: PathUtils.isCurrentDir(parentDir) ? '' : parentDir
            };
            
            // 收集目录信息
            if (!directoryContents[parentDir]) {
                directoryContents[parentDir] = {
                    files: [],
                    subdirs: new Set()
                };
            }
            directoryContents[parentDir].files.push(relativePath);
            
            // 处理嵌套目录
            let currentDir = parentDir;
            while (currentDir && currentDir !== '' && !PathUtils.isCurrentDir(currentDir)) {
                const parentOfCurrent = PathUtils.getParentOfDir(currentDir);
                if (PathUtils.isCurrentDir(parentOfCurrent) || PathUtils.pathEquals(parentOfCurrent, currentDir)) break;
                
                if (!directoryContents[parentOfCurrent]) {
                    directoryContents[parentOfCurrent] = {
                        files: [],
                        subdirs: new Set()
                    };
                }
                directoryContents[parentOfCurrent].subdirs.add(currentDir);
                currentDir = parentOfCurrent;
            }
        }
        
        // 按目录深度排序，确保子目录先于父目录处理
        const sortedDirs = Object.keys(directoryContents)
            .filter(dir => !PathUtils.isCurrentDir(dir))
            .sort((a, b) => {
                const depthA = PathUtils.getPathDepth(a);
                const depthB = PathUtils.getPathDepth(b);
                return depthB - depthA; // 深度大的先处理（自底向上）
            });
        
        // 自底向上构建目录节点并计算正确的哈希值
        for (const dirPath of sortedDirs) {
            const contents = directoryContents[dirPath];
            const subdirs = Array.from(contents.subdirs);
            const allChildren = [...contents.files, ...subdirs];

            tree.directories[dirPath] = {
                hash: this._calculateDirectoryHash(allChildren, tree.files, tree.directories),
                fileCount: contents.files.length,
                children: allChildren,
                files: contents.files,
                subdirs: subdirs
            };
        }
    }

    async _buildIndexes(fileInfos, tree) {
        for (const fileInfo of fileInfos) {
            const { path: relativePath, stats } = fileInfo;
            const ext = path.extname(relativePath);
            const treeFileInfo = tree.files[relativePath];
            
            // 按扩展名分组
            if (!tree.index.byExtension[ext]) {
                tree.index.byExtension[ext] = [];
            }
            tree.index.byExtension[ext].push(relativePath);
            
            // 按大小分组
            if (stats.size < 10240) { // ✅ 使用 stats.size
                tree.index.bySize.small.push(relativePath);
            } else if (stats.size < 102400) { // ✅ 使用 stats.size
                tree.index.bySize.medium.push(relativePath);
            } else {
                tree.index.bySize.large.push(relativePath);
            }
            
            tree.metadata.totalSize += stats.size; // ✅ 使用 stats.size
        }
        
        // 计算目录树深度
        tree.metadata.treeDepth = this._calculateTreeDepth(Object.keys(tree.directories));
    }

    _calculateDirectoryHash(children, fileMap, directories) {
        const childHashes = children.map(child => {
            if (fileMap[child]) {
                // 是文件，返回文件哈希
                return fileMap[child].hash;
            } else {
                // 是子目录，返回子目录的哈希值
                const subDirInfo = directories[child];
                if (subDirInfo && subDirInfo.hash) {
                    return subDirInfo.hash;
                } else {
                    // 如果子目录信息不存在，使用目录名作为兜底
                    console.warn(`Warning: Directory hash not found for ${child}, using directory name as fallback`);
                    return child;
                }
            }
        }).sort();
        
        return crypto.createHash('sha256')
            .update(childHashes.join(''))
            .digest('hex');
    }

    _calculateTreeDepth(directories) {
        return Math.max(...directories.map(dir => PathUtils.getPathDepth(dir)), 0);
    }

    _calculateRootHash(fileHashes) {
        if (!fileHashes || Object.keys(fileHashes).length === 0) {
            return crypto.createHash('sha256').update('').digest('hex');
        }
        
        const sortedHashes = Object.keys(fileHashes)
            .sort()
            .map(key => fileHashes[key])
            .join('');
        return crypto.createHash('sha256').update(sortedHashes).digest('hex');
    }

    // 计算实际扫描深度
    _calculateScanDepth(directories) {
        if (!directories || Object.keys(directories).length === 0) {
            return 0;
        }
        
        let maxDepth = 0;
        for (const dirPath of Object.keys(directories)) {
            const depth = dirPath.split(path.sep).length;
            maxDepth = Math.max(maxDepth, depth);
        }
        return maxDepth;
    }

    static findChangedFiles(oldTree, newTree) {
        const changedFiles = [];
        
        // 检查新增和修改的文件
        for (const [path, fileInfo] of Object.entries(newTree.files)) {
            const oldFileInfo = oldTree.files[path];
            
            if (!oldFileInfo) {
                changedFiles.push({
                    path,
                    type: 'added',
                    newHash: fileInfo.hash
                });
            } else if (oldFileInfo.hash !== fileInfo.hash) {
                changedFiles.push({
                    path,
                    type: 'modified',
                    oldHash: oldFileInfo.hash,
                    newHash: fileInfo.hash
                });
            }
        }
        
        // 检查删除的文件
        for (const [path, fileInfo] of Object.entries(oldTree.files)) {
            if (!newTree.files[path]) {
                changedFiles.push({
                    path,
                    type: 'deleted',
                    oldHash: fileInfo.hash
                });
            }
        }
        
        return changedFiles;
    }
}

module.exports = FileScanner; 