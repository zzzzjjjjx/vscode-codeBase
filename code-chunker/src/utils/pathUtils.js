const path = require('path');

/**
 * 跨平台路径处理工具类
 * 统一使用正斜杠作为内部路径格式，避免Windows和Unix系统的路径分隔符差异
 */
class PathUtils {
    /**
     * 标准化路径格式，统一使用正斜杠
     * @param {string} pathStr - 原始路径字符串
     * @returns {string} 标准化后的路径
     */
    static normalizePath(pathStr) {
        if (!pathStr) return '';
        return path.normalize(pathStr).replace(/\\/g, '/');
    }

    /**
     * 标准化目录路径，确保以正斜杠结尾
     * @param {string} dirPath - 目录路径
     * @returns {string} 标准化的目录路径，以 '/' 结尾
     */
    static normalizeDirPath(dirPath) {
        if (!dirPath) return '';
        const normalized = this.normalizePath(dirPath);
        return normalized.endsWith('/') ? normalized : normalized + '/';
    }

    /**
     * 获取文件的父目录路径，标准化格式
     * @param {string} filePath - 文件路径
     * @returns {string} 父目录路径，以 '/' 结尾
     */
    static getParentDir(filePath) {
        if (!filePath) return '';
        return this.normalizeDirPath(path.dirname(filePath));
    }

    /**
     * 检查是否为根目录
     * @param {string} dirPath - 目录路径
     * @returns {boolean} 是否为根目录
     */
    static isRootDir(dirPath) {
        if (!dirPath) return false;
        const normalized = this.normalizePath(dirPath);
        return normalized === '.' || normalized === '';
    }

    /**
     * 检查是否为当前目录格式
     * @param {string} dirPath - 目录路径
     * @returns {boolean} 是否为当前目录格式（如 './' 或 '.\'）
     */
    static isCurrentDir(dirPath) {
        if (!dirPath) return false;
        const normalized = this.normalizePath(dirPath);
        return normalized === './' || normalized === '.';
    }

    /**
     * 计算路径深度（目录层级数）
     * @param {string} pathStr - 路径字符串
     * @returns {number} 路径深度
     */
    static getPathDepth(pathStr) {
        if (!pathStr) return 0;
        const normalized = this.normalizePath(pathStr);
        if (this.isRootDir(normalized)) return 0;
        return normalized.split('/').filter(part => part !== '' && part !== '.').length;
    }

    /**
     * 获取路径的父目录（不包含末尾分隔符）
     * @param {string} dirPath - 目录路径（以 '/' 结尾）
     * @returns {string} 父目录路径
     */
    static getParentOfDir(dirPath) {
        if (!dirPath || this.isCurrentDir(dirPath)) return '';
        
        // 移除末尾的斜杠
        const cleanPath = dirPath.replace(/\/$/, '');
        if (!cleanPath || cleanPath === '.') return '';
        
        const parentPath = this.normalizePath(path.dirname(cleanPath));
        return this.normalizeDirPath(parentPath);
    }

    /**
     * 检查路径是否相等（忽略平台差异）
     * @param {string} path1 - 路径1
     * @param {string} path2 - 路径2
     * @returns {boolean} 路径是否相等
     */
    static pathEquals(path1, path2) {
        return this.normalizePath(path1) === this.normalizePath(path2);
    }
}

module.exports = PathUtils;