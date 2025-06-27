/**
 * Collection名称生成工具
 * 
 * 基于腾讯云向量数据库的collection命名限制
 * 实现与Python版本相同的collection名称生成逻辑
 */

/**
 * 创建符合腾讯云限制的集合名称
 * 从用户ID、设备ID和工作空间路径生成collection名称
 * 
 * @param {string} user_id - 用户标识符
 * @param {string} device_id - 设备标识符  
 * @param {string} workspace_path - 工作空间路径
 * @returns {string} Collection名称字符串
 */
function createCollectionName(user_id, device_id, workspace_path) {
    // 参数验证
    if (!user_id || !device_id || !workspace_path) {
        throw new Error('Missing required parameters: user_id, device_id, workspace_path');
    }
    
    // 清理工作空间路径 - 将所有非字母数字字符替换为下划线
    const clean_workspace = workspace_path
        .replace(/[^a-zA-Z0-9]/g, '_')  // 替换所有非字母数字字符为下划线
        .replace(/_+/g, '_')            // 多个连续下划线合并为一个
        .replace(/^_+|_+$/g, '');       // 去除首尾的下划线
    
    return `${user_id}_${device_id}_${clean_workspace}`;
}

/**
 * 验证collection名称是否符合腾讯云要求
 * 
 * @param {string} collectionName - 待验证的collection名称
 * @returns {boolean} 是否有效
 */
function validateCollectionName(collectionName) {
    if (!collectionName || typeof collectionName !== 'string') {
        return false;
    }
    
    // 腾讯云collection名称规则:
    // - 只能包含字母、数字、下划线
    // - 长度限制通常为1-64字符
    // - 不能以下划线开头或结尾
    const isValidFormat = /^[a-zA-Z0-9][a-zA-Z0-9_]*[a-zA-Z0-9]$/.test(collectionName) || 
                         /^[a-zA-Z0-9]$/.test(collectionName);
    const isValidLength = collectionName.length >= 1 && collectionName.length <= 64;
    
    return isValidFormat && isValidLength;
}

/**
 * 从collection名称中解析出组件信息
 * 
 * @param {string} collectionName - collection名称
 * @returns {Object} 解析结果 {user_id, device_id, workspace_path}
 */
function parseCollectionName(collectionName) {
    if (!collectionName || typeof collectionName !== 'string') {
        return null;
    }
    
    const parts = collectionName.split('_');
    if (parts.length < 3) {
        return null;
    }
    
    return {
        user_id: parts[0],
        device_id: parts[1],
        workspace_path: parts.slice(2).join('_')  // 重新组合workspace部分
    };
}

module.exports = {
    createCollectionName,
    validateCollectionName,
    parseCollectionName
}; 