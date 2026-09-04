# dsh-git-helper

安全优先的 Git 工具插件（dsh-git-helper v0.1.0）：只读的状态/差异/历史/分支查询，加上一个带三重防护的提交工具。

## 安装

```bash
npm install dsh-git-helper
```

## 工具列表

### `git_status`

查看工作区状态：当前分支、与上游的领先/落后、已暂存/未暂存/未跟踪/冲突文件分类列表。无参数。

### `git_diff`

查看差异，支持三种范围：

| 参数 | 类型 | 说明 |
|------|------|------|
| `scope` | string | `unstaged`（默认）/ `staged` / `commit` |
| `commit` | string | scope=commit 时必填，如 `"a1b2c3d"`、`"HEAD~1"` |
| `path` | string | 可选，限定文件或目录 |
| `context_lines` | number | 可选，上下文行数 0–10，默认 3 |

输出附带变更摘要（文件数/±行数）；超过 8000 字符自动截断并提示缩小范围。

### `git_log`

提交历史，格式 `短哈希 | 作者 | 日期 | 标题`。

| 参数 | 类型 | 说明 |
|------|------|------|
| `limit` | number | 1–50，默认 10 |
| `author` | string | 按作者过滤 |
| `since` | string | 如 `"2026-09-01"`、`"2 weeks ago"` |
| `oneline_only` | boolean | 默认 true；false 时附带变更文件统计 |

### `git_branch`

分支概览（只读）：当前分支标记、各分支最近提交、与上游的领先/落后。

| 参数 | 类型 | 说明 |
|------|------|------|
| `include_remote` | boolean | 默认 false |

### `git_commit`

受控提交，三重防护：

1. **前置校验**：暂存区为空且未指定暂存方式时拒绝提交并列出可提交文件；存在合并冲突时拒绝。
2. **提交信息规范**：非空、首行 ≤72 字符，详细说明放到空行后的正文。
3. **后置确认**：返回提交哈希 + 变更统计。

| 参数 | 类型 | 说明 |
|------|------|------|
| `message` | string | 必填 |
| `files` | string[] | 可选，指定要提交的文件（先 add 再提交） |
| `add_all` | boolean | 默认 false；true 时 `git add -A` |

## 安全边界

本插件**不提供** push、branch 删除、rebase/merge、checkout 丢弃改动、stash、amend 等破坏性操作。git 命令通过 `execFile` 调用（无 shell 注入面），超时 15 秒。

## 测试

```bash
npm test
```

测试在临时 git 仓库中运行，覆盖状态识别、差异截断、历史过滤、提交防护与正常路径、非仓库目录报错，共 28 项断言。

## Roadmap（v0.2 候选）

- `git_blame`：行级追溯
- `git_stash`：list / pop（受控）
- `git_restore`：受控恢复（需二次确认设计）
- 提交信息规范化检查（Conventional Commits）
