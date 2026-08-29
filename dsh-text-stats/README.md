# dsh-text-stats

一个面向 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 的文本统计工具插件。

为模型提供 `text_stats` 工具：统计给定文本的字符数、字节数、行数、词数，并估算 token 用量。

## 统计口径与约束

`text_stats` 的统计规则：

- **字符数**：按 Unicode 码点（code point）计数（`[...text].length`），不是 UTF-16 单元数
- **字节数**：UTF-8 编码后的字节数（`Buffer.byteLength(text, "utf8")`）
- **行数**：按 `\n` 或 `\r\n` 分割；空文本为 0 行
- **词数**：`trim()` 后按空白符分割；空文本为 0 词
- **Token 估算**：`Math.ceil(字节数 / 4)`，只是粗略估算，不代表真实模型的分词结果

输入约束（由 `tools/pre-execute` 钩子强制）：

- 单个调用文本上限：100,000 字符（`MAX_TEXT_CHARS`）
- 单词数上限：200,000 词（`MAX_TEXT_WORDS`）
- 超限调用直接拒绝（`deny`），不会执行统计，模型会看到拒绝原因

观察约束（`tools/result` 钩子）：

- `ctx.textStats.recent` 最多保留最近 20 条结果（`RECENT_RESULTS`），超出后丢弃最旧的
- 计数器（`calls` / `denied` / `failed` / `chars` / `totalMs`）仅在插件存活期间累计，进程重启后归零

所有上限常量都定义在 `index.js` 顶部，可按需调整后重新打包。
## 本地开发

```bash
# 安装依赖
pnpm install

# 用绝对路径临时调试（name 指向本插件的入口文件）
cat > debug.patch.yml <<"EOF"
- insert:
    - id: text-stats
      name: "C:/absolute/path/to/dsh-text-stats/index.js"
EOF

# 启动 dsh Web 并加载插件，打开 http://127.0.0.1:3080
pnpm dsh web --patch ./debug.patch.yml
```

## 安装到 profile

先构建 tarball：

```bash
pnpm pack
```

然后把它安装到目标机器上的 dsh：

```bash
dsh plugin --profile web add ./dsh-text-stats-0.1.0.tgz
```

验证配置是否生效：

```bash
dsh plugin --profile web --dump-config
```

卸载：

```bash
dsh plugin --profile web remove dsh-text-stats
```

## 发布到 npm（pnpm）

```bash
# 首次先登录（凭据保存在用户级 .npmrc，不会进包）
pnpm login --registry=https://registry.npmjs.org

# 确认登录
pnpm whoami

# 发布（自动触发 prepublishOnly / prepack 测试）
pnpm publish
```

发布后，任何用户都可以通过 `dsh plugin --profile web add dsh-text-stats` 安装。

发布相关配置：

- `publishConfig`（package.json）：`access: public`（公开包）、`registry`（官方源）、`tag: latest`（默认 dist-tag）
- `.npmrc`（项目级，仅本地生效，不会被打包）：固定 `registry=https://registry.npmjs.org/`
- `files`（package.json）：白名单，tarball 只包含 `index.js`、`cordis.patch.yml`、`README.md`、`package.json`
- CI 场景可在环境变量注入 `NPM_TOKEN`（对应 `//registry.npmjs.org/:_authToken`），本地推荐 `pnpm login`
## 插件结构说明

- `index.js`：插件入口，导出 `name` / `inject` / `apply(ctx)`，通过 `ctx.tools.register(defineTool(...))` 注册工具。
- `cordis.patch.yml`：Bundle 的 patch 声明，把插件 `insert` 到运行时的 profile 中。
- `package.json` 中的 `dsh.bundle.patch` 字段：告诉 dsh 该包使用哪个 patch 文件。

## 常见坑

- 插件名 `name` 必须全局唯一，安装后会被记录在 profile 配置里。
- `inject` 声明依赖的服务（这里是 `tools`），不声明会拿不到 `ctx.tools`。
- dsh 仍处于开发者预览阶段，API 可能随版本变化，注意锁定 `@deepseek-ai/dsh-tools` 的版本。

## 常用钩子

插件通过 Cordis 事件系统注册了以下常用钩子：

| 事件 | 模式 | 作用 |
| --- | --- | --- |
| `ready` / `dispose` | 生命周期 | 插件启动 / 卸载时记录日志 |
| `tools/pre-execute` | waterfall | 审计每次工具调用；对超大的 `text_stats` 输入直接 `deny`（100k 字符 / 200k 词上限），防止资源滥用 |
| `tools/execute` | waterfall | 为 `text_stats` 计时（metrics 模式），累计耗时写入 `ctx.textStats.totalMs` |
| `tools/result` | emit | 观察冻结的最终结果：累计调用数 / 失败数 / 字符数，并保留最近 20 条结果历史 |

钩子产生的统计可通过 `ctx.textStats` 读取：

```js
{
  calls: 12,     // 观察到的总调用数
  denied: 1,     // 被 pre-execute 拒绝的次数
  failed: 0,     // 执行失败次数
  chars: 3456,   // 成功处理 text_stats 的累计字符数
  totalMs: 8.2,  // text_stats 累计执行耗时（毫秒）
  recent: [...], // 最近 20 条结果（name / agent / at / ok / summary）
}
```

限制常量（`MAX_TEXT_CHARS` / `MAX_TEXT_WORDS` / `RECENT_RESULTS`）定义在 `index.js` 顶部，可按需调整。
## npm 生命周期钩子

`package.json` 中配置了常用 npm 钩子（scripts）：

- `test`：执行 `node verify-hooks.mjs`，22 项断言覆盖门禁、计时、结果观察与工具本体
- `prepack`：`pnpm pack` / `npm publish` 打包前自动运行 `npm test`
- `prepublishOnly`：`npm publish` 发布前自动运行 `npm test`

这样任何一次打包或发布都会先验证插件钩子，失败即中止。