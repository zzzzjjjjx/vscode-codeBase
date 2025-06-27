const path = require('path');

/**
 * 智能文件筛选器
 * 专门识别和处理有价值的源代码文件
 * 彻底排除第三方依赖、构建产物等无关文件
 */
class IntelligentFileFilter {
    constructor() {
        // 🎯 有价值的源代码文件扩展名
        this.valuableExtensions = new Set([
            // Web前端
            '.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte',
            '.css', '.scss', '.sass', '.less', '.styl',
            '.html', '.htm',
            
            // 后端语言
            '.py', '.rb', '.php', '.java', '.c', '.cpp', '.cc', '.cxx',
            '.cs', '.go', '.rs', '.kt', '.scala', '.clj', '.cljs',
            '.sh', '.bash', '.zsh', '.ps1',
            
            // 移动开发
            '.swift', '.m', '.mm', '.dart',
            
            // 数据和配置（选择性）
            '.sql', '.graphql', '.yaml', '.yml',
            
            // 脚本和自动化
            '.lua', '.pl', '.r'
        ]);

        // 🚫 应该处理但需要特别注意的文件（通常是用户配置）
        this.conditionalExtensions = new Set([
            '.json', '.xml', '.toml', '.ini', '.conf'
        ]);

        // 🎯 有价值的文件名模式（即使扩展名不在列表中）
        this.valuableFilePatterns = [
            /^Dockerfile$/i,
            /^Makefile$/i,
            /^CMakeLists\.txt$/i,
            /^\.env\.example$/i,
            /^\.gitignore$/i,
            /^\.eslintrc$/i,
            /^\.prettierrc$/i,
            /^webpack\.config\./i,
            /^rollup\.config\./i,
            /^vite\.config\./i
        ];

        // 🚫 明确排除的目录（性能优化）
        this.excludedDirectories = new Set([
            'node_modules', 'bower_components', 'vendor', 'packages',
            '.git', '.svn', '.hg', 'CVS',
            'dist', 'build', 'out', 'output', 'public', 'bin', 'obj',
            'coverage', '.nyc_output', 'htmlcov',
            '__pycache__', '.pytest_cache', '.tox', 'venv', 'env', '.env',
            '.cache', '.vector-cache', 'tmp', 'temp', '.tmp',
            '.vscode', '.idea', '.vs'
        ]);

        // 🚫 明确排除的文件名
        this.excludedFileNames = new Set([
            '.ds_store', 'thumbs.db', 'desktop.ini',
            'license', 'license.txt', 'license.md',
            'changelog', 'changelog.txt', 'changelog.md',
            'readme', 'readme.txt', 'readme.md',
            'contributing', 'contributing.md',
            'code_of_conduct.md', 'security.md',
            'authors', 'contributors', 'maintainers'
        ]);
    }

    /**
     * 🎯 判断文件是否值得处理
     * @param {string} filePath - 文件路径
     * @returns {boolean} 是否应该处理该文件
     */
    isValuableFile(filePath) {
        const fileName = path.basename(filePath).toLowerCase();
        const ext = path.extname(filePath).toLowerCase();
        const nameWithoutExt = path.basename(filePath, ext).toLowerCase();

        // 1. 检查是否在排除的文件名列表中
        if (this.excludedFileNames.has(fileName) || 
            this.excludedFileNames.has(nameWithoutExt)) {
            return false;
        }

        // 2. 检查是否是有价值的文件模式
        for (const pattern of this.valuableFilePatterns) {
            if (pattern.test(path.basename(filePath))) {
                return true;
            }
        }

        // 3. 检查文件扩展名
        if (this.valuableExtensions.has(ext)) {
            return true;
        }

        // 4. 有条件的扩展名需要进一步检查
        if (this.conditionalExtensions.has(ext)) {
            return this._isValuableConfigFile(filePath);
        }

        // 5. 默认不处理
        return false;
    }

    /**
     * 🎯 检查路径是否包含应该排除的目录
     * @param {string} filePath - 文件路径
     * @returns {boolean} 是否应该排除
     */
    containsExcludedDirectory(filePath) {
        const pathSegments = filePath.split(path.sep);
        return pathSegments.some(segment => this.excludedDirectories.has(segment));
    }

    /**
     * 🎯 判断配置文件是否有价值
     * @param {string} filePath - 文件路径
     * @returns {boolean} 是否有价值
     */
    _isValuableConfigFile(filePath) {
        const fileName = path.basename(filePath).toLowerCase();
        
        // 项目级配置文件通常有价值
        const valuableConfigPatterns = [
            /^package\.json$/,
            /^composer\.json$/,
            /^requirements\.txt$/,
            /^pipfile$/,
            /^cargo\.toml$/,
            /^go\.mod$/,
            /^pom\.xml$/,
            /^build\.gradle$/,
            /^project\.clj$/,
            /^mix\.exs$/,
            /^.*\.config\.(js|ts|json)$/,
            /^.*rc\.(js|ts|json|yaml|yml)$/,
            /^tsconfig\.json$/,
            /^jsconfig\.json$/
        ];

        return valuableConfigPatterns.some(pattern => pattern.test(fileName));
    }

    /**
     * 🎯 获取文件价值评分
     * @param {string} filePath - 文件路径
     * @returns {number} 价值评分 (0-100)
     */
    getFileValueScore(filePath) {
        if (this.containsExcludedDirectory(filePath)) {
            return 0;
        }

        if (!this.isValuableFile(filePath)) {
            return 0;
        }

        const ext = path.extname(filePath).toLowerCase();
        const fileName = path.basename(filePath);

        // 核心源代码文件最高分
        const coreLanguages = ['.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.c', '.cpp', '.cs', '.go', '.rs'];
        if (coreLanguages.includes(ext)) {
            return 100;
        }

        // 前端文件高分
        const frontendFiles = ['.vue', '.svelte', '.css', '.scss', '.sass', '.less'];
        if (frontendFiles.includes(ext)) {
            return 90;
        }

        // 脚本和配置文件中等分
        const scriptFiles = ['.sh', '.bash', '.ps1', '.sql'];
        if (scriptFiles.includes(ext)) {
            return 80;
        }

        // 特殊文件中等分
        for (const pattern of this.valuableFilePatterns) {
            if (pattern.test(fileName)) {
                return 75;
            }
        }

        // 配置文件较低分
        if (this.conditionalExtensions.has(ext)) {
            return 60;
        }

        return 50;
    }

    /**
     * 🎯 生成处理建议
     * @param {string[]} filePaths - 文件路径列表
     * @returns {Object} 处理建议
     */
    generateProcessingSuggestion(filePaths) {
        const analysis = {
            total: filePaths.length,
            valuable: 0,
            excluded: 0,
            byType: {},
            suggestions: []
        };

        for (const filePath of filePaths) {
            const score = this.getFileValueScore(filePath);
            const ext = path.extname(filePath).toLowerCase() || 'no-ext';

            if (score === 0) {
                analysis.excluded++;
            } else {
                analysis.valuable++;
            }

            if (!analysis.byType[ext]) {
                analysis.byType[ext] = { count: 0, avgScore: 0, totalScore: 0 };
            }
            analysis.byType[ext].count++;
            analysis.byType[ext].totalScore += score;
            analysis.byType[ext].avgScore = analysis.byType[ext].totalScore / analysis.byType[ext].count;
        }

        // 生成建议
        const reductionRate = ((analysis.excluded / analysis.total) * 100).toFixed(1);
        analysis.suggestions.push(`可以跳过 ${analysis.excluded} 个文件 (${reductionRate}%)，专注处理 ${analysis.valuable} 个有价值的文件`);

        if (analysis.excluded > analysis.valuable) {
            analysis.suggestions.push('🎯 建议：启用智能文件筛选可以显著提升处理效率');
        }

        return analysis;
    }
}

module.exports = IntelligentFileFilter; 