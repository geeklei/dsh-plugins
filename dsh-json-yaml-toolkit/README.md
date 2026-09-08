# dsh-json-yaml-toolkit

结构化数据工具箱（v0.1.0）：JSON/YAML/TOML 互转、点路径查询、JSON Schema 校验。

## 安装

```bash
npm install dsh-json-yaml-toolkit
```

## 工具

### `convert_format`

| 参数 | 类型 | 说明 |
|------|------|------|
| `to` | string | 必填，目标格式：`json` / `yaml` / `toml` |
| `text` | string | 源内容（与 `file` 二选一，优先） |
| `file` | string | 源文件路径（工作目录内） |
| `from` | string | 可选，源格式；缺省自动嗅探 |

TOML 对顶层嵌套数组/null 支持有限：转换时做**往返校验**，有信息损失会输出 ⚠ 警告。

### `query_json`

点路径查询，源格式自动嗅探（JSON/YAML/TOML）：

- `address.city` — 取字段
- `tags.0` — 数组下标
- `users[*].name` — 通配展开数组（支持嵌套，如 `a[*].b[*]` 扁平展开）
- 单值直接返回；多值编号列表；无匹配提示 0 项（查询语义不报错）

### `validate_schema`

| 参数 | 类型 | 说明 |
|------|------|------|
| `data` | string | 待校验数据（JSON/YAML/TOML 自动嗅探） |
| `schema` | string | JSON Schema（JSON 或 YAML 字符串） |

校验失败时列出全部错误路径与原因（ajv，allErrors 模式）。

## 安全与限制

- 文件路径必须在工作目录内
- 输入上限 1MB；输出超 10000 字符自动截断
- 依赖：`yaml`、`smol-toml`、`ajv`（均轻量、同步 API）

## 测试

```bash
npm test
```

覆盖三种格式互转往返、嗅探、点路径/通配/嵌套通配查询、schema 通过与失败措辞、路径越界拒绝等 26 项断言。

## Roadmap（v0.2 候选）

- JSONPath 完整语法（过滤器表达式）
- 数据比对（diff 两份结构化数据）
- CSV 支持
