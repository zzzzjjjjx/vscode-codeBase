# Node.js Code Chunker

## 项目概述

Node.js Code Chunker 是一个智能代码分块工具，用于将代码文件分割成更小的块，以便于后续处理和分析。该项目是 Python 版本的 Code Chunker 的 Node.js 实现，保持了相同的 API 接口和架构设计。

## 功能特点

- **文件扫描**：扫描工作空间中的文件，支持忽略特定文件或目录。
- **代码分块**：将代码文件分割成更小的块，便于处理。
- **并发处理**：使用并发调度器处理文件，提高效率。
- **进度追踪**：实时追踪处理进度，提供进度统计。
- **数据发送**：将处理后的数据发送到嵌入服务。

## 项目结构

```
nodejs/
├── src/                    # 源代码目录
│   ├── main.js            # 主入口文件
│   ├── fileScanner.js     # 文件扫描器
│   ├── dispatcher.js      # 并发调度器
│   ├── parserSelector.js  # 解析器选择器
│   ├── sender.js          # 数据发送器
│   ├── progressTracker.js # 进度跟踪器
│   └── parsers/           # 解析器模块
├── tests/                 # 测试文件
└── index.js              # 项目入口文件
```

## 安装与使用

### 安装依赖

```bash
npm install
```

### 运行测试

```bash
npm test
```

### 使用示例

```javascript
const { processWorkspace } = require('./index');

async function main() {
    const userId = 'user123';
    const deviceId = 'device456';
    const workspacePath = '/path/to/workspace';
    const token = 'your-token';
    const ignorePatterns = ['**/node_modules/**', '**/.git/**'];

    const success = await processWorkspace(userId, deviceId, workspacePath, token, ignorePatterns);
    console.log('Process completed:', success);
}

main();
```

## 配置

项目支持通过 YAML 文件或运行时配置进行配置。默认配置文件位于 `config/default.yaml`。

## 贡献

欢迎贡献代码或提出建议！请提交 Pull Request 或 Issue。

## 许可证

MIT 