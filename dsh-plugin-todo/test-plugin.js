// dsh-plugin-todo 测试脚本：mock ctx.tools.register，直接调用 execute 验证逻辑与持久化
import { apply, name, inject } from "./index.js"
import { mkdtempSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const dir = mkdtempSync(join(tmpdir(), "dsh-todo-test-"))
process.chdir(dir)

const registered = {}
const ctx = {
  tools: {
    register(tool) {
      registered[tool.name] = tool
    },
  },
  settings: {
    get(key) {
      if (key === "todo.dataFile") return join(dir, "test.todos.json")
      return undefined
    },
  },
}

apply(ctx)

const tools = Object.keys(registered)
console.log(`插件名: ${name}, inject: ${inject.join(",")}`)
console.log(`已注册工具: ${tools.join(", ")}`)

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`❌ ${msg}`)
    process.exitCode = 1
  } else {
    console.log(`✅ ${msg}`)
  }
}

assert(
  ["todo_add", "todo_list", "todo_done", "todo_remove"].every((t) => registered[t]),
  "四个工具均已注册"
)

const run = async (n, args) => registered[n].execute(args)

// 添加
let r = await run("todo_add", { content: "完成插件开发教程", priority: "high" })
assert(r.includes("#1") && r.includes("high"), "todo_add 返回任务 ID 和优先级")
await run("todo_add", { content: "测试天气插件", priority: "medium" })
await run("todo_add", { content: "低优先级任务", priority: "low" })
r = await run("todo_add", { content: "   " })
assert(r.startsWith("错误"), "空内容被拒绝")

// 列表：按优先级排序
r = await run("todo_list", {})
const idxHigh = r.indexOf("#1")
const idxLow = r.indexOf("#3")
assert(r.includes("[x]") === false && idxHigh < idxLow, "todo_list 按优先级排序")
assert(r.includes("共 3 项任务"), "统计摘要正确")

// 过滤
r = await run("todo_list", { filter: "done" })
assert(r.includes("没有符合条件的任务"), "filter=done 空列表提示")

// 完成
r = await run("todo_done", { id: 1 })
assert(r.includes("已完成"), "todo_done 标记完成")
r = await run("todo_done", { id: 1 })
assert(r.includes("已恢复为待办"), "todo_done 再次调用切换回待办")
r = await run("todo_done", { id: 999 })
assert(r.startsWith("错误"), "todo_done 不存在的 ID 报错")

// 持久化验证
const saved = JSON.parse(readFileSync(join(dir, "test.todos.json"), "utf-8"))
assert(saved.tasks.length === 3 && saved.tasks[0].created, ".todos.json 持久化且包含时间戳")

// 删除
r = await run("todo_remove", { id: 3 })
assert(r.includes("已删除任务 #3"), "todo_remove 删除任务")
r = await run("todo_remove", { id: 3 })
assert(r.startsWith("错误"), "todo_remove 重复删除报错")
r = await run("todo_list", {})
assert(r.includes("共 2 项任务"), "删除后统计正确")

try {
  rmSync(dir, { recursive: true, force: true })
} catch {
  // Windows 下临时目录可能被占用，忽略清理失败
}
console.log(process.exitCode ? "\n测试失败" : "\n全部测试通过")
