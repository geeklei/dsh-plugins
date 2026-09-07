import { defineTool } from "@deepseek-ai/dsh-tools"
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"

export const name = "plugin-timer"
export const inject = ["tools"]

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------
const STORE_FILE = ".timers.json"
const MAX_TIMERS = 50 // 上限，防止无限膨胀
const MIN_DURATION_SEC = 1
const MAX_DURATION_SEC = 30 * 24 * 3600 // 30 天

// ---------------------------------------------------------------------------
// 持久化
// ---------------------------------------------------------------------------
function storePath() {
  return resolve(process.cwd(), STORE_FILE)
}

function loadTimers() {
  if (!existsSync(storePath())) return []
  try {
    const data = JSON.parse(readFileSync(storePath(), "utf8"))
    if (!Array.isArray(data)) return []
    return data.filter(
      (t) => t && typeof t.id === "string" && typeof t.dueAt === "number" && typeof t.label === "string"
    )
  } catch {
    // 文件损坏时不阻塞，返回空并视作无定时器
    return []
  }
}

function saveTimers(timers) {
  writeFileSync(storePath(), JSON.stringify(timers, null, 2), "utf8")
}

/**
 * 解析时长：数字（秒）或自然语言（如 "30s", "5m", "2h", "1d", "1h30m", "90"）。
 * 返回秒数，失败返回 null。
 */
export function parseDuration(input) {
  if (typeof input === "number" && Number.isFinite(input)) {
    return input > 0 ? input : null
  }
  if (typeof input !== "string") return null
  const s = input.trim().toLowerCase()
  if (s === "") return null
  // 纯数字按秒（必须为正）
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s)
    return n > 0 ? n : null
  }
  // 组合式：1h30m / 2d4h / 45s 等，允许单位乱序但每个单位至多一次
  const unitSec = { d: 86400, h: 3600, m: 60, s: 1 }
  // 先去空白再逐段解析，要求整体被完整覆盖（拒绝 "1x" 之类）
  const t = s.replace(/\s+/g, "")
  const re = /(\d+(?:\.\d+)?)([dhms])/g
  let total = 0
  const seen = new Set()
  let matchedLen = 0
  let m
  while ((m = re.exec(t)) !== null) {
    if (seen.has(m[2])) return null
    seen.add(m[2])
    total += Number(m[1]) * unitSec[m[2]]
    matchedLen += m[0].length
  }
  if (t.length !== matchedLen || total === 0) return null
  return total
}

function fmtRemaining(ms) {
  if (ms <= 0) return "已到期"
  const sec = Math.ceil(ms / 1000)
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const parts = []
  if (d) parts.push(`${d}天`)
  if (h) parts.push(`${h}小时`)
  if (m) parts.push(`${m}分`)
  if (s && !d) parts.push(`${s}秒`)
  return parts.join("") || "不到 1 秒"
}

// ---------------------------------------------------------------------------
// 工具注册
// ---------------------------------------------------------------------------
export function apply(ctx) {
  // 1. set_timer -------------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: "set_timer",
      description:
        '设置定时器。duration 支持："90"（秒）、"30s"、"5m"、"2h"、"1d"、"1h30m" 组合式；label 为到期提示内容。持久化到工作目录 .timers.json，跨会话可查。单机最多 50 个定时器。',
      parameters: {
        duration: {
          type: "string",
          description: '时长：秒数或自然语言（"30s"/"5m"/"2h"/"1d"/"1h30m"）',
          required: true,
        },
        label: {
          type: "string",
          description: "到期时的提示内容",
          required: true,
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        const sec = parseDuration(args.duration)
        if (sec === null) {
          throw new Error(`无法解析时长: "${args.duration}"。示例: "90"、"30s"、"5m"、"2h"、"1d"、"1h30m"。`)
        }
        if (sec < MIN_DURATION_SEC || sec > MAX_DURATION_SEC) {
          throw new Error(`时长超出范围（${MIN_DURATION_SEC}s ~ 30 天）: ${sec}s`)
        }
        const label = String(args.label ?? "").trim()
        if (!label) throw new Error("label 不能为空，请描述到期时要提醒的内容。")

        const timers = loadTimers()
        if (timers.length >= MAX_TIMERS) {
          throw new Error(`定时器已达上限（${MAX_TIMERS} 个），请先清理已到期或不需要的定时器。`)
        }

        const now = Date.now()
        const id = `t${now.toString(36)}${Math.floor(Math.random() * 1000).toString(36).padStart(2, "0")}`
        const timer = {
          id,
          label,
          dueAt: now + sec * 1000,
          createdAt: now,
        }
        timers.push(timer)
        saveTimers(timers)
        return (
          `定时器已设置:\n` +
          `  ID: ${id}\n` +
          `  提醒: ${label}\n` +
          `  到期: ${new Date(timer.dueAt).toLocaleString("zh-CN")}（约 ${fmtRemaining(sec * 1000)} 后）\n` +
          `提示: 使用 list_timers 查看到期情况。`
        )
      },
    })
  )

  // 2. list_timers -----------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: "list_timers",
      description:
        "查看定时器：默认只看待到期（剩余时间最短在前），include_done=true 时附带已到期项。返回结果中已到期项带【已到期】标记，应立即向用户转达提醒内容。",
      parameters: {
        include_done: {
          type: "boolean",
          description: "可选，是否包含已到期定时器（默认 false，只看待到期）",
        },
        limit: {
          type: "number",
          description: "可选，最多返回条数（默认 20，上限 50）",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        const timers = loadTimers()
        if (timers.length === 0) return "当前没有任何定时器。"

        const now = Date.now()
        const limit = Math.min(Math.max(Number(args.limit ?? 20), 1), 50)
        const pending = timers
          .filter((t) => t.dueAt > now)
          .sort((a, b) => a.dueAt - b.dueAt)
        const done = timers.filter((t) => t.dueAt <= now)

        const lines = []
        if (pending.length === 0 && done.length === 0) return "当前没有任何定时器。"

        if (pending.length > 0) {
          lines.push(`== 待到期 (${Math.min(pending.length, limit)}/${pending.length}) ==`)
          for (const t of pending.slice(0, limit)) {
            lines.push(`  ${t.id} | ${fmtRemaining(t.dueAt - now)} | 到期 ${new Date(t.dueAt).toLocaleString("zh-CN")} | ${t.label}`)
          }
        } else {
          lines.push("== 待到期 ==")
          lines.push("  （无）")
        }

        if (args.include_done && done.length > 0) {
          lines.push(`\n== 已到期 (${done.length}) ==`)
          for (const t of done.slice(0, limit)) {
            lines.push(`  【已到期】${t.id} | ${new Date(t.dueAt).toLocaleString("zh-CN")} | ${t.label}`)
          }
          lines.push(`\n提示: ${done.length} 个定时器已到期，可用 cancel_timer(all_done=true) 一次性清理。`)
        }

        if (done.length > 0 && !args.include_done) {
          lines.push(`\n[另有 ${done.length} 个已到期定时器未显示，传 include_done=true 查看]`)
        }
        return lines.join("\n")
      },
    })
  )

  // 3. cancel_timer ----------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: "cancel_timer",
      description: "取消定时器：按 id 取消单个；all_done=true 一次性清理全部已到期定时器。返回剩余数量。",
      parameters: {
        id: {
          type: "string",
          description: "要取消的定时器 ID（来自 list_timers）",
        },
        all_done: {
          type: "boolean",
          description: "可选，true 时清理全部已到期定时器（忽略 id）",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        const timers = loadTimers()
        const now = Date.now()

        if (args.all_done === true) {
          const kept = timers.filter((t) => t.dueAt > now)
          const removed = timers.length - kept.length
          saveTimers(kept)
          if (removed === 0) return "没有已到期的定时器需要清理。"
          return `已清理 ${removed} 个已到期定时器，剩余 ${kept.length} 个待到期。`
        }

        const id = String(args.id ?? "").trim()
        if (!id) throw new Error("请提供要取消的定时器 id，或设 all_done=true 清理全部已到期项。")
        const idx = timers.findIndex((t) => t.id === id)
        if (idx === -1) {
          throw new Error(`未找到定时器 "${id}"。可用 list_timers（include_done=true）查看所有 ID。`)
        }
        const removed = timers.splice(idx, 1)[0]
        saveTimers(timers)
        const wasDue = removed.dueAt <= now
        return `已取消定时器 ${id}（${wasDue ? "已到期" : "未到期"}）: ${removed.label}。剩余 ${timers.length} 个。`
      },
    })
  )
}
