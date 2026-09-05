# dsh-diff-writer

精确文件编辑插件（v0.1.0）：用 search/replace 补丁修改文件，避免整文件覆盖带来的误改风险。与 `dsh-file-manager-cli`（整体读写）和 `dsh-git-helper`（提交）形成互补的文件工作流。

## 安装

```bash
npm install dsh-diff-writer
```

## 工具

### `apply_patch`

对目标文件按顺序应用一组 search/replace 补丁。

| 参数 | 类型 | 说明 |
|------|------|------|
| `path` | string | 必填，目标文件（必须位于工作目录内） |
| `patches` | array | 必填，`{ search, replace, all? }` 列表，按顺序应用 |
| `create` | boolean | 可选，新建文件（此时 patches 可为空） |

**匹配规则**：

- `search` 必须与文件内容精确匹配（含缩进与换行）
- 默认只替换**唯一匹配处**；匹配 0 处或多处都会报错，多处在场时报错并提示匹配数量
- `all: true` 时全量替换所有匹配
- 空 `search` 不允许；空 `replace` 表示删除
- 任一补丁失败立即中止，**失败的补丁之前的修改已落盘**（不自动回滚），未执行的补丁不生效

**安全边界**：

- 所有路径必须在当前工作目录内，越界路径直接拒绝
- 文件大小上限 2MB
- 单次调用最多 20 个补丁
- `create=true` 不能用于已存在的文件

## 测试

```bash
npm test
```

覆盖唯一匹配替换、多处匹配防护、all 全量替换、多补丁顺序执行、失败中止、create 新建、路径越界拒绝等 16 项断言。

## Roadmap（v0.2 候选）

- 失败时全量回滚（先写临时文件再原子替换）
- 基于 diff 预览的确认模式
- 行号定位补丁（`{ startLine, endLine, replace }`）
