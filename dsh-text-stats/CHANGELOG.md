# Changelog

本文件记录 `dsh-text-stats` 的版本变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.2.0] - 2026-09-02

npm: https://www.npmjs.com/package/dsh-text-stats/v/0.2.0

### 新增

- 工具新增可选 `mode` 参数：
  - `summary`（默认）：输出与 0.1.x 一致
  - `detailed`：字符构成细分（CJK / 非 ASCII / 空白符）+ 行数细分（非空 / 空行）
  - `json`：返回结构化对象 `{ chars, bytes, lines, nonEmptyLines, emptyLines, words, cjkChars, nonAsciiChars, whitespaceChars, estimatedTokens }`
  - 未知取值回退为 `summary`
- Token 估算改为 CJK 加权：CJK 统一表意文字 ~0.6 token/字、其他字符 ~0.25 token/字符，纯中文文本不再像旧的 `bytes / 4` 那样严重低估
- 超限拒绝理由附带当前长度与"分段传入"建议，便于模型自行重试
- `ctx.textStats` 新增 `deniedByChars` 细分计数；`recent` 历史条目新增 `chars` 字段

### 修复

- 统一口径统一为 Unicode 码点：输入门禁、`ctx.textStats.chars`、`recent[].chars` 原先用 UTF-16 长度计数，emoji 等增补平面字符会被双重计数（60k emoji 被误判为 120k 字符）
- CJK 判定收窄为统一表意文字（扩展 A / 主区块 / 兼容区）；全角拉丁字母、半角片假名、全角空格（U+3000）不再误判，空白判断优先于 CJK 判定
- `tools/result` 观察器对缺失 `error` 对象的失败结果做防御，不再抛 `TypeError`
- 移除不可达的词数门禁（0.1.x 的 `MAX_TEXT_WORDS = 200_000`）：词数 ≤ 字符数 ≤ 100k，该门禁永远无法触发，属于死代码
- CI：移除 package.json 中多余的 `"publish": "pnpm publish"` 生命周期脚本（npm publish 成功后触发会在 CI 的 detached HEAD 下失败，详见提交 `7d4f3fe`）

### 变更

- `isCjk` 从逐字符 `String.fromCodePoint` + 正则改为码点数值比较，消除大文本的额外开销
- 测试从 22 项断言扩充至 38 项（新增 mode / json / token 估算 / 码点口径 / 门禁信息等回归用例）

### 依赖

- 仍锁定 `@deepseek-ai/dsh-tools@0.1.1-rc.2`；注意其 schema 要求参数 `required` 出现时必须为 `true`，可选参数需省略该字段

## [0.1.2] - 2026-08-31

npm: https://www.npmjs.com/package/dsh-text-stats/v/0.1.2

### 修复

- 安全审计发现的多项漏洞修复（提交 `c0ec240`）
- 移除 `pnpm-lock.yaml`（提交 `81b6c25`）

## [0.1.1] - 2026-08-28

npm: https://www.npmjs.com/package/dsh-text-stats/v/0.1.1

### 新增

- 初始功能集：`text_stats` 工具统计字符（码点）、字节（UTF-8）、行数、词数并粗估 token（`bytes / 4`）
- `tools/pre-execute` 门禁：超 100k 字符 / 200k 词的输入直接 `deny`
- `tools/execute` 计时与 `tools/result` 观察器：`ctx.textStats` 暴露 `calls / denied / failed / chars / totalMs / recent`
- 22 项断言的钩子验证脚本 `verify-hooks.mjs`，接入 `prepack` / `prepublishOnly`

## [0.1.0] - 2026-08-28

npm: https://www.npmjs.com/package/dsh-text-stats/v/0.1.0

- 首次发布

[0.2.0]: https://github.com/geeklei/dsh-plugins/releases/tag/dsh-text-stats%400.2.0
