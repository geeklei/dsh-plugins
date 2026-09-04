import { defineTool } from "@deepseek-ai/dsh-tools"
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"

export const name = "todo"
export const inject = ["tools"]

const PRIORITIES = ["high", "medium", "low"]
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 }

// ---------- 持久化配置（ctx.settings） ----------
function getSetting(ctx, key, fallback) {
  try {
    const settings = ctx.settings ?? ctx.config?.settings
    if (settings && typeof settings.get === "function") {
      const v = settings.get(key)
      if (v !== undefined && v !== null) return v
    }
  } catch {
    // settings 服务不可用时静默回退
  }
  return fallback
}

function getStorePath(ctx) {
  const file = getSetting(ctx, "todo.dataFile", ".todos.json")
  return resolve(process.cwd(), file)
}

// ---------- 数据读写 ----------
function load(ctx) {
  const path = getStorePath(ctx)
  if (!existsSync(path)) return { tasks: [] }
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"))
    if (!data || !Array.isArray(data.tasks)) return { tasks: [] }
    return data
  } catch (e) {
    return { tasks: [], error: `数据文件损坏，已重置：${e.message}` }
  }
}

function save(ctx, data) {
  const path = getStorePath(ctx)
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8")
}

function nextId(data) {
  return data.tasks.reduce((max, t) => Math.max(max, t.id), 0) + 1
}

function sortTasks(tasks, sortBy) {
  const sorted = [...tasks]
  if (sortBy === "priority") {
    sorted.sort(
      (a, b) =>
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        a.done - b.done ||
        a.id - b.id
    )
  } else if (sortBy === "created") {
    sorted.sort((a, b) => a.id - b.id)
  }
  return sorted
}

function renderTask(t, idx) {
  const flag = t.done ? "[x]" : "[ ]"
  return `${String(idx).padStart(2, " ")}. ${flag} #${t.id} [${t.priority}] ${t.content} (created: ${t.created})`
}

function summary(data) {
  const total = data.tasks.length
  const done = data.tasks.filter((t) => t.done).length
  return `共 ${total} 项任务，已完成 ${done}，待办 ${total - done}`
}

export function apply(ctx) {
  // todo_add：添加任务
  ctx.tools.register(
    defineTool({
      name: "todo_add",
      description:
        "添加一条 TODO 任务，返回任务 ID 等信息。返回的 id 可传给 todo_done / todo_remove 使用。",
      parameters: {
        content: { type: "string", required: true, description: "任务内容" },
        priority: {
          type: "string",
          description: "优先级：high / medium / low，默认 medium",
          enum: PRIORITIES,
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        try {
          const content = String(args.content || "").trim()
          if (!content) return "错误：任务内容不能为空"
          const priority = PRIORITIES.includes(args.priority)
            ? args.priority
            : "medium"
          const data = load(ctx)
          if (data.error) return `错误：${data.error}`
          const task = {
            id: nextId(data),
            content,
            priority,
            done: false,
            created: new Date().toISOString(),
          }
          data.tasks.push(task)
          save(ctx, data)
          return `已添加任务 #${task.id} [${priority}] ${content}\n${summary(data)}`
        } catch (e) {
          return `错误：${e.message}`
        }
      },
    })
  )

  // todo_list：列出任务
  ctx.tools.register(
    defineTool({
      name: "todo_list",
      description:
        "列出所有 TODO 任务，可按优先级或创建顺序排序，支持只看待办。",
      parameters: {
        sort: {
          type: "string",
          description: "排序方式：priority（按优先级）/ created（按创建顺序），默认 priority",
          enum: ["priority", "created"],
        },
        filter: {
          type: "string",
          description: "过滤：all / pending / done，默认 all",
          enum: ["all", "pending", "done"],
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        try {
          const data = load(ctx)
          if (data.error) return `错误：${data.error}`
          let tasks = data.tasks
          const filter = args.filter || "all"
          if (filter === "pending") tasks = tasks.filter((t) => !t.done)
          if (filter === "done") tasks = tasks.filter((t) => t.done)
          tasks = sortTasks(tasks, args.sort || "priority")
          if (tasks.length === 0) return `没有符合条件的任务。\n${summary(data)}`
          const lines = tasks.map((t, i) => renderTask(t, i + 1))
          return `TODO 列表：\n${lines.join("\n")}\n${summary(data)}`
        } catch (e) {
          return `错误：${e.message}`
        }
      },
    })
  )

  // todo_done：标记完成（再次调用可取消）
  ctx.tools.register(
    defineTool({
      name: "todo_done",
      description:
        "将指定 ID 的任务标记为完成。可使用 todo_list 返回的任务 ID。重复调用会切换回未完成状态。",
      parameters: {
        id: { type: "number", required: true, description: "任务 ID（来自 todo_list/todo_add）" },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        try {
          const data = load(ctx)
          if (data.error) return `错误：${data.error}`
          const task = data.tasks.find((t) => t.id === Number(args.id))
          if (!task) return `错误：找不到任务 #${args.id}`
          task.done = !task.done
          task.completed = task.done ? new Date().toISOString() : undefined
          save(ctx, data)
          return `任务 #${task.id} ${task.done ? "已完成" : "已恢复为待办"}：${task.content}\n${summary(data)}`
        } catch (e) {
          return `错误：${e.message}`
        }
      },
    })
  )

  // todo_remove：删除任务
  ctx.tools.register(
    defineTool({
      name: "todo_remove",
      description: "删除指定 ID 的 TODO 任务。可使用 todo_list 返回的任务 ID。",
      parameters: {
        id: { type: "number", required: true, description: "任务 ID" },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        try {
          const data = load(ctx)
          if (data.error) return `错误：${data.error}`
          const idx = data.tasks.findIndex((t) => t.id === Number(args.id))
          if (idx === -1) return `错误：找不到任务 #${args.id}`
          const [removed] = data.tasks.splice(idx, 1)
          save(ctx, data)
          return `已删除任务 #${removed.id}：${removed.content}\n${summary(data)}`
        } catch (e) {
          return `错误：${e.message}`
        }
      },
    })
  )
}
