import { defineTool } from "@deepseek-ai/dsh-tools"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

export const name = "code-check"
export const inject = ["tools"]

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))
const FALLBACK_CONFIG = join(PLUGIN_DIR, "eslint.fallback.config.mjs")
const WORK_ROOT = resolve(process.cwd())
const canonicalRoot = realpath(WORK_ROOT)

// ---------------------------------------------------------------------------
// 规则 -> 修复建议知识库（常见 ESLint 规则）
// ---------------------------------------------------------------------------
const RULE_SUGGESTIONS = {
  "no-unused-vars": "删除未使用的变量，或以下划线开头表示有意忽略",
  "no-undef": "变量未定义，检查是否缺少 import、拼写错误或遗漏声明",
  "no-console": "正式代码避免保留 console 输出，改用日志库或删除",
  semi: "统一语句末尾分号风格，可用 `npx eslint --fix` 自动修复",
  quotes: "统一字符串引号风格，可用 `npx eslint --fix` 自动修复",
  indent: "缩进不一致，可用 `npx eslint --fix` 自动修复",
  eqeqeq: "使用 === / !== 代替 == / !=，避免隐式类型转换",
  "no-var": "使用 let / const 代替 var，避免变量提升与函数作用域陷阱",
  "prefer-const": "变量赋值后未再修改，建议改用 const",
  "no-multiple-empty-lines": "删除多余空行，保持代码紧凑",
  "no-trailing-spaces": "删除行尾空白字符",
  "no-debugger": "移除 debugger 语句，避免遗留到生产环境",
  curly: "控制语句统一加大括号，避免悬挂 else 等问题",
  "no-duplicate-imports": "合并同一模块的多次 import",
  "no-empty": "空语句块需要补充实现或注释说明意图",
  "no-unreachable": "存在不可达代码，检查 return/throw 后的语句",
}

const LANGUAGE_EXT = {
  javascript: "js",
  js: "js",
  typescript: "ts",
  ts: "ts",
  json: "json",
  css: "css",
  html: "html",
  markdown: "md",
  md: "md",
  vue: "vue",
}

// ---------------------------------------------------------------------------
// 步骤 0：输入定位与安全校验（路径必须限制在 dsh 工作目录内）
// ---------------------------------------------------------------------------
async function resolveInsideRoot(value) {
  if (!value || /[\0]/u.test(value)) {
    throw new Error("路径不能为空")
  }
  const target = resolve(WORK_ROOT, value)
  const rel = relative(WORK_ROOT, target)
  if (rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error("路径必须位于 dsh 当前工作目录内")
  }
  const info = await stat(target)
  if (!info.isFile()) {
    throw new Error("目标不是普通文件（本工具审查单个文件）")
  }
  const actual = await realpath(target)
  const relActual = relative(await canonicalRoot, actual)
  if (relActual === ".." || relActual.startsWith(`..${sep}`)) {
    throw new Error("路径不能通过符号链接离开 dsh 当前工作目录")
  }
  return target
}

// ---------------------------------------------------------------------------
// 步骤 1：调用外部命令行工具（子进程执行 ESLint）
// ---------------------------------------------------------------------------
function run(command, args, options) {
  return new Promise((resolveRun) => {
    execFile(
      command,
      args,
      { timeout: 90_000, maxBuffer: 32 * 1024 * 1024, ...options },
      (error, stdout, stderr) => {
        resolveRun({
          code: typeof error?.code === "number" ? error.code : 0,
          stdout,
          stderr,
          spawnError: error && typeof error.code !== "number" ? String(error) : null,
        })
      }
    )
  })
}

async function runEslint(target, { fix = false, cwd = WORK_ROOT } = {}) {
  const eslintBin = join(PLUGIN_DIR, "node_modules", "eslint", "bin", "eslint.js")
  const baseArgs = [eslintBin, target, "-f", "json", "--no-warn-ignored"]

  // fix 模式：先执行 --fix 自动修复，再做正式检查（-1 表示已执行过修复）
  let fixedCount = 0
  if (fix) {
    await run(process.execPath, [...baseArgs, "--fix"], { cwd })
    fixedCount = -1
  }

  let result = await run(process.execPath, baseArgs, { cwd })
  let configSource = "项目配置"

  // 目标项目没有 ESLint 配置时，退回插件自带的兜底配置
  const noConfig =
    result.code >= 2 && /couldn't find (an? )?(eslint\.config|configuration)/iu.test(result.stderr)
  if (noConfig || /no configuration file/iu.test(result.stderr)) {
    result = await run(process.execPath, [...baseArgs, "--config", FALLBACK_CONFIG], { cwd })
    configSource = "内置通用配置（目标项目未提供 ESLint 配置）"
  }

  if (result.spawnError) {
    throw new Error(`无法启动 ESLint：${result.spawnError}`)
  }
  if (result.code >= 2) {
    throw new Error(`ESLint 执行失败：${result.stderr.trim().slice(0, 300)}`)
  }

  const parsed = JSON.parse(result.stdout || "[]")
  const fileResult = parsed[0] ?? { messages: [], errorCount: 0, warningCount: 0 }
  return {
    configSource,
    fixedCount,
    messages: (fileResult.messages ?? []).map((m) => ({
      line: m.line ?? 0,
      column: m.column ?? 0,
      severity: m.severity ?? 1, // 1=warning, 2=error
      ruleId: m.ruleId ?? "fatal",
      message: m.message ?? "",
      fixable: Boolean(m.fix),
    })),
    errorCount: fileResult.errorCount ?? 0,
    warningCount: fileResult.warningCount ?? 0,
  }
}

// ---------------------------------------------------------------------------
// 步骤 2：Prettier 格式检查（Node API）
// ---------------------------------------------------------------------------
function countChangedLines(original, formatted) {
  const a = original.split("\n")
  const b = formatted.split("\n")
  if (a.length > 1000 || b.length > 1000) return null // 大文件只报告布尔结果
  // 简化 LCS：动态规划求最长公共子序列
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const common = dp[0][0]
  return Math.max(a.length - common, b.length - common)
}

async function checkFormat(source, filepath) {
  try {
    const { default: prettier } = await import("prettier")
    const info = await prettier.getFileInfo(filepath)
    if (info.ignored || !info.inferredParser) return null // 不支持/忽略的文件类型
    const formatted = await prettier.format(source, { filepath })
    if (formatted === source) return { ok: true, changedLines: 0 }
    return { ok: false, changedLines: countChangedLines(source, formatted) }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 步骤 3：启发式静态检查（对所有语言通用的潜在问题）
// ---------------------------------------------------------------------------
function heuristicCheck(source) {
  const lines = source.split("\n")
  const issues = []
  const markers = []
  let longLines = 0
  let trailing = 0
  let tabs = 0
  let consoleCount = 0

  lines.forEach((line, index) => {
    const ln = index + 1
    const marker = line.match(/\b(TODO|FIXME|HACK|XXX)\b/u)
    if (marker) markers.push({ line: ln, tag: marker[1] })
    if (line.length > 120) longLines += 1
    if (/[ \t]+$/u.test(line)) trailing += 1
    if (/^\t/u.test(line)) tabs += 1
    if (/\bconsole\.(log|debug|info)\s*\(/u.test(line)) consoleCount += 1
    if (/\beval\s*\(/u.test(line)) {
      issues.push({
        line: ln,
        message: "使用 eval() 执行动态代码",
        suggestion: "eval 存在注入风险，改用 JSON.parse、switch 映射或模板方案",
      })
    }
  })

  for (const item of markers.slice(0, 5)) {
    issues.push({
      line: item.line,
      message: `遗留 ${item.tag} 标记`,
      suggestion: "清理前确认标记事项已完成，或将 TODO 迁移到 issue 跟踪系统",
    })
  }
  if (markers.length > 5) {
    issues.push({ line: 0, message: `另有 ${markers.length - 5} 处 TODO/FIXME 标记未列出`, suggestion: "全局搜索 TODO/FIXME 逐一清理" })
  }
  if (consoleCount > 0) {
    issues.push({ line: 0, message: `包含 ${consoleCount} 处 console 输出`, suggestion: "调试代码提交前应移除，或封装为可控的日志调用" })
  }
  if (longLines > 0) {
    issues.push({ line: 0, message: `${longLines} 行超过 120 字符`, suggestion: "拆分过长表达式，lambda/管道式调用适度换行" })
  }
  if (trailing > 0) {
    issues.push({ line: 0, message: `${trailing} 行存在行尾空白`, suggestion: "编辑器开启 trim trailing whitespace，或用 Prettier 统一处理" })
  }
  if (tabs > 0) {
    issues.push({ line: 0, message: `${tabs} 行使用 Tab 缩进`, suggestion: "与团队约定统一为空格缩进（本仓库约定 2 空格）" })
  }
  return issues
}

// ---------------------------------------------------------------------------
// 步骤 4：评分与结构化报告渲染
// ---------------------------------------------------------------------------
function gradeOf(score) {
  if (score >= 90) return "⭐ A"
  if (score >= 75) return "🟢 B"
  if (score >= 60) return "🟡 C"
  return "🔴 D"
}

export function renderReport(data) {
  const { target, meta, eslint, format, heuristics, fixedCount } = data
  const errors = eslint.messages.filter((m) => m.severity === 2)
  const warnings = eslint.messages.filter((m) => m.severity !== 2)
  const fixable = eslint.messages.filter((m) => m.fixable).length

  let score = 100
  score -= eslint.errorCount * 8
  score -= eslint.warningCount * 3
  if (format && !format.ok) score -= 6
  score -= heuristics.length
  score = Math.max(0, Math.round(score))

  const lines = []
  lines.push(`# 📋 代码审查报告`)
  lines.push("")
  lines.push(`**审查目标**: \`${target}\`（${meta.lineCount} 行，${(meta.bytes / 1024).toFixed(1)} KB）`)
  lines.push(`**整体评分**: ${gradeOf(score)}（${score}/100）`)
  if (fixedCount === -1) lines.push(`**自动修复**: 已先执行 \`eslint --fix\`，以下为修复后仍存在的问题`)
  lines.push("")
  lines.push("## 📊 问题概览")
  lines.push("")
  lines.push("| 类别 | 数量 |")
  lines.push("|---|---|")
  lines.push(`| ❌ ESLint 错误 | ${eslint.errorCount} |`)
  lines.push(`| ⚠️ ESLint 警告 | ${eslint.warningCount} |`)
  lines.push(`| 🔧 可自动修复 | ${fixable} |`)
  lines.push(`| 🎨 Prettier 格式 | ${format === null ? "不适用该文件类型" : format.ok ? "通过" : `需调整约 ${format.changedLines ?? "若干"} 行`} |`)
  lines.push(`| 💡 其他建议 | ${heuristics.length} |`)
  lines.push(`| 🛠 使用的配置 | ${eslint.configSource} |`)
  lines.push("")

  const formatIssue = (m, index) => {
    const tip = RULE_SUGGESTIONS[m.ruleId] ?? "参考该规则的官方文档获取修复指引"
    const pos = m.line ? `行 ${m.line}:${m.column}` : "文件级"
    return `${index}. **[${pos}] \`${m.ruleId}\`** ${m.message}\n   → 建议：${tip}${m.fixable ? "（`eslint --fix` 可自动修复）" : ""}`
  }

  if (errors.length > 0) {
    lines.push("## ❌ 必须修复（Error）")
    lines.push("")
    errors.forEach((m, i) => lines.push(formatIssue(m, i + 1)))
    lines.push("")
  }
  if (warnings.length > 0) {
    lines.push("## ⚠️ 建议改进（Warning）")
    lines.push("")
    warnings.forEach((m, i) => lines.push(formatIssue(m, i + 1)))
    lines.push("")
  }
  if (heuristics.length > 0) {
    lines.push("## 💡 风格与潜在问题")
    lines.push("")
    heuristics.forEach((h, i) => {
      const pos = h.line ? `行 ${h.line}` : "全局"
      lines.push(`${i + 1}. **[${pos}]** ${h.message}\n   → 建议：${h.suggestion}`)
    })
    lines.push("")
  }
  if (format && !format.ok) {
    lines.push("## 🎨 代码格式")
    lines.push("")
    lines.push(`Prettier 检查未通过（约 ${format.changedLines ?? "若干"} 行存在缩进、引号、分号等格式差异）。`)
    lines.push(`运行 \`npx prettier --write "${target}"\` 可一键修复。`)
    lines.push("")
  }

  lines.push("## 🔧 下一步行动")
  lines.push("")
  const allClean = eslint.errorCount === 0 && eslint.warningCount === 0 && heuristics.length === 0 && (!format || format.ok)
  if (allClean) {
    lines.push("- ✅ 未发现问题，代码质量良好，可以直接提交")
  } else {
    if (fixable > 0) lines.push(`- 使用 \`code_review\` 工具并设置 \`fix: true\`，或执行 \`npx eslint --fix\` 自动修复 ${fixable} 个问题`)
    if (format && !format.ok) lines.push(`- 执行 \`npx prettier --write "${target}"\` 统一格式`)
    if (errors.length > 0) lines.push("- 优先修复 ❌ 错误项，修复后重新审查，目标评分 A")
  }
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// 核心编排：读取 -> ESLint -> Prettier -> 启发式 -> 报告
// ---------------------------------------------------------------------------
export async function reviewCode({ path: rawPath, snippet, language, fix = false }) {
  if (!rawPath && !snippet) {
    throw new Error("请提供 path（文件路径）或 snippet（代码片段）其中之一")
  }

  let tempDir = null
  try {
    let filepath
    let displayName
    let lintCwd = WORK_ROOT
    if (snippet) {
      const ext = LANGUAGE_EXT[String(language ?? "javascript").toLowerCase()] ?? "js"
      tempDir = await mkdtemp(join(tmpdir(), "dsh-code-check-"))
      filepath = join(tempDir, `snippet.${ext}`)
      await writeFile(filepath, snippet, "utf8")
      displayName = `<代码片段 snippet.${ext}>`
      // 临时目录在工作区之外，必须把它作为 ESLint 的 cwd，否则文件会因不在配置匹配范围内被忽略
      lintCwd = tempDir
    } else {
      filepath = await resolveInsideRoot(rawPath)
      displayName = relative(WORK_ROOT, filepath)
    }

    const source = await readFile(filepath, "utf8")
    const meta = {
      lineCount: source.split("\n").length,
      bytes: Buffer.byteLength(source),
    }

    // ESLint 只处理 JS/TS 类文件，其他语言跳过 lint 阶段
    const lintable = /\.(mjs|cjs|js|jsx|ts|tsx)$/iu.test(filepath)
    const eslint = lintable
      ? await runEslint(filepath, { fix: Boolean(fix), cwd: lintCwd })
      : { configSource: "非 JS/TS 文件，跳过 ESLint", messages: [], errorCount: 0, warningCount: 0, fixedCount: 0 }

    const format = await checkFormat(source, filepath)
    const heuristics = heuristicCheck(source)

    return renderReport({
      target: displayName,
      meta,
      eslint,
      format,
      heuristics,
      fixedCount: eslint.fixedCount,
    })
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// dsh 工具注册
// ---------------------------------------------------------------------------
export function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: "code_review",
      description:
        "审查指定文件或代码片段：整合 ESLint 静态检查、Prettier 格式校验与启发式问题分析，输出结构化审查报告（问题列表 + 分级 + 修复建议）。",
      parameters: {
        path: {
          type: "string",
          required: false,
          description: "要审查的文件路径（相对 dsh 工作目录），与 snippet 二选一",
        },
        snippet: {
          type: "string",
          required: false,
          description: "要审查的代码片段文本，与 path 二选一",
        },
        language: {
          type: "string",
          required: false,
          description: "snippet 的语言类型：javascript/typescript/json/css/html/markdown 等（默认 javascript）",
        },
        fix: {
          type: "boolean",
          required: false,
          description: "为 true 时先执行 eslint --fix 自动修复，再输出修复后的审查报告（默认 false）",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        try {
          return await reviewCode(args)
        } catch (error) {
          return `❌ 审查失败：${error.message}`
        }
      },
    })
  )
}
