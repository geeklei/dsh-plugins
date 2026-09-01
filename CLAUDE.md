# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个 DeepSeek Harness (dsh) 插件集合，包含三个功能插件：
- `dsh-plugin-calculator` - 数学计算工具插件
- `dsh-text-stats` - 文本统计工具插件  
- `dsh-file-manager-cli` - 文件管理命令插件

## 架构说明

### 插件结构

每个插件都遵循标准的 dsh 插件架构：

1. **入口文件** (`index.js`)
   - 导出 `name`、`inject` 和 `apply(ctx)`
   - 使用 `ctx.tools.register()` 或 `ctx.commands.register()` 注册功能
   - 通过 `cordis.patch.yml` 声明 bundle 集成

2. **Bundle 声明** (`cordis.patch.yml`)
   - 使用 `insert` 声明将插件集成到 dsh 运行时
   - `id` 必须全局唯一

3. **配置文件** (`package.json`)
   - `dsh.bundle.patch` 字段指定 patch 文件位置
   - `files` 字段定义发布时包含的文件
   - 使用 `@deepseek-ai/dsh-tools` 作为核心依赖

### 依赖注入模式

- **工具类型**：`inject: ["tools"]` - 为 AI 模型提供工具能力
- **命令类型**：`inject: ["commands"]` - 为用户提供直接命令
- 通过 `ctx` 上下文访问 dsh 服务

### 事件系统

插件使用 Cordis 事件系统：
- `ready` / `dispose` - 生命周期钩子
- `tools/pre-execute` - 工具执行前拦截
- `tools/execute` - 工具执行拦截
- `tools/result` - 工具结果观察

## 开发命令

### 本地开发调试

1. **安装依赖**
   ```bash
   cd dsh-plugin-calculator  # 或其他插件目录
   pnpm install
   ```

2. **创建调试配置**
   ```bash
   # 创建 debug.patch.yml
   cat > debug.patch.yml <<EOF
   - insert:
       - id: calculator
         name: "绝对路径/dsh-plugin-calculator/index.js"
   EOF
   ```

3. **启动 dsh Web**
   ```bash
   pnpm dsh web --patch ./debug.patch.yml
   # 打开 http://127.0.0.1:3080
   ```

### 测试和构建

每个插件都有独立的脚本：

**dsh-plugin-calculator**
```bash
pnpm test        # 运行测试
pnpm validate    # 验证插件配置
pnpm lint        # ESLint 检查
pnpm format      # Prettier 格式化
```

**dsh-text-stats**
```bash
npm test         # 运行钩子验证测试
```

**dsh-file-manager-cli**
```bash
npm run check    # 语法检查
npm run test     # 运行测试
```

### 打包和发布

1. **构建 tarball**
   ```bash
   pnpm pack
   ```

2. **安装到 dsh profile**
   ```bash
   dsh plugin --profile web add ./插件名-版本号.tgz
   ```

3. **验证安装**
   ```bash
   dsh plugin --profile web --dump-config
   ```

4. **卸载插件**
   ```bash
   dsh plugin --profile web remove 插件名
   ```

5. **发布到 npm**
   ```bash
   npm login       # 首次登录
   npm publish     # 发布插件
   ```

## 重要注意事项

### 插件开发规范

1. **插件名必须全局唯一**，安装后会记录在 profile 配置中
2. **必须声明 inject 依赖**，否则无法访问相应的 ctx 服务
3. **dsh 仍处于开发者预览阶段**，API 可能随版本变化，建议锁定依赖版本
4. **使用 @deepseek-ai/dsh-tools** 提供的工具定义和类型系统

### 安全考虑

1. **文件操作限制**：dsh-file-manager-cli 将所有操作限制在 dsh 启动工作目录内
2. **输入验证**：所有插件都实现参数验证和错误处理
3. **资源限制**：dsh-text-stats 对输入大小进行限制，防止资源滥用

### 开发建议

1. **使用中文注释和文档**，提升中文用户体验
2. **实现详细的错误信息**，帮助调试和问题定位
3. **遵循命名规范**：
   - 插件名：kebab-case（`dsh-my-plugin`）
   - 工具名：snake_case（`my_tool`）
   - 命令名：kebab-case（`my-command`）
4. **添加测试覆盖**，确保功能正确性和稳定性

### 插件功能说明

**dsh-plugin-calculator**
- 提供基本数学运算（加减乘除、幂运算、取模）
- 科学计算（三角函数、对数、指数等）
- 单位转换（长度、重量、温度）

**dsh-text-stats**
- 统计文本的字符数、字节数、行数、词数
- 估算 token 用量
- 提供调用统计和性能监控

**dsh-file-manager-cli**
- 提供安全的文件/目录管理命令
- 限制在 dsh 工作目录内操作
- 支持：列表、创建目录、创建文件、删除操作