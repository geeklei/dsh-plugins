# dsh-workspace-journal

工作区日志插件（v0.1.0）：让模型把阶段性结论、决策与复盘持久化到人类可读的 Markdown 日志，跨会话可查。与 `dsh-plugin-todo`（短期任务）、`dsh-session-exporter`（会话导出）形成完整的记忆工作流。

## 安装

```bash
npm install dsh-workspace-journal
```

## 工具

### `log_entry`

| 参数 | 类型 | 说明 |
|------|------|------|
| `body` | string | 必填，条目正文（≤2000 字符；记录结论而非流水账，长文请落盘正式文档） |
| `tags` | array | 可选标签（≤10 个，禁止 `,` `]` 字符） |

写入 `<cwd>/.journal/YYYY-MM.md`，格式：

```markdown
### 2026-09-13 14:30:05 [release,v0.1.0]
发布 v0.1.0 到 npm
```

按月分文件、纯 Markdown，**人类可直接查看与手改**——手改后的内容也能被工具读回（解析按 `### 时间戳` 块切分，空正文条目自动忽略，乱文本不崩溃）。

### `read_journal`

| 参数 | 类型 | 说明 |
|------|------|------|
| `since` / `until` | string | 日期/月份范围（`2026-09-01` 或 `2026-09`），until 含当天 |
| `tag` | string | 标签精确过滤 |
| `keyword` | string | 正文关键词过滤（大小写不敏感） |
| `limit` | number | 默认 20，上限 100 |

最新在前倒序返回；无过滤时查最近 12 个月。

## 典型工作流

- 阶段收尾时：`log_entry({ body: "结论……", tags: ["decision", "v0.2.0"] })`
- 新会话开工时：`read_journal({ tag: "decision", limit: 10 })` 快速恢复上下文
- 月末复盘：`read_journal({ since: "2026-09-01", keyword: "发布" })`

## 限制

- 存储 = 工作目录 `.journal/`；换目录即换日志（有意设计：日志跟随工作区）
- 单条正文 2000 字符上限（防流水账）；输入错误如实报错不静默
- 零 npm 依赖

## 测试

```bash
npm test
```

覆盖写入/读取/倒序、tag/关键词/日期范围过滤、跨月文件、limit 截断、解析健壮性（空正文忽略、损坏文件不崩溃）、参数校验等 23 项断言。

## Roadmap（v0.2 候选）

- 条目删除与编辑（带确认）
- `stats`：按标签统计条目分布
- 与 session-exporter 的会话摘要自动落日志
