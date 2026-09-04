# dsh-session-exporter

dsh 会话内容导出插件，支持将当前会话内容导出为多种格式。

## 功能特性

- 支持多种导出格式：JSON、JSONL、Markdown、HTML、纯文本
- 支持导出范围控制：最近 N 条（last）或编号区间（from/to）
- 支持自动生成带时间戳的输出文件名（autoName）
- 单文件 10MB 大小上限保护，超出时提示缩小范围
- HTML 支持暗色主题；工具调用/系统消息有独立角色标识
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
  format: 'markdown',  // json | jsonl | markdown | html | txt
  outputPath: './session.md',
  includeMetadata: true,
  includeTimestamps: true,
  sanitize: true,
  last: 50,            // 只导出最近 50 条（优先于 from/to）
  // from: 0, to: 99,  // 或按消息编号区间导出
  autoName: false      // 未指定 outputPath 时自动生成带时间戳文件名
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

# 只导出最近 50 条
/export-session --last 50

# 按编号区间导出
/export-session --from 10 --to 30

# 自动生成带时间戳的文件名，如 session-20260904-103000.md
/export-session --auto-name
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
| last | integer | 否 | 仅导出最近 N 条消息，优先于 from/to |
| from | integer | 否 | 起始消息编号（含），与 to 配合使用 |
| to | integer | 否 | 结束消息编号（含），与 from 配合使用 |
| autoName | boolean | 否 | 未指定输出路径时自动生成带时间戳的文件名，默认 false |

### 命令参数

| 参数 | 简写 | 说明 |
|------|------|------|
| --format, -f | 导出格式 |
| --output, -o | 输出文件路径 |
| --no-metadata | 不包含元数据信息 |
| --no-timestamps | 不包含时间戳 |
| --no-sanitize | 不清理敏感信息 |
| --last, -l | 仅导出最近 N 条消息 |
| --from | 起始消息编号（含） |
| --to | 结束消息编号（含） |
| --auto-name | 未指定输出路径时自动生成带时间戳的文件名 |

## 输出格式

### JSON
完整的结构化数据，包含所有会话信息。

### JSONL
每行一个 JSON 对象（元数据行 + 消息行），便于程序化处理和流式读取。

### Markdown
易读的 Markdown 格式，适合查看和编辑。

### HTML
带样式的 HTML 页面，适合浏览器查看，自动适配系统暗色主题。

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
- PEM 私钥块
- 键值形式的 API 密钥 / 密码 / 令牌
- OpenAI 风格密钥（sk-...）
- JWT 令牌
- 邮箱地址
- 电话号码

注意：导出内容上限 10MB，超出时请使用 `last` 或 `from/to` 缩小范围。

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