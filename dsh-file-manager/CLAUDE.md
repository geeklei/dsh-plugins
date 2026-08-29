# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

dsh-file-manager 是一个 DeepSeek Harness (dsh) 插件，提供安全的文件和目录管理命令。所有操作都限制在 dsh 启动工作目录内，确保安全性。

## 架构设计

### 插件结构
- **入口文件** (`index.js`): 导出 `name`、`inject` 和 `apply(ctx)` 函数
- **Bundle 声明** (`cordis.patch.yml`): 使用 `insert` 声明将插件集成到 dsh 运行时
- **配置** (`package.json`): 定义插件元数据、脚本和 dsh.bundle.patch 配置

### 安全机制
1. **路径隔离**: 所有文件操作都限制在 dsh 当前工作目录内
2. **符号链接检查**: 防止通过符号链接离开工作目录
3. **输入验证**: 严格的参数验证和错误处理
4. **根目录保护**: 禁止删除插件工作根目录

### 命令系统
插件通过 Cordis 框架注册四个命令：
- `/fs-list` - 列出目录内容
- `/fs-mkdir` - 创建目录（支持递归创建父目录）
- `/fs-touch` - 创建空文件
- `/fs-rm` - 删除文件或空目录

## 开发工作流

### 本地开发调试

1. **创建调试配置**
   ```bash
   # 创建 debug.patch.yml
   cat > debug.patch.yml <<EOF
   - insert:
       - id: file-manager
         name: "绝对路径/dsh-file-manager/index.js"
   EOF
   ```

2. **启动 dsh Web**
   ```bash
   dsh web --patch ./debug.patch.yml
   # 打开 http://127.0.0.1:3080
   ```

### 测试和构建

```bash
npm run check    # 语法检查（使用 node --check）
npm run test     # 运行测试（当前是语法检查的同义词）
npm run lint     # ESLint 检查
npm run format   # Prettier 格式化
```

### 打包和发布

1. **构建 tarball**
   ```bash
   npm pack
   ```

2. **安装到 dsh profile**
   ```bash
   dsh plugin --profile web add ./dsh-file-manager-cli-0.1.3.tgz
   ```

3. **验证安装**
   ```bash
   dsh plugin --profile web --dump-config
   ```

4. **卸载插件**
   ```bash
   dsh plugin --profile web remove file-manager
   ```

## 代码实现要点

### 核心函数
- `insideRoot()`: 验证路径是否在根目录内
- `existingInsideRoot()`: 检查文件是否存在且路径安全
- `input()`: 验证命令输入参数
- `result()`: 统一的结果格式化函数

### 错误处理
- 使用 `try-catch` 捕获所有文件系统操作
- 返回统一的结果格式：`{ kind, text }`
- 提供清晰的中文错误信息

### 性能考虑
- 使用 `fs/promises` API 进行异步操作
- 避免不必要的文件系统调用
- 路径解析使用 Node.js 内置的 `path` 模块

## 依赖管理

### 核心依赖
- 无外部依赖，仅使用 Node.js 内置模块
- 通过 `inject: ["commands"]` 声明依赖 Cordis 命令系统

### 开发依赖
- `prettier`: 代码格式化
- `eslint`: 代码质量检查

## 发布配置

### npm 发布
- `access: "public"` - 公开包
- `registry: "https://registry.npmjs.org/"` - 官方 npm 仓库
- `engines: { "node": ">=18.0.0" }` - Node.js 版本要求

### 文件包含
- `index.js` - 主程序文件
- `cordis.patch.yml` - Bundle 声明文件
- `README.md` - 项目文档

## 重要注意事项

1. **插件名必须全局唯一**，当前使用 `file-manager`
2. **所有文件操作都是相对路径**，不允许绝对路径
3. **递归删除功能暂未实现**，仅支持删除文件和空目录
4. **dsh 仍处于开发者预览阶段**，API 可能随版本变化