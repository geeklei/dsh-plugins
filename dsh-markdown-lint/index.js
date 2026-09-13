import { defineTool } from "@deepseek-ai/dsh-tools"
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs"
import { resolve, isAbsolute, sep, dirname } from "node:path"

export const name = "markdown-lint"
export const inject = ["tools"]

// ---------------------------------------------------------------------------
// 配置与基础设施
// ---------------------------------------------------------------------------
const MAX_FILE_CHARS = 1_000_000 // 1MB 输入上限
const OUTPUT_LIMIT = 8000

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
    throw new Error(`文件过大（${(content.length / 1024 / 1024).toFixed(1)}MB，上限 1MB）。`)
  }
  return { content, abs }
}

function getSource(args) {
  if (args.text != null && args.text !== "") {
    const t = String(args.text)
    if (t.length > MAX_FILE_CHARS) throw new Error(`文本过长（${t.length} 字符，上限 ${MAX_FILE_CHARS}）。`)
    return { content: t, abs: null }
  }
  if (args.file) return readTarget(args.file)
  throw new Error("请提供 text 或 file 之一。")
}

function truncateOut(text) {
  if (text.length <= OUTPUT_LIMIT) return text
  return text.slice(0, OUTPUT_LIMIT) + `\n\n[输出已截断，完整长度 ${text.length} 字符]`
}

// ---------------------------------------------------------------------------
// lint 规则（纯函数，便于测试与 fix 复用）
// ---------------------------------------------------------------------------

/** 跳过围栏代码块与行内代码影响，返回有效行标记数组 */
export function maskCodeBlocks(lines) {
  const masked = lines.map(() => false)
  let inFence = false
  let fenceChar = ""
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(`{3,}|~{3,})/)
    if (m) {
      if (!inFence) {
        inFence = true
        fenceChar = m[1][0]
        masked[i] = true // 围栏行本身也跳过
      } else if (m[1][0] === fenceChar) {
        inFence = false
        masked[i] = true
      }
      continue
    }
    masked[i] = inFence
  }
  return masked
}

/**
 * 规则 1：heading-hierarchy。
 * - 跳级（如 H1 后直接 H3）
 * - 多个 H1
 * 返回 issues: [{ line, rule, message }]
 */
export function checkHeadings(lines, masked) {
  const issues = []
  let prevLevel = 0
  let h1Count = 0
  for (let i = 0; i < lines.length; i++) {
    if (masked[i]) continue
    const m = lines[i].match(/^(#{1,6})\s+\S/)
    if (!m) continue
    const level = m[1].length
    if (level === 1) h1Count++
    if (prevLevel > 0 && level > prevLevel + 1) {
      issues.push({
        line: i + 1,
        rule: "heading-hierarchy",
        message: `标题跳级: H${prevLevel} 之后直接出现 H${level}（应为 H${prevLevel + 1}）`,
        fixable: true,
      })
    }
    prevLevel = level
  }
  if (h1Count > 1) {
    issues.push({
      line: 0,
      rule: "heading-hierarchy",
      message: `存在 ${h1Count} 个 H1 标题（约定全文唯一）`,
      fixable: false,
    })
  }
  return issues
}

/**
 * 规则 2：list-indent。
 * - 列表缩进使用 Tab
 * - 嵌套缩进步长不一致（同一文件混用 2 空格与 4 空格等）
 * 返回 issues 与规范化所需的步长信息。
 */
export function checkListIndent(lines, masked) {
  const issues = []
  const steps = new Map() // 缩进宽度 -> 出现次数（仅统计空格缩进的嵌套行）
  for (let i = 0; i < lines.length; i++) {
    if (masked[i]) continue
    const m = lines[i].match(/^(\t+|\s+)([-*+]|\d+[.)])\s/)
    if (!m) continue
    const indent = m[1]
    if (indent.includes("\t")) {
      issues.push({
        line: i + 1,
        rule: "list-indent",
        message: "列表缩进使用了 Tab（应使用空格）",
        fixable: true,
      })
      continue
    }
    const width = indent.length
    if (width > 0) steps.set(width, (steps.get(width) || 0) + 1)
  }
  // 只出现一次的宽度可能是偶然，出现 ≥2 次的宽度中取最小者为“标准步长”
  const widths = [...steps.entries()].filter(([, c]) => c >= 2).map(([w]) => w).sort((a, b) => a - b)
  if (widths.length > 1) {
    // 多种主流宽度：报不一致
    for (let i = 0; i < lines.length; i++) {
      if (masked[i]) continue
      const m = lines[i].match(/^( +)([-*+]|\d+[.)])\s/)
      if (!m) continue
      if (m[1].length !== widths[0]) {
        issues.push({
          line: i + 1,
          rule: "list-indent",
          message: `嵌套缩进 ${m[1].length} 空格与主流 ${widths[0]} 空格不一致`,
          fixable: true,
        })
      }
    }
  }
  return issues
}

/**
 * 规则 3：link-exists。
 * 相对路径链接（[text](./x.md)、(../a/b.md)、(sub/x.md)）指向的文件必须存在。
 * http(s)/mailto/anchor 链接跳过（本版本不联网检查）。
 * baseDir: 相对路径的解析基准（file 模式为文件所在目录，text 模式为 cwd）
 */
export function checkLinks(lines, masked, baseDir) {
  const issues = []
  for (let i = 0; i < lines.length; i++) {
    if (masked[i]) continue
    const line = lines[i]
    // 行内链接与引用链接统一扫描 [text](target)
    const re = /\[[^\]]*\]\(([^)]+)\)/g
    let m
    while ((m = re.exec(line)) !== null) {
      const target = m[1].trim()
      if (target === "" || /^https?:\/\//i.test(target) || /^mailto:/i.test(target) || /^#/.test(target)) {
        continue
      }
      // 去掉锚点与标题后缀
      const filePart = target.split("#")[0]
      if (filePart === "") continue // 纯锚点
      const resolved = resolve(baseDir, filePart)
      if (!existsSync(resolved)) {
        issues.push({
          line: i + 1,
          rule: "link-exists",
          message: `相对链接目标不存在: ${target}（解析为 ${resolved}）`,
          fixable: false,
        })
      }
    }
  }
  return issues
}

/** 渲染 issues 为文本 */
function renderIssues(issues, sourceName) {
  if (issues.length === 0) {
    return `✅ ${sourceName} 未发现问题。`
  }
  const lines = issues.map(
    (it) => `${it.line > 0 ? `第 ${it.line} 行` : "文件级"} [${it.rule}]${it.fixable ? "（可自动修复）" : ""}: ${it.message}`
  )
  const autoFix = issues.filter((it) => it.fixable).length
  return (
    `❌ ${sourceName} 发现 ${issues.length} 个问题` +
    (autoFix > 0 ? `（其中 ${autoFix} 个可用 fix_markdown 自动修复）` : "") +
    `:\n` +
    lines.join("\n")
  )
}

/** 应用自动修复：标题跳级降级、Tab 缩进转空格、嵌套宽度统一 */
export function autoFix(lines, masked) {
  const fixes = []
  // 1. 标题跳级
  let prevLevel = 0
  for (let i = 0; i < lines.length; i++) {
    if (masked[i]) continue
    const m = lines[i].match(/^(#{1,6})(\s+\S.*)$/)
    if (!m) continue
    const level = m[1].length
    if (prevLevel > 0 && level > prevLevel + 1) {
      lines[i] = "#".repeat(prevLevel + 1) + m[2]
      fixes.push({ line: i + 1, message: `标题从 H${level} 降为 H${prevLevel + 1}` })
      prevLevel = prevLevel + 1
      continue
    }
    prevLevel = level
  }
  // 2. Tab 缩进 → 4 空格
  for (let i = 0; i < lines.length; i++) {
    if (masked[i]) continue
    const m = lines[i].match(/^(\t+)([-*+]|\d+[.)])\s/)
    if (m) {
      lines[i] = lines[i].replace(/^\t+/, "    ".repeat(m[1].length))
      fixes.push({ line: i + 1, message: "列表缩进 Tab 转为 4 空格" })
    }
  }
  // 3. 缩进宽度统一到主流步长
  const steps = new Map()
  for (let i = 0; i < lines.length; i++) {
    if (masked[i]) continue
    const m = lines[i].match(/^( +)([-*+]|\d+[.)])\s/)
    if (m && m[1].length > 0) steps.set(m[1].length, (steps.get(m[1].length) || 0) + 1)
  }
  const widths = [...steps.entries()].filter(([, c]) => c >= 2).map(([w]) => w).sort((a, b) => a - b)
  if (widths.length > 1) {
    const target = widths[0]
    for (let i = 0; i < lines.length; i++) {
      if (masked[i]) continue
      const m = lines[i].match(/^( +)((?:[-*+]|\d+[.)])\s.*)$/)
      if (m && m[1].length !== target) {
        lines[i] = " ".repeat(target) + m[2]
        fixes.push({ line: i + 1, message: `嵌套缩进统一为 ${target} 空格` })
      }
    }
  }
  return fixes
}

// ---------------------------------------------------------------------------
// 工具注册
// ---------------------------------------------------------------------------
export function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: "lint_markdown",
      description:
        "Markdown 检查（三类规则）：标题跳级与多 H1、列表缩进（Tab/嵌套步长不一致）、相对链接目标存在性（http 链接不联网检查）。代码块内容跳过。返回带行号的问题列表及可修复标注。",
      parameters: {
        text: { type: "string", description: "Markdown 文本（与 file 二选一）" },
        file: { type: "string", description: "工作目录内 Markdown 文件路径（相对链接以文件所在目录解析）" },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        const { content, abs } = getSource(args)
        const lines = content.split("\n")
        const masked = maskCodeBlocks(lines)
        const baseDir = abs ? dirname(abs) : resolve(process.cwd())
        const issues = [
          ...checkHeadings(lines, masked),
          ...checkListIndent(lines, masked),
          ...checkLinks(lines, masked, baseDir),
        ]
        return truncateOut(renderIssues(issues, abs ?? "(text)"))
      },
    })
  )

  ctx.tools.register(
    defineTool({
      name: "fix_markdown",
      description:
        "自动修复可修复问题：标题跳级（降级补齐）、列表 Tab 缩进转空格、嵌套步长统一。link-exists 与多 H1 不可自动修复。file 模式下加 write=true 直接覆盖写回文件；text 模式返回修复后的全文。",
      parameters: {
        text: { type: "string", description: "Markdown 文本（与 file 二选一）" },
        file: { type: "string", description: "工作目录内 Markdown 文件路径" },
        write: {
          type: "boolean",
          description: "可选，file 模式下是否写回文件（默认 false 仅预览）",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        const { content, abs } = getSource(args)
        const lines = content.split("\n")
        const masked = maskCodeBlocks(lines)
        const fixes = autoFix(lines, masked)
        const fixed = lines.join("\n")

        const head =
          fixes.length === 0
            ? "没有可自动修复的问题。"
            : `应用了 ${fixes.length} 处修复:\n` + fixes.map((f) => `  第 ${f.line} 行: ${f.message}`).join("\n")

        // 残余问题提示
        const newMasked = maskCodeBlocks(fixed.split("\n"))
        const remaining = [
          ...checkHeadings(fixed.split("\n"), newMasked),
          ...checkListIndent(fixed.split("\n"), newMasked),
        ].filter((it) => !it.fixable)

        let tail = ""
        if (abs && args.write === true) {
          writeFileSync(abs, fixed, "utf8")
          tail = `\n\n已写回文件: ${abs}`
        }

        if (!abs || args.write !== true) {
          return truncateOut(head + (fixes.length > 0 ? "\n\n--- 修复后全文 ---\n" + fixed : "") + tail)
        }
        return truncateOut(head + tail + (remaining.length > 0 ? `\n\n仍需人工处理 ${remaining.length} 个问题（多 H1/链接不存在），可用 lint_markdown 查看。` : ""))
      },
    })
  )
}
