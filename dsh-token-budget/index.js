import { defineTool } from "@deepseek-ai/dsh-tools"
import { readFileSync, existsSync, statSync } from "node:fs"
import { resolve, isAbsolute, sep } from "node:path"

export const name = "token-budget"
export const inject = ["tools"]

// ---------------------------------------------------------------------------
// 估算口径与 dsh-text-stats 保持一致
// ---------------------------------------------------------------------------
const TOKENS_PER_CJK = 0.6 // CJK 字符约 0.6 token/字
const TOKENS_PER_OTHER = 0.25 // ASCII 密集文本约 4 字符/token
const MAX_INPUT_CHARS = 500_000 // 单次输入上限（50 万字符）
const MIN_BUDGET = 50 // 最小分块预算（token）
const MAX_BUDGET = 100_000 // 最大分块预算
const MAX_CHUNKS = 200 // 最多返回 200 块
const OUTPUT_LIMIT = 8000 // 输出截断阈值（字符）

function isCjk(codePoint) {
  return (
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff)
  )
}

/** 加权 token 估算（与 text-stats 同款） */
export function estimateTokens(text) {
  let tokens = 0
  for (const ch of text) {
    tokens += isCjk(ch.codePointAt(0)) ? TOKENS_PER_CJK : TOKENS_PER_OTHER
  }
  return Math.ceil(tokens)
}

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
  if (content.length > MAX_INPUT_CHARS) {
    throw new Error(`文本过长（${content.length} 字符，上限 ${MAX_INPUT_CHARS}）。`)
  }
  return content
}

function getSource(args) {
  if (args.text != null && args.text !== "") {
    const t = String(args.text)
    if (t.length > MAX_INPUT_CHARS) throw new Error(`文本过长（${t.length} 字符，上限 ${MAX_INPUT_CHARS}）。`)
    return t
  }
  if (args.file) return readTarget(args.file)
  throw new Error("请提供 text 或 file 之一。")
}

function truncateOut(text) {
  if (text.length <= OUTPUT_LIMIT) return text
  return text.slice(0, OUTPUT_LIMIT) + `\n\n[输出已截断，完整长度 ${text.length} 字符。建议减小 budget 或用 file 参数分块处理]`
}

/**
 * 按段落边界切块：优先在空行（段落）处切，段落仍超预算时退化为按行切，
 * 单行仍超预算时按句子（。！？.!?) 切，最后硬切。
 * 返回 [{ text, est }]，每块 est 不超过 budget（硬切保证）。
 */
export function splitByBudget(text, budget, overlap) {
  const paragraphs = text.split(/\n\s*\n/)
  const chunks = []
  let current = []
  let currentTokens = 0
  let lineBuf = []
  let lineTok = 0

  const flush = () => {
    if (current.length > 0) {
      const t = current.join("\n\n")
      chunks.push({ text: t, est: estimateTokens(t) })
      current = []
      currentTokens = 0
    }
  }

  for (const para of paragraphs) {
    const p = para.trim()
    if (p === "") continue
    const pTokens = estimateTokens(p)

    if (pTokens > budget) {
      // 段落本身超预算：按行再切
      flush()
      const lines = p.split("\n")
      for (const line of lines) {
        const lt = estimateTokens(line)
        if (lt > budget) {
          // 单行超预算：按句子切，句子仍超则硬切
          flushLineBuf()
          for (const piece of hardSplit(line, budget)) {
            chunks.push({ text: piece, est: estimateTokens(piece) })
          }
          continue
        }
        if (lineTok + lt > budget && lineBuf.length > 0) {
          flushLineBuf()
        }
        lineBuf.push(line)
        lineTok += lt
      }
      flushLineBuf()
      continue
    }

    if (currentTokens + pTokens > budget && current.length > 0) {
      flush()
    }
    current.push(p)
    currentTokens += pTokens
  }
  flush()
  return chunks

  function flushLineBuf() {
    if (lineBuf.length > 0) {
      const t = lineBuf.join("\n")
      chunks.push({ text: t, est: estimateTokens(t) })
      lineBuf = []
      lineTok = 0
    }
  }
  // lineBuf/lineTok 在函数顶层声明，供降级按行切分使用

  function* hardSplit(line, b) {
    // 按句子边界切，超预算句子退化为 hardSlice 硬切
    const sentences = line.split(/(?<=[。！？.!?)])\s*/)
    let buf = ""
    let bufTok = 0
    for (const s of sentences) {
      const st = estimateTokens(s)
      if (st > b) {
        if (buf) { yield buf; buf = ""; bufTok = 0 }
        yield* hardSlice(s, b)
        continue
      }
      if (bufTok + st > b && buf) {
        yield buf
        buf = ""
        bufTok = 0
      }
      buf += s
      bufTok += st
    }
    if (buf) yield buf
  }
}

// 硬切辅助：按估算 token 预算切字符串
function* hardSlice(s, budget) {
  let start = 0
  while (start < s.length) {
    let acc = 0
    let end = start
    for (let i = start; i < s.length; i++) {
      acc += isCjk(s.codePointAt(i)) ? TOKENS_PER_CJK : TOKENS_PER_OTHER
      end = i + 1
      // 留 1 token 头寸：避免浮点误差导致重估 ceil 超出预算
      if (acc >= budget - 1) break
    }
    if (end === start) break
    yield s.slice(start, end)
    start = end
  }
}

// ---------------------------------------------------------------------------
// Markdown 标题解析
// ---------------------------------------------------------------------------
/** 解析 markdown 标题结构：[{ level, title, start, end }]，行号从 0 计 */
export function parseHeadings(text) {
  const lines = text.split("\n")
  const headings = []
  let inCode = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*```/.test(line)) {
      inCode = !inCode
      continue
    }
    if (inCode) continue
    const m = line.match(/^(#{1,6})\s+(.*)$/)
    if (m) {
      headings.push({ level: m[1].length, title: m[2].trim(), line: i })
    }
  }
  return headings
}

/** 提取某个标题到下一个同级或更高级标题之间的内容 */
export function extractSection(text, headings, index) {
  const h = headings[index]
  const lines = text.split("\n")
  let end = lines.length
  for (let j = index + 1; j < headings.length; j++) {
    if (headings[j].level <= h.level) {
      end = headings[j].line
      break
    }
  }
  const body = lines.slice(h.line + 1, end).join("\n").trim()
  return { title: h.title, body, startLine: h.line + 1, endLine: end - 1 }
}

// ---------------------------------------------------------------------------
// 工具注册
// ---------------------------------------------------------------------------
export function apply(ctx) {
  // 1. count_tokens ----------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: "count_tokens",
      description:
        "估算文本 token 数（加权：CJK 约 0.6 token/字，ASCII 约 0.25/字符，口径与 dsh-text-stats 一致）。返回估算值、字符数与 CJK 占比。",
      parameters: {
        text: { type: "string", description: "待估算文本（与 file 二选一）" },
        file: { type: "string", description: "工作目录内文件路径（与 text 二选一）" },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        const text = getSource(args)
        const est = estimateTokens(text)
        const total = [...text].length
        const cjk = [...text].filter((ch) => isCjk(ch.codePointAt(0))).length
        const pct = total > 0 ? ((cjk / total) * 100).toFixed(1) : "0.0"
        return `估算 tokens: ${est}\n字符数: ${total}（CJK ${cjk} 个，占 ${pct}%）\n口径: CJK 0.6 token/字，其他 0.25/字符`
      },
    })
  )

  // 2. split_text ------------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: "split_text",
      description:
        "把长文本按 token 预算切块：优先按段落（空行）边界，段落超预算退化到按行、按句，最后硬切。返回分块列表（每块带估算 token 数）。配合 extract_section 可先抽章节再分块。",
      parameters: {
        budget: {
          type: "number",
          description: "每块 token 预算（200-100000，默认 3000）",
        },
        overlap: {
          type: "number",
          description: "预留参数，本版本忽略",
        },
        text: { type: "string", description: "待分块文本（与 file 二选一）" },
        file: { type: "string", description: "工作目录内文件路径（与 text 二选一）" },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        const text = getSource(args)
        const budget = Math.min(Math.max(Number(args.budget ?? 3000), MIN_BUDGET), MAX_BUDGET)
        const chunks = splitByBudget(text, budget)
        if (chunks.length > MAX_CHUNKS) {
          throw new Error(
            `按预算 ${budget} 切出 ${chunks.length} 块，超过单次上限 ${MAX_CHUNKS}。请调大 budget。`
          )
        }
        const head = `分块完成: 共 ${chunks.length} 块（预算 ${budget} token/块，估算口径 CJK 0.6/其他 0.25）\n`
        const lines = chunks.map((c, i) => {
          const preview = c.text.slice(0, 60).replace(/\n/g, "⏎")
          return `${i + 1}. [~${c.est} tokens] ${preview}${c.text.length > 60 ? "…" : ""}`
        })
        return head + lines.join("\n")
      },
    })
  )

  // 3. extract_section -------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: "extract_section",
      description:
        "从 Markdown 文档中按标题提取章节：返回该标题到下一个同级/更高级标题之间的内容（含 token 估算）。title 支持模糊匹配（包含即命中，取第一个）；不传 title 时列出全部标题目录。",
      parameters: {
        title: {
          type: "string",
          description: "标题文本（模糊包含匹配，大小写不敏感）",
        },
        level: {
          type: "number",
          description: "可选，限定标题级别（1-6），配合 title 精确化匹配",
        },
        text: { type: "string", description: "Markdown 文本（与 file 二选一）" },
        file: { type: "string", description: "工作目录内文件路径（与 text 二选一）" },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        const text = getSource(args)
        const headings = parseHeadings(text)
        if (headings.length === 0) {
          throw new Error("未找到任何 Markdown 标题（# ~ ######）。确认输入是 Markdown 且标题顶格书写。")
        }

        // 不带 title：返回目录
        if (!args.title) {
          const toc = headings.map((h) => `${"  ".repeat(h.level - 1)}- [H${h.level}] ${h.title}`)
          return `标题目录（共 ${headings.length} 个）:\n${truncateOut(toc.join("\n"))}`
        }

        const titleLower = String(args.title).toLowerCase()
        let idx = headings.findIndex(
          (h) =>
            h.title.toLowerCase().includes(titleLower) &&
            (args.level == null || h.level === Number(args.level))
        )
        if (idx === -1) {
          const titles = headings.map((h) => h.title).slice(0, 20).join(" | ")
          throw new Error(
            `未找到标题包含 "${args.title}"${args.level != null ? `（级别 ${args.level}）` : ""} 的章节。现有标题: ${titles}`
          )
        }

        const sec = extractSection(text, headings, idx)
        const est = estimateTokens(sec.body)
        return (
          `章节: ${sec.title}（H${headings[idx].level}，第 ${sec.startLine + 1}~${sec.endLine + 1} 行）\n` +
          `估算 tokens: ${est}\n` +
          `\n${truncateOut(sec.body || "（本章无正文内容）")}`
        )
      },
    })
  )
}
