import { defineTool } from "@deepseek-ai/dsh-tools"
import { parse as csvParse } from "csv-parse/sync"
import { readFileSync, existsSync, statSync } from "node:fs"
import { resolve, isAbsolute, sep } from "node:path"

export const name = "csv-explorer"
export const inject = ["tools"]

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------
const MAX_FILE_CHARS = 2 * 1024 * 1024 // 2MB 输入上限
const MAX_ROWS = 50_000 // 最多解析行数
const OUTPUT_LIMIT = 8000
const DEFAULT_PREVIEW_ROWS = 5

function safePath(p) {
  if (!p || typeof p !== "string") throw new Error("path 参数必须是字符串")
  const abs = isAbsolute(p) ? resolve(p) : resolve(process.cwd(), p)
  const root = resolve(process.cwd())
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`拒绝访问：路径 "${p}" 在工作目录之外。`)
  }
  return abs
}

function readTarget(p) {
  const abs = safePath(p)
  if (!existsSync(abs)) throw new Error(`文件不存在: ${abs}`)
  const st = statSync(abs)
  if (!st.isFile()) throw new Error(`目标不是普通文件: ${abs}`)
  const content = readFileSync(abs, "utf8")
  if (content.length > MAX_FILE_CHARS) {
    throw new Error(`文件过大（${(content.length / 1024 / 1024).toFixed(1)}MB，上限 2MB）。`)
  }
  return content
}

function getSource(args) {
  if (args.text != null && args.text !== "") {
    const t = String(args.text)
    if (t.length > MAX_FILE_CHARS) throw new Error(`文本过长（${t.length} 字符，上限 ${MAX_FILE_CHARS}）。`)
    return t
  }
  if (args.file) return readTarget(args.file)
  throw new Error("请提供 text 或 file 之一。")
}

/** 分隔符嗅探：统计前几行 , ; \t | 出现次数，取众数且至少出现一次，否则逗号 */
export function sniffDelimiter(text) {
  const sample = text.split("\n").slice(0, 10).join("\n")
  const candidates = [",", ";", "\t", "|"]
  let best = ","
  let bestCount = 0
  for (const d of candidates) {
    // 简单计数（不处理引号内分隔符，嗅探足够）
    const count = sample.split(d).length - 1
    if (count > bestCount) {
      best = d
      bestCount = count
    }
  }
  return bestCount > 0 ? best : ","
}

/** 解析 CSV，返回 { headers, rows }（rows 为字符串二维数组，不含表头） */
export function parseCsv(text, delimiter) {
  const records = csvParse(text, {
    columns: false,
    skipEmptyLines: true,
    delimiter,
    relaxColumnCount: true, // 行列数不齐时不抛错，后面统一补齐
    trim: false,
  })
  if (records.length === 0) {
    throw new Error("CSV 内容为空。")
  }
  const headers = records[0].map((h, i) => (h === "" || h == null ? `列${i + 1}` : String(h).trim()))
  const rows = records.slice(1, 1 + MAX_ROWS).map((r) => {
    // 补齐/截断到表头长度
    const row = r.map((c) => (c == null ? "" : String(c)))
    while (row.length < headers.length) row.push("")
    return row.slice(0, headers.length)
  })
  return { headers, rows, truncated: records.length - 1 > MAX_ROWS }
}

/** 数值判定：允许千分位、百分号、货币符号前后缀 */
export function toNumber(v) {
  if (v == null) return null
  let s = String(v).trim()
  if (s === "") return null
  s = s.replace(/,/g, "")
  const m = s.match(/^[-+]?[¥$€£]?\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*%?$/)
  if (!m) return null
  const n = Number(m[0].replace(/[¥$€£%\s]/g, ""))
  return Number.isFinite(n) ? n : null
}

/** 数值列统计 */
function columnStats(values) {
  const nums = values.map(toNumber).filter((n) => n !== null)
  if (nums.length === 0) return null
  const sorted = [...nums].sort((a, b) => a - b)
  const sum = nums.reduce((a, b) => a + b, 0)
  const mean = sum / nums.length
  const median =
    sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length
  return {
    count: nums.length,
    nonNumeric: values.length - nums.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean,
    median,
    std: Math.sqrt(variance),
    sum,
  }
}

function fmt(n) {
  if (Number.isInteger(n)) return String(n)
  return Number(n.toPrecision(6)).toString()
}

function truncateOut(text) {
  if (text.length <= OUTPUT_LIMIT) return text
  return text.slice(0, OUTPUT_LIMIT) + `\n\n[输出已截断，完整长度 ${text.length} 字符]`
}

// ---------------------------------------------------------------------------
// 工具注册
// ---------------------------------------------------------------------------
export function apply(ctx) {
  // 1. csv_preview -----------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: "csv_preview",
      description:
        "CSV 预览：自动嗅探分隔符（, ; \\t |），返回表头、总行数、前 N 行内容（表格形式）。带 BOM 与 CRLF 均可处理。不解析 Excel 二进制文件。",
      parameters: {
        rows: {
          type: "number",
          description: "可选，预览行数（默认 5，上限 50）",
        },
        text: { type: "string", description: "CSV 内容（与 file 二选一）" },
        file: { type: "string", description: "工作目录内 CSV 文件路径（与 file 二选一）" },
        delimiter: {
          type: "string",
          description: "可选，显式指定分隔符；缺省自动嗅探",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        const text = getSource(args).replace(/^\uFEFF/, "")
        const delimiter = args.delimiter || sniffDelimiter(text)
        const { headers, rows, truncated } = parseCsv(text, delimiter)
        const n = Math.min(Math.max(Number(args.rows ?? DEFAULT_PREVIEW_ROWS), 1), 50)

        const lines = []
        lines.push(
          `分隔符: ${JSON.stringify(delimiter)}${args.delimiter ? "（显式指定）" : "（自动嗅探）"}`
        )
        lines.push(`总行数: ${rows.length}${truncated ? `（数据行超过 ${MAX_ROWS}，仅统计前 ${MAX_ROWS} 行）` : ""}`)
        lines.push(`列数: ${headers.length}`)
        lines.push("")
        // Markdown 表格预览
        const shown = rows.slice(0, n)
        const esc = (s) => s.replace(/\|/g, "\\|").replace(/\n/g, "⏎")
        lines.push(`| ${headers.map(esc).join(" | ")} |`)
        lines.push(`| ${headers.map(() => "---").join(" | ")} |`)
        for (const row of shown) {
          lines.push(`| ${row.map(esc).join(" | ")} |`)
        }
        if (rows.length > shown.length) {
          lines.push(`\n（仅预览前 ${shown.length} 行，剩余 ${rows.length - shown.length} 行未显示）`)
        }
        return truncateOut(lines.join("\n"))
      },
    })
  )

  // 2. csv_stats -------------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: "csv_stats",
      description:
        "CSV 数值列统计：自动识别数值列（支持千分位/百分号/货币符号），输出每列 count/min/max/mean/median/std/sum 及非数值单元格数。columns 指定列名或下标，缺省统计全部数值列。",
      parameters: {
        columns: {
          type: "array",
          description: "可选，要统计的列（列名或 0 基下标字符串）；缺省统计全部数值列",
        },
        text: { type: "string", description: "CSV 内容（与 file 二选一）" },
        file: { type: "string", description: "工作目录内 CSV 文件路径（与 text 二选一）" },
        delimiter: {
          type: "string",
          description: "可选，显式指定分隔符；缺省自动嗅探",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        const text = getSource(args).replace(/^\uFEFF/, "")
        const delimiter = args.delimiter || sniffDelimiter(text)
        const { headers, rows } = parseCsv(text, delimiter)

        // 选列
        let colIdx = headers.map((_, i) => i)
        if (Array.isArray(args.columns) && args.columns.length > 0) {
          colIdx = []
          for (const c of args.columns) {
            const cs = String(c)
            const byIdx = /^\d+$/.test(cs) ? Number(cs) : -1
            const found = byIdx >= 0 && byIdx < headers.length ? byIdx : headers.findIndex((h) => h === cs)
            if (found === -1) {
              throw new Error(`列 "${c}" 不存在。可用列: ${headers.join(", ")}`)
            }
            colIdx.push(found)
          }
        }

        const out = [`行数: ${rows.length}，列数: ${headers.length}，分隔符: ${JSON.stringify(delimiter)}`]
        let numericCols = 0
        for (const i of colIdx) {
          const values = rows.map((r) => r[i])
          const stats = columnStats(values)
          if (!stats) {
            out.push(`\n[${i}] ${headers[i]}: 非数值列（跳过）`)
            continue
          }
          numericCols++
          out.push(
            [
              `\n[${i}] ${headers[i]}:`,
              `  count: ${stats.count}（非数值 ${stats.nonNumeric} 个）`,
              `  min: ${fmt(stats.min)}  max: ${fmt(stats.max)}`,
              `  mean: ${fmt(stats.mean)}  median: ${fmt(stats.median)}  std: ${fmt(stats.std)}`,
              `  sum: ${fmt(stats.sum)}`,
            ].join("\n")
          )
        }
        if (numericCols === 0) {
          out.push("\n未发现数值列。")
        }
        return truncateOut(out.join("\n"))
      },
    })
  )
}
