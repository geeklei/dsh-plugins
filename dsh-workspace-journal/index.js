import { defineTool } from "@deepseek-ai/dsh-tools"
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs"
import { resolve } from "node:path"

export const name = "workspace-journal"
export const inject = ["tools"]

// ---------------------------------------------------------------------------
// 配置与存储
// ---------------------------------------------------------------------------
const JOURNAL_DIR = ".journal"
const MAX_ENTRY_CHARS = 2000 // 单条正文上限
const MAX_LIST = 100 // 单次读取条数上限
const OUTPUT_LIMIT = 8000

/** 月度文件：<cwd>/.journal/YYYY-MM.md，人类可读 Markdown */
function monthFile(date) {
  const ym = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
  return resolve(process.cwd(), JOURNAL_DIR, `${ym}.md`)
}

function ensureDir() {
  mkdirSync(resolve(process.cwd(), JOURNAL_DIR), { recursive: true })
}

/**
 * 条目格式（人类可读，也方便逐块解析）：
 * ### 2026-09-13 14:30:05 [tag1,tag2]
 * 正文（可多行）
 */
function localStamp(d) {
  const p = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 解析一个月度文件中的全部条目 */
export function parseEntries(file) {
  if (!existsSync(file)) return []
  const text = readFileSync(file, "utf8")
  const entries = []
  const lines = text.split("\n")
  let current = null
  for (const line of lines) {
    const m = line.match(/^### (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?: \[([^\]]*)\])?\s*$/)
    if (m) {
      if (current) entries.push(current)
      current = {
        timestamp: m[1],
        tags: m[2] ? m[2].split(",").map((t) => t.trim()).filter(Boolean) : [],
        body: [],
      }
    } else if (current) {
      current.body.push(line)
    }
  }
  if (current) entries.push(current)
  return entries
    .map((e) => ({ ...e, body: e.body.join("\n").replace(/\n+$/, "") }))
    .filter((e) => e.body !== "")
}

function truncateOut(text) {
  if (text.length <= OUTPUT_LIMIT) return text
  return text.slice(0, OUTPUT_LIMIT) + `\n\n[输出已截断，完整长度 ${text.length} 字符。建议缩小时间范围或加 tag 过滤]`
}

// ---------------------------------------------------------------------------
// 工具注册
// ---------------------------------------------------------------------------
export function apply(ctx) {
  // 1. log_entry -------------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: "log_entry",
      description:
        "向工作区日志追加一条带时间戳与标签的记录，写入 .journal/YYYY-MM.md（Markdown，人类可读可手改）。适合记录阶段性结论、决策与复盘，避免长期上下文丢失。",
      parameters: {
        body: {
          type: "string",
          description: "条目正文（简洁陈述结论/决策，上限 2000 字符）",
          required: true,
        },
        tags: {
          type: "array",
          description: "可选，标签列表（如 [\"release\", \"v0.1.0\"]）",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        const body = String(args.body ?? "").trim()
        if (!body) throw new Error("body 不能为空。日志条目应记录结论或决策，而非空内容。")
        if (body.length > MAX_ENTRY_CHARS) {
          throw new Error(`正文过长（${body.length} 字符，上限 ${MAX_ENTRY_CHARS}）。日志记录结论，长文请落盘为正式文档。`)
        }
        const tags = (Array.isArray(args.tags) ? args.tags : [])
          .map((t) => String(t).trim())
          .filter((t) => t !== "" && !t.includes(",") && !t.includes("]"))
        if (tags.length > 10) throw new Error("标签最多 10 个。")

        ensureDir()
        const now = new Date()
        const file = monthFile(now)
        const entry = `### ${localStamp(now)}${tags.length > 0 ? ` [${tags.join(",")}]` : ""}\n${body}\n`
        appendFileSync(file, entry, "utf8")
        return `已记录到 ${file}:\n${entry.trim()}`
      },
    })
  )

  // 2. read_journal ----------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: "read_journal",
      description:
        "读取工作区日志：支持按时间范围（如 2026-09-01 / 2026-09-01~2026-09-13）、标签、关键词过滤，倒序（最新在前）返回。无过滤时返回最近 limit 条。",
      parameters: {
        since: {
          type: "string",
          description: "可选，起始日期（YYYY-MM-DD 或 YYYY-MM）",
        },
        until: {
          type: "string",
          description: "可选，结束日期（同上格式，含当天）",
        },
        tag: {
          type: "string",
          description: "可选，按标签过滤（精确匹配）",
        },
        keyword: {
          type: "string",
          description: "可选，按正文关键词过滤（大小写不敏感）",
        },
        limit: {
          type: "number",
          description: "可选，最多返回条数（默认 20，上限 100）",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        // 汇总范围内月份的文件
        const now = new Date()
        const months = []
        if (args.since || args.until) {
          const startM = args.since ? String(args.since).slice(0, 7) : String(args.until).slice(0, 7)
          const endM = args.until ? String(args.until).slice(0, 7) : startM
          let [sy, sm] = startM.split("-").map(Number)
          const [ey, em] = endM.split("-").map(Number)
          if (!sy || !sm || !ey || !em) throw new Error('日期格式应为 YYYY-MM-DD 或 YYYY-MM')
          while (sy < ey || (sy === ey && sm <= em)) {
            months.push(`${sy}-${String(sm).padStart(2, "0")}`)
            sm++
            if (sm > 12) { sm = 1; sy++ }
          }
          if (months.length > 120) throw new Error("时间跨度过大（超过 10 年）。")
        } else {
          // 最近 12 个月
          for (let i = 0; i < 12; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
            months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`)
          }
        }

        let entries = []
        for (const m of months) {
          entries.push(...parseEntries(resolve(process.cwd(), JOURNAL_DIR, `${m}.md`)))
        }

        // 日期过滤（字符串前缀比较即可）
        if (args.since) entries = entries.filter((e) => e.timestamp >= String(args.since))
        if (args.until) entries = entries.filter((e) => e.timestamp.slice(0, 10) <= String(args.until))
        if (args.tag) entries = entries.filter((e) => e.tags.includes(String(args.tag)))
        if (args.keyword) {
          const kw = String(args.keyword).toLowerCase()
          entries = entries.filter((e) => e.body.toLowerCase().includes(kw))
        }

        if (entries.length === 0) return "没有符合条件的日志条目。"

        // 倒序（最新在前），limit 截断
        entries.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
        const limit = Math.min(Math.max(Number(args.limit ?? 20), 1), MAX_LIST)
        const shown = entries.slice(0, limit)

        const lines = shown.map((e) => {
          const tagStr = e.tags.length > 0 ? ` [${e.tags.join(",")}]` : ""
          return `### ${e.timestamp}${tagStr}\n${e.body}`
        })
        const more = entries.length > shown.length ? `\n\n（共 ${entries.length} 条，仅显示最新 ${shown.length} 条，可用 limit 调整）` : ""
        return truncateOut(`共命中 ${entries.length} 条:\n\n` + lines.join("\n\n") + more)
      },
    })
  )
}
