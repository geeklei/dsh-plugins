# dsh-plugin-todo

DeepSeek Harness (dsh) TODO 管理插件：让 Agent 像项目管理工具一样管理任务列表，用户通过自然语言即可新增、查询、完成和删除任务。

## 功能

| 工具 | 说明 |
|---|---|
| `todo_add` | 添加任务，指定内容与优先级（high / medium / low，默认 medium），返回任务 ID |
| `todo_list` | 列出任务，支持按优先级排序（`sort: "priority"`）或创建顺序（`sort: "created"`），支持过滤（`filter: "all" / "pending" / "done"`） |
| `todo_done` | 按任务 ID 标记完成；再次调用同一 ID 会切换回待办 |
| `todo_remove` | 按任务 ID 删除任务 |

工具间协作：`todo_add` 返回的 ID 可直接传给 `todo_done` / `todo_remove`；`todo_list` 输出中包含每条任务的 ID。

## 数据模型与持久化

任务数据持久化存储在**工作区（cwd）下的 `.todos.json`**：

```json
{
  "tasks": [
    {
      "id": 1,
      "content": "完成插件开发教程",
      "priority": "high",
      "done": false,
      "created": "2026-08-22T10:00:00Z"
    }
  ]
}
```

数据文件路径可通过 `ctx.settings` 配置 `todo.dataFile`（相对路径基于工作区解析），未配置时默认 `.todos.json`。文件损坏时工具返回错误提示并重置为空列表，不会静默丢数据。

## 安装

```bash
dsh plugin --profile web add dsh-plugin-todo
```

或本地开发调试：

```bash
cat > debug.patch.yml <<"EOF"
- insert:
    - id: todo
      name: "E:/dsh-plugins/dsh-plugin-todo/index.js"
EOF

pnpm dsh web --patch ./debug.patch.yml
```

## 使用示例

自然语言对话即可：

- 「帮我加一条高优先级任务：明天上午提交周报」→ 调用 `todo_add`
- 「看看我还有哪些没做完的，按优先级排一下」→ 调用 `todo_list`
- 「1 号任务做完了」→ 调用 `todo_done`（id=1）
- 「把那个低优先级的删掉」→ Agent 先 `todo_list` 查 ID，再 `todo_remove`

## 测试

```bash
pnpm test   # mock ctx 直接调用各工具 execute，覆盖添加/排序/过滤/完成/删除/持久化/异常分支
```
