# 从0到1创建 dsh 插件完整指南

本指南将教你如何从头开始创建一个 DeepSeek Harness (dsh) 插件，以 `dsh-plugin-calculator` 为例。

## 📚 目录

1. [dsh 插件概述](#dsh-插件概述)
2. [项目结构](#项目结构)
3. [核心概念](#核心概念)
4. [创建插件步骤](#创建插件步骤)
5. [插件类型](#插件类型)
6. [部署与测试](#部署与测试)
7. [发布到 npm](#发布到-npm)
8. [最佳实践](#最佳实践)
9. [常见问题](#常见问题)

## dsh 插件概述

dsh 插件是扩展 DeepSeek Harness 功能的模块化组件。插件可以为 AI 模型提供：
- **工具**: 让 AI 模型调用特定的功能（如数学计算、文件操作等）
- **命令**: 为用户提供直接可用的命令

## 项目结构

一个标准的 dsh 插件项目包含以下文件：

```
dsh-plugin-name/
├── package.json          # 项目配置和元数据
├── index.js              # 插件主入口文件
├── cordis.patch.yml      # Bundle 声明文件
├── README.md             # 文档说明
└── test-plugin.js        # 测试脚本（可选）
```

## 核心概念

### 1. 插件导出

插件必须导出以下内容：

```javascript
export const name = "plugin-name"      // 插件唯一标识符
export const inject = ["tools"]         // 依赖的服务
export function apply(ctx) {            // 插件初始化函数
  // 注册工具或命令
}
```

### 2. 依赖注入

通过 `inject` 数组声明需要的服务：
- `"tools"`: 注册工具（为 AI 模型提供功能）
- `"commands"`: 注册命令（为用户提供命令）
- 其他 dsh 服务

### 3. 上下文对象

`ctx` 上下文对象提供访问 dsh 服务的能力：
- `ctx.tools.register()`: 注册工具
- `ctx.commands.register()`: 注册命令
- `ctx.effect()`: 注册副作用

## 创建插件步骤

### 步骤1: 创建项目结构

```bash
mkdir dsh-plugin-calculator
cd dsh-plugin-calculator
```

### 步骤2: 创建 package.json

```json
{
  "name": "dsh-plugin-calculator",
  "version": "0.1.0",
  "description": "Mathematical calculation tools for DeepSeek Harness",
  "type": "module",
  "main": "index.js",
  "files": [
    "index.js",
    "cordis.patch.yml",
    "README.md"
  ],
  "keywords": [
    "dsh",
    "plugin",
    "calculator",
    "math"
  ],
  "license": "MIT",
  "dependencies": {
    "@deepseek-ai/dsh-tools": "0.1.1-rc.2"
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

### 步骤3: 创建 cordis.patch.yml

```yaml
- insert:
    - id: calculator
      name: "dsh-plugin-calculator"
```

### 步骤4: 创建插件主文件 index.js

```javascript
import { defineTool } from "@deepseek-ai/dsh-tools"

export const name = "calculator"
export const inject = ["tools"]

export function apply(ctx) {
  // 注册工具
  ctx.tools.register(defineTool({
    name: "tool_name",
    description: "工具描述",
    parameters: {
      // 参数定义
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: value }],
    },
    async execute(args) {
      // 工具逻辑
      return "结果"
    },
  }))
}
```

### 步骤5: 创建 README.md

提供完整的文档说明，包括：
- 插件功能介绍
- 安装和使用方法
- API 文档
- 示例代码

## 插件类型

### 1. 工具类型插件

为 AI 模型提供工具能力：

```javascript
export const name = "my-plugin"
export const inject = ["tools"]

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: "my_tool",
    description: "工具描述",
    parameters: {
      input: {
        type: "string",
        required: true,
        description: "输入参数"
      }
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: value }],
    },
    async execute(args) {
      return "处理结果"
    },
  }))
}
```

### 2. 命令类型插件

为用户提供直接命令：

```javascript
export const name = "my-plugin"
export const inject = ["commands"]

export function apply(ctx) {
  const commands = [
    ["my-command", "命令描述", ({ rawInput }) => {
      // 命令处理逻辑
      return { kind: "success", text: "执行结果" }
    }]
  ]

  for (const [name, description, handler] of commands) {
    ctx.effect(() => ctx.commands.register({
      name,
      description,
      input: { hint: "<参数>" },
      handler,
    }))
  }
}
```

## 部署与测试

### 本地开发调试

```bash
# 安装依赖
pnpm install

# 创建调试配置
cat > debug.patch.yml <<"EOF"
- insert:
    - id: calculator
      name: "E:/dsh-plugins/dsh-plugin-calculator/index.js"
EOF

# 启动 dsh Web 并加载插件
pnpm dsh web --patch ./debug.patch.yml
```

### 安装到 dsh profile

```bash
# 打包插件
pnpm pack

# 安装到 dsh
dsh plugin --profile web add ./dsh-plugin-calculator-0.1.0.tgz

# 验证安装
dsh plugin --profile web --dump-config

# 卸载插件
dsh plugin --profile web remove dsh-plugin-calculator
```

## 发布到 npm

```bash
# 登录 npm（首次）
npm login

# 发布插件
npm publish

# 发布后其他用户可以安装
dsh plugin --profile web add dsh-plugin-calculator
```

## 最佳实践

### 1. 错误处理

```javascript
async execute(args) {
  try {
    // 验证输入
    if (!args.input) {
      return "错误：缺少必需参数"
    }

    // 业务逻辑
    const result = processInput(args.input)
    return result
  } catch (error) {
    return `错误：${error.message}`
  }
}
```

### 2. 参数验证

```javascript
parameters: {
  value: {
    type: "number",
    required: true,
    description: "数值参数",
    minimum: 0,
    maximum: 100
  }
}
```

### 3. 命名规范

- 插件名使用 kebab-case：`dsh-my-plugin`
- 工具名使用 snake_case：`my_tool`
- 命令名使用 kebab-case：`my-command`

### 4. 文档完整性

- 详细的 README.md
- API 文档
- 使用示例
- 错误处理说明

### 5. 测试覆盖

- 功能测试
- 边界条件测试
- 错误处理测试

## 常见问题

### Q: 插件名重复怎么办？

A: 插件名必须全局唯一。选择独特且有描述性的名称，如 `dsh-my-unique-plugin`。

### Q: 为什么需要 inject 声明？

A: dsh 使用依赖注入机制，不声明依赖的服务就无法访问相应的上下文对象。

### Q: 如何调试插件？

A: 使用 debug.patch.yml 文件进行本地调试，并添加 console.log 输出调试信息。

### Q: 插件版本兼容性如何处理？

A: 在 package.json 中锁定依赖版本，关注 dsh 的更新日志，及时适配 API 变化。

### Q: 如何处理复杂的参数验证？

A: 使用 dsh-tools 提供的 schema 验证功能，或在 execute 函数中进行自定义验证。

### Q: 插件可以访问文件系统吗？

A: 可以，但需要注意安全性，避免路径遍历攻击，参考 `dsh-file-manager` 的安全实践。

## 示例参考

本项目包含以下示例插件：

1. **dsh-plugin-calculator** - 数学计算工具插件
2. **dsh-text-stats** - 文本统计工具插件
3. **dsh-file-manager** - 文件管理命令插件

## 总结

创建 dsh 插件的完整流程：

1. ✅ 创建项目结构和基础文件
2. ✅ 配置 package.json 和 cordis.patch.yml
3. ✅ 实现插件核心逻辑
4. ✅ 编写文档和测试
5. ✅ 本地调试和验证
6. ✅ 打包和部署
7. ✅ 发布到 npm（可选）

通过本指南，你可以快速上手 dsh 插件开发，为 DeepSeek Harness 生态系统贡献你的插件！

## 相关资源

- [DeepSeek Harness GitHub](https://github.com/deepseek-ai/deepseek-harness)
- [dsh-tools 文档](https://www.npmjs.com/package/@deepseek-ai/dsh-tools)
- [Cordis 文档](https://cordis.js.org/)
