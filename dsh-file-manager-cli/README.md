# dsh-file-manager-cli

[![npm version](https://img.shields.io/npm/v/dsh-file-manager-cli.svg)](https://www.npmjs.com/package/dsh-file-manager-cli)
[![Node.js version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![License](https://img.shields.io/npm/l/dsh-file-manager-cli.svg)](LICENSE)

一个安全的 DeepSeek Harness (dsh) 文件和目录管理插件，所有操作都限制在 dsh 启动工作目录内，确保安全性。

## 🚀 功能特性

- ✅ **安全隔离**: 所有文件操作都限制在 dsh 工作目录内
- ✅ **符号链接防护**: 防止通过符号链接离开工作目录
- ✅ **递归创建**: 支持创建多级目录结构
- ✅ **中文界面**: 完整的中文错误提示和使用说明
- ✅ **简洁命令**: 提供直观的文件管理命令

## 📦 安装

### 通过 npm 安装

```bash
npm install dsh-file-manager-cli
```

### 手动安装

1. 下载插件包
```bash
npm pack
```

2. 安装到 dsh profile
```bash
dsh plugin --profile web add ./dsh-file-manager-cli-0.1.3.tgz
```

## 🔧 使用方法

### 基本命令

| 命令 | 描述 | 示例 |
|------|------|------|
| `/fs-list <相对路径>` | 列出目录内容 | `/fs-list docs` |
| `/fs-mkdir <相对路径>` | 创建目录（支持递归） | `/fs-mkdir projects/app` |
| `/fs-touch <相对路径>` | 创建空文件 | `/fs-touch notes.txt` |
| `/fs-rm <相对路径>` | 删除文件或空目录 | `/fs-rm temp.log` |

### 使用示例

```bash
# 列出当前目录内容
/fs-list

# 创建 docs 目录
/fs-mkdir docs

# 在 docs 目录下创建 article.md 文件
/fs-touch docs/article.md

# 创建多级目录结构
/fs-mkdir projects/frontend/src

# 删除文件
/fs-rm temp.txt
```

### 注意事项

- 所有路径必须是**相对路径**，不能使用绝对路径
- 不能删除 dsh 工作根目录
- 只能删除文件和空目录，不支持递归删除
- 路径中不能包含空格

## 🛠️ 开发

### 本地开发

1. 克隆项目
```bash
git clone <repository-url>
cd dsh-file-manager-cli
```

2. 安装依赖
```bash
npm install
```

3. 创建调试配置文件 `debug.patch.yml`:
```yaml
- insert:
    - id: file-manager
      name: "绝对路径/dsh-file-manager-cli/index.js"
```

4. 启动 dsh Web 进行测试
```bash
dsh web --patch ./debug.patch.yml
```

### 开发脚本

```bash
npm run check    # 语法检查
npm run test     # 运行测试
npm run lint     # ESLint 检查
npm run format   # Prettier 格式化
```

### 打包发布

```bash
npm pack                       # 构建 tarball
npm publish                    # 发布到 npm
```

## 🏗️ 架构设计

### 核心组件

- **入口文件** (`index.js`): 插件主入口，定义命令和处理器
- **Bundle 配置** (`cordis.patch.yml`): 声明插件集成配置
- **包配置** (`package.json`): 定义元数据和脚本

### 安全机制

1. **路径验证**: 确保所有操作都在工作目录内
2. **符号链接检测**: 防止路径遍历攻击
3. **输入验证**: 严格的参数检查
4. **错误处理**: 友好的中文错误提示

## 🔒 安全说明

本插件设计时就考虑了安全性：

- 所有文件操作都使用相对路径
- 自动解析和验证路径的真实位置
- 防止通过符号链接离开工作目录
- 禁止删除工作根目录
- 提供清晰的错误信息，不暴露敏感路径

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

## 📞 支持

如果遇到问题，请：

1. 查看文档和错误信息
2. 搜索现有的 Issues
3. 创建新的 Issue 描述问题
