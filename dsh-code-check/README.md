# dsh-code-check

DeepSeek Harness (dsh) 代码审查插件：整合 **ESLint** 静态检查、**Prettier** 格式校验与启发式问题分析，输出包含问题列表、分级与修复建议的结构化审查报告。

## 功能特性

- 🔍 **多步审查流水线**：读取目标 → ESLint 检查 → Prettier 格式校验 → 启发式分析 → 生成报告
- 📁 **目录审查**：path 指向目录时递归扫描（自动排除 node_modules/.git/dist 等），聚合生成总评分 + 文件清单 + 逐文件问题详情
- 📐 **TypeScript 支持**：通过 typescript-eslint 正确解析 .ts/.tsx，提供类型级规则（no-explicit-any、no-unused-vars 等）
- 📋 **结构化报告**：评分（A-D）、问题概览表、错误/警告分区、修复建议、下一步行动
- 🛠 **工具整合**：调用 ESLint CLI（JSON 输出解析）+ Prettier API，支持项目自有 eslint.config，缺失时使用内置通用配置
- 💡 **修复建议知识库**：常见 ESLint 规则 → 中文修复指引，并标注可 `--fix` 自动修复的条目
- 🔒 **路径安全**：文件审查限制在 dsh 工作目录内，拒绝 `..` 逃逸与符号链接越权
- 🔧 **fix 模式**：可选先执行 `eslint --fix` 再输出修复后的报告

## 安装

```bash
npm install dsh-code-check
```

或在 dsh 配置中引用插件路径：

```yaml
plugins:
  - id: code-check
    name: "绝对路径/dsh-code-check/index.js"
```

## 工具说明

### `code_review`

**参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `path` | string | 与 snippet 二选一 | 要审查的文件**或目录**路径（相对 dsh 工作目录），目录会递归审查 |
| `snippet` | string | 与 path 二选一 | 要审查的代码片段文本 |
| `language` | string | 否 | snippet 的语言：javascript/typescript/json/css/html/markdown（默认 javascript） |
| `fix` | boolean | 否 | 为 true 时先执行 `eslint --fix` 再出报告（默认 false） |
| `maxFiles` | number | 否 | 目录审查时最多扫描的文件数（默认 200） |

**使用示例**

对话中直接说：

> 审查一下 src/index.ts

Agent 会调用：

```json
{ "path": "src/index.ts" }
```

目录审查：

> 审查一下 src 目录

Agent 会调用：

```json
{ "path": "src", "maxFiles": 200 }
```

审查代码片段：

```json
{
  "snippet": "var a = 1\nif (a == 1) { console.log(a) }",
  "language": "javascript"
}
```

## 报告结构

```markdown
# 📋 代码审查报告
**审查目标**: src/index.js（124 行，3.2 KB）
**整体评分**: ⭐ A（96/100）

## 📊 问题概览        —— 错误/警告/可自动修复/格式/建议 计数表
## ❌ 必须修复（Error） —— [行:列] 规则名 + 说明 + 修复建议
## ⚠️ 建议改进（Warning）
## 💡 风格与潜在问题    —— TODO 标记、console 残留、超长行、eval 风险等
## 🎨 代码格式          —— Prettier 差异行数与修复命令
## 🔧 下一步行动        —— 可执行的修复入口
```

## 设计要点

- **TypeScript 解析**：内置兜底配置按文件后缀分流——JS 用通用规则，TS 接入 `typescript-eslint` 推荐规则与解析器；无需项目自带 tsconfig（未开启类型信息类规则）
- **子进程调用**：ESLint 通过 `child_process.execFile` 运行，`--format json` 输出后解析为结构化消息列表；片段审查时以临时目录为 cwd，避免规则匹配范围外文件被忽略
- **配置回退**：优先使用被审查项目自己的 `eslint.config.*`；缺失时报错信息识别后自动切换插件内置 `eslint.fallback.config.mjs`
- **启发式检查**：对所有语言生效（TODO/FIXME、console、超长行、行尾空白、Tab 缩进、eval）
- **评分模型**：`100 - 8×错误 - 3×警告 - 6×格式失败 - 1×建议`，A≥90 / B≥75 / C≥60 / D<60

## 开发与测试

```bash
cd dsh-code-check
pnpm install
pnpm test    # 24 项断言：报告结构、问题检出、格式校验、参数校验、路径安全、渲染独立性、目录审查、TS 审查
pnpm lint
```

## 扩展方向

- 已支持目录级审查，可继续增强：并行分片、按 git diff 只审查变更文件
- 集成 stylelint（CSS）、markdownlint、Ruff（Python）等更多语言工具
- 报告同时输出 JSON 结构，供上层 Agent 程序化消费
