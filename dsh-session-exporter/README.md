# dsh-session-exporter

dsh 会话内容导出插件，支持将当前会话内容导出为多种格式。

## 功能特性

- 支持多种导出格式：JSON、Markdown、HTML、纯文本
- 可选包含元数据信息
- 可选包含时间戳
- 可选清理敏感信息
- 支持直接输出到文件或返回内容

## 安装

```bash
# 在 dsh 项目根目录安装依赖
cd dsh-session-exporter
pnpm install
```

## 使用方法

### 作为工具使用

```javascript
// 在代码中调用
const result = await tools.exportSession({
  format: 'markdown',  // json | markdown | html | txt
  outputPath: './session.md',
  includeMetadata: true,
  includeTimestamps: true,
  sanitize: true
});
```

### 作为命令使用

```bash
# 基本用法
/export-session

# 指定格式
/export-session -f json

# 导出到文件
/export-session -f markdown -o ./chat-history.md

# 不包含元数据
/export-session --no-metadata

# 不包含时间戳
/export-session --no-timestamps

# 不清理敏感信息
/export-session --no-sanitize
```

## 参数说明

### 工具参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| format | string | 否 | 导出格式，可选：json、markdown、html、txt，默认 markdown |
| outputPath | string | 否 | 输出文件路径，不指定则返回内容 |
| includeMetadata | boolean | 否 | 是否包含元数据信息，默认 true |
| includeTimestamps | boolean | 否 | 是否包含时间戳，默认 true |
| sanitize | boolean | 否 | 是否清理敏感信息，默认 true |

### 命令参数

| 参数 | 简写 | 说明 |
|------|------|------|
| --format, -f | 导出格式 |
| --output, -o | 输出文件路径 |
| --no-metadata | 不包含元数据信息 |
| --no-timestamps | 不包含时间戳 |
| --no-sanitize | 不清理敏感信息 |

## 输出格式

### JSON
完整的结构化数据，包含所有会话信息。

### Markdown
易读的 Markdown 格式，适合查看和编辑。

### HTML
带样式的 HTML 页面，适合浏览器查看。

### 纯文本
最简单的文本格式，适合日志记录。

## 元数据信息

包含以下元数据：
- 导出时间
- 用户信息（如果可用）
- 插件版本
- dsh 版本

## 敏感信息清理

自动清理以下类型的信息：
- API 密钥
- 邮箱地址
- 电话号码

## 开发

```bash
# 安装依赖
pnpm install

# 运行测试
pnpm test

# 语法检查
pnpm check

# 代码检查
pnpm lint

# 代码格式化
pnpm format
```

## 许可证

MIT