const crypto = require('crypto');

class MerkleTree {
    constructor() {
        this.leaves = [];
        this.tree = [];
    }

    /**
     * 计算单个文件的哈希值
     * @param {string} content - 文件内容
     * @returns {string} - 文件的哈希值
     */
    hashFile(content) {
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    /**
     * 计算两个哈希值的组合哈希
     * @param {string} hash1 - 第一个哈希值
     * @param {string} hash2 - 第二个哈希值
     * @returns {string} - 组合后的哈希值
     */
    combineHashes(hash1, hash2) {
        return crypto.createHash('sha256')
            .update(hash1 + hash2)
            .digest('hex');
    }

    /**
     * 构建 Merkle 树
     * @param {Array<string>} fileHashes - 文件哈希值数组（已预计算）
     * @returns {Object} - 包含根哈希和完整树的对象
     */
    buildTree(fileHashes) {
        // 清空现有数据
        this.leaves = [];
        this.tree = [];

        // 直接使用已计算的哈希值作为叶节点
        this.leaves = [...fileHashes];
        this.tree.push([...this.leaves]);

        // 构建树
        let currentLevel = this.leaves;
        while (currentLevel.length > 1) {
            const nextLevel = [];
            for (let i = 0; i < currentLevel.length; i += 2) {
                if (i + 1 === currentLevel.length) {
                    // 如果是奇数个节点，复制最后一个节点
                    nextLevel.push(this.combineHashes(currentLevel[i], currentLevel[i]));
                } else {
                    nextLevel.push(this.combineHashes(currentLevel[i], currentLevel[i + 1]));
                }
            }
            this.tree.push(nextLevel);
            currentLevel = nextLevel;
        }

        return {
            rootHash: this.tree[this.tree.length - 1][0],
            tree: this.tree
        };
    }

    /**
     * 构建 Merkle 树（兼容旧版本，接收文件内容）
     * @param {Array<string>} fileContents - 文件内容数组
     * @returns {Object} - 包含根哈希和完整树的对象
     * @deprecated 请使用 buildTree(fileHashes) 以避免重复哈希计算
     */
    buildTreeFromContents(fileContents) {
        // 计算文件内容的哈希值
        const fileHashes = fileContents.map(content => this.hashFile(content));
        return this.buildTree(fileHashes);
    }

    /**
     * 获取文件的证明路径
     * @param {number} index - 文件在原始数组中的索引
     * @returns {Array<{hash: string, isLeft: boolean}>} - 证明路径
     */
    getProof(index) {
        const proof = [];
        let currentIndex = index;

        for (let level = 0; level < this.tree.length - 1; level++) {
            const isLeft = currentIndex % 2 === 0;
            const siblingIndex = isLeft ? currentIndex + 1 : currentIndex - 1;
            
            if (siblingIndex < this.tree[level].length) {
                proof.push({
                    hash: this.tree[level][siblingIndex],
                    isLeft: !isLeft
                });
            }

            currentIndex = Math.floor(currentIndex / 2);
        }

        return proof;
    }

    /**
     * 验证文件是否在树中
     * @param {string} content - 文件内容
     * @param {Array<{hash: string, isLeft: boolean}>} proof - 证明路径
     * @param {string} rootHash - 根哈希值
     * @returns {boolean} - 验证结果
     */
    verifyProof(content, proof, rootHash) {
        let hash = this.hashFile(content);

        for (const { hash: siblingHash, isLeft } of proof) {
            hash = isLeft ? 
                this.combineHashes(siblingHash, hash) : 
                this.combineHashes(hash, siblingHash);
        }

        return hash === rootHash;
    }
}

module.exports = MerkleTree; 