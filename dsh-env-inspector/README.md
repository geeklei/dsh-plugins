# dsh-env-inspector

环境信息探针插件（v0.1.0）：一条命令拿到版本、PATH 和环境变量，敏感值永不显示明文。

## 安装

```bash
npm install dsh-env-inspector
```

## 工具

### `inspect_env`

| 参数 | 类型 | 说明 |
|------|------|------|
| `scope` | string | `all`（默认）/ `versions` / `path` / `env` |
| `env_filter` | string | 可选，按子串过滤变量名（大小写不敏感） |
| `env_show_sensitive` | boolean | 默认 false；true 时列出敏感变量名（值仍掩码） |

**输出内容**：

- **versions**：平台/架构、主机名、Node、npm、git 版本（命令不可用时如实标注，不阻塞）
- **path**：PATH 目录逐项列出（Windows 按 `;`、Unix 按 `:` 分割）
- **env**：环境变量键值；敏感变量默认隐藏并提示数量

## 脱敏策略

变量名命中以下模式（不区分大小写）即视为敏感：`key`、`token`、`secret`、`password/passwd/pwd`、`credential`、`auth`、`cookie`、`session`、`signature`、`cert`。

- 默认：敏感变量整体隐藏，输出提示"另有 N 个敏感变量已隐藏"
- `env_show_sensitive=true`：显示变量名，值以掩码形式呈现（保留前 2 后 1 字符 + 长度标注，如 `sk***f(len=18)`），**任何情况下不显示明文**
- 设计原则：宁可多掩码（误报），绝不漏报

## 测试

```bash
npm test
```

覆盖 13 个敏感名识别、7 个不误报样本、掩码格式、明文不泄露、过滤、scope 校验等 40 项断言。

## Roadmap（v0.2 候选）

- 磁盘空间、内存、CPU 负载概览
- `which/where` 命令定位工具
- 代理环境变量专项检查（HTTP_PROXY 等，值掩码）
