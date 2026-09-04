import { defineTool } from "@deepseek-ai/dsh-tools"
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

export const name = "git-helper"
export const inject = ["tools"]

// ---------------------------------------------------------------------------
// 通用配置
// ---------------------------------------------------------------------------
const GIT_TIMEOUT_MS = 15000
const MAX_BUFFER = 10 * 1024 * 1024
const DIFF_OUTPUT_LIMIT = 8000 // diff/log 输出截断阈值（字符）

// 工作根目录在调用时惰性解析：保证测试/宿主切换 cwd 后行为正确
function workRoot() {
  return resolve(process.cwd())
}

function isRepo() {
  return existsSync(resolve(workRoot(), ".git"))
}

// ---------------------------------------------------------------------------
// git 执行基础设施
// ---------------------------------------------------------------------------
class GitError extends Error {
  constructor(message, stderr, exitCode) {
    super(message)
    this.name = "GitError"
    this.stderr = stderr
    this.exitCode = exitCode
  }
}

/**
 * 统一的 git 命令执行入口。
 * 非零退出码时抛出 GitError，包含 stderr 与退出码。
 */
function runGit(args, { cwd = workRoot(), ignoreExitCode = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    execFile(
      "git",
      args,
      { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_BUFFER, windowsHide: true },
      (err, stdout, stderr) => {
        if (err && !ignoreExitCode) {
          const stderrText = (stderr || err.message || "").trim()
          const friendly = friendlyGitError(stderrText)
          reject(new GitError(friendly, stderrText, err.code))
          return
        }
        resolvePromise({ stdout: stdout ?? "", stderr: stderr ?? "" })
      }
    )
  })
}

/** 将常见 git 错误翻译为可读中文提示 */
function friendlyGitError(stderr) {
  if (/not a git repository/i.test(stderr)) {
    return "当前目录不是 Git 仓库（未找到 .git）。请先切换到仓库目录，或先执行 git init。"
  }
  if (/bad revision|unknown revision|ambiguous argument/i.test(stderr)) {
    return `无效的 git 修订表达式：${stderr}`
  }
  if (/failed to push|rejected/i.test(stderr)) {
    return `操作被拒绝：${stderr}`
  }
  return stderr || "git 命令执行失败"
}

/** 统一输出截断：超限时截断并附统计说明 */
function truncate(text, limit = DIFF_OUTPUT_LIMIT) {
  if (text.length <= limit) return text
  const totalLines = text.split("\n").length
  const kept = text.slice(0, limit)
  return (
    kept +
    `\n\n[输出已截断：完整输出共 ${totalLines} 行 / ${text.length} 字符。建议用 path 参数限定文件，或减小 context_lines / limit]`
  )
}

/** 解析 git status --porcelain=v1 -b 输出 */
function parseStatus(stdout) {
  const lines = stdout.split("\n").filter((l) => l.length > 0)
  const branchLine = lines[0] || ""
  const branchMatch = branchLine.match(/^##\s+([^.\s]+)(?:\.\.\.(\S+))?(?:\s+\[(.+)\])?/)
  const branch = branchMatch ? branchMatch[1] : "(unknown)"
  const upstream = branchMatch && branchMatch[2] ? branchMatch[2] : null
  const tracking = branchMatch && branchMatch[3] ? branchMatch[3] : ""

  const staged = []
  const unstaged = []
  const untracked = []
  const conflicted = []

  const STAGE_MAP = {
    M: "已修改",
    A: "新增",
    D: "已删除",
    R: "重命名",
    C: "复制",
    "?": "未跟踪",
  }

  for (const line of lines.slice(1)) {
    const x = line[0] // 暂存区状态
    const y = line[1] // 工作区状态
    const file = line.slice(3)
    if (x === "?" && y === "?") {
      untracked.push(file)
      continue
    }
    if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
      conflicted.push(file)
      continue
    }
    if (x !== " ") {
      staged.push(`${STAGE_MAP[x] || x}: ${file}`)
    }
    if (y !== " ") {
      unstaged.push(`${STAGE_MAP[y] || y}: ${file}`)
    }
  }

  return { branch, upstream, tracking, staged, unstaged, untracked, conflicted }
}

/** 渲染 status 为可读文本 */
function renderStatus(s) {
  const parts = []
  parts.push(`当前分支: ${s.branch}${s.upstream ? ` (上游: ${s.upstream}${s.tracking ? `, ${s.tracking}` : ""})` : ""}`)
  const section = (title, items) => {
    if (items.length === 0) return
    parts.push(`\n${title} (${items.length}):`)
    for (const it of items) parts.push(`  ${it}`)
  }
  section("已暂存", s.staged)
  section("未暂存的修改", s.unstaged)
  section("未跟踪文件", s.untracked)
  section("合并冲突", s.conflicted)
  if (
    s.staged.length === 0 &&
    s.unstaged.length === 0 &&
    s.untracked.length === 0 &&
    s.conflicted.length === 0
  ) {
    parts.push("\n工作区干净，没有待提交的变更。")
  }
  if (s.conflicted.length > 0) {
    parts.push("\n⚠ 存在合并冲突，请先解决冲突再提交。")
  }
  return parts.join("\n")
}

/** 解析 git diff --stat 输出中的文件数与增删行数 */
function parseStat(statText) {
  const m = statText.match(
    /\s(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/
  )
  if (!m) return null
  return {
    files: Number(m[1]),
    insertions: m[2] ? Number(m[2]) : 0,
    deletions: m[3] ? Number(m[3]) : 0,
  }
}

/** commit message 校验：非空、首行 ≤72 字符 */
function validateCommitMessage(message) {
  const trimmed = message.trim()
  if (!trimmed) return { ok: false, reason: "提交信息不能为空" }
  const firstLine = trimmed.split("\n")[0]
  if (firstLine.length > 72) {
    return {
      ok: false,
      reason: `提交信息首行过长（${firstLine.length} 字符，上限 72）。请把详细说明放到正文（空一行后），首行只保留简明摘要。`,
    }
  }
  return { ok: true, message: trimmed }
}

// ---------------------------------------------------------------------------
// 工具注册
// ---------------------------------------------------------------------------
export function apply(ctx) {
  // 1. git_status ------------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: "git_status",
      description:
        "查看 Git 工作区状态：当前分支、与上游的领先/落后、已暂存/未暂存/未跟踪/冲突文件分类列表。提交或查看差异前建议先调用。",
      parameters: {},
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute() {
        if (!isRepo()) throw new Error("当前目录不是 Git 仓库（未找到 .git）。")
        const { stdout } = await runGit(["status", "--porcelain=v1", "-b"])
        return renderStatus(parseStatus(stdout))
      },
    })
  )

  // 2. git_diff --------------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: "git_diff",
      description:
        "查看 Git 差异。scope=unstaged（工作区 vs 暂存区，默认）/ staged（暂存区 vs HEAD）/ commit（查看某次提交）。输出超长时自动截断并提示缩小范围。",
      parameters: {
        scope: {
          type: "string",
          description: '差异范围："unstaged"（默认）| "staged" | "commit"',
        },
        commit: {
          type: "string",
          description: 'scope=commit 时必填：提交哈希、分支名或 "HEAD~1" 等修订表达式',
        },
        path: {
          type: "string",
          description: "可选，限定查看的文件或目录路径",
        },
        context_lines: {
          type: "number",
          description: "可选，diff 上下文行数（0-10，默认 3）",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        if (!isRepo()) throw new Error("当前目录不是 Git 仓库（未找到 .git）。")
        const scope = args.scope || "unstaged"
        const contextLines = Math.min(Math.max(Number(args.context_lines ?? 3), 0), 10)
        if (scope === "commit" && !args.commit) {
          throw new Error('scope=commit 时必须提供 commit 参数（如 "a1b2c3d" 或 "HEAD~1"）。')
        }

        const baseArgs =
          scope === "staged"
            ? ["diff", "--cached", "--no-color", `-M`, `--unified=${contextLines}`]
            : scope === "commit"
              ? ["show", "--no-color", "-M", `--unified=${contextLines}`, "--format=", args.commit]
              : ["diff", "--no-color", "-M", `--unified=${contextLines}`]
        if (args.path) baseArgs.push("--", args.path)

        const { stdout, stderr } = await runGit(baseArgs)

        // 附带 --stat 摘要（show 的 --format= 已清空提交信息，stat 单独取）
        const statArgs =
          scope === "staged"
            ? ["diff", "--cached", "--stat", "-M"]
            : scope === "commit"
              ? ["show", "--stat", "-M", "--format=", args.commit]
              : ["diff", "--stat", "-M"]
        if (args.path) statArgs.push("--", args.path)
        let statSummary = ""
        try {
          const r = await runGit(statArgs)
          const s = parseStat(r.stdout)
          if (s) {
            statSummary = `变更摘要: ${s.files} 个文件, +${s.insertions} 行, -${s.deletions} 行\n`
          }
        } catch {
          // stat 失败不阻塞主输出
        }

        const header = scope === "commit" ? `提交 ${args.commit} 的差异:\n` : ""
        if (!stdout.trim()) {
          return header + statSummary + "没有差异内容。"
        }
        return header + statSummary + truncate(stdout)
      },
    })
  )

  // 3. git_log ---------------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: "git_log",
      description:
        "查看提交历史：短哈希 | 作者 | 日期 | 标题。支持限制条数、按作者过滤、按时间过滤。",
      parameters: {
        limit: {
          type: "number",
          description: "可选，返回条数（1-50，默认 10）",
        },
        author: {
          type: "string",
          description: "可选，按作者（姓名或邮箱）过滤",
        },
        since: {
          type: "string",
          description: '可选，起始时间，如 "2026-09-01" 或 "2 weeks ago"',
        },
        oneline_only: {
          type: "boolean",
          description: "可选，仅显示摘要行（默认 true；false 时附带变更文件统计）",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        if (!isRepo()) throw new Error("当前目录不是 Git 仓库（未找到 .git）。")
        const limit = Math.min(Math.max(Number(args.limit ?? 10), 1), 50)
        const logArgs = [
          "log",
          `--max-count=${limit}`,
          "--date=iso-local",
          "--pretty=format:%h|%an|%ad|%s",
        ]
        if (args.author) logArgs.push(`--author=${args.author}`)
        if (args.since) logArgs.push(`--since=${args.since}`)

        const { stdout } = await runGit(logArgs)
        if (!stdout.trim()) return "没有符合条件的提交。"

        const lines = stdout
          .split("\n")
          .filter(Boolean)
          .map((l) => {
            const [hash, author, date, subject] = l.split("|")
            return `${hash} | ${author} | ${date} | ${subject}`
          })

        let out = lines.join("\n")
        if (args.oneline_only === false) {
          // 附加每次提交的变更统计
          try {
            const { stdout: statOut } = await runGit([
              "log",
              `--max-count=${limit}`,
              "--stat",
              "--format=--- %h %s",
              ...(args.author ? [`--author=${args.author}`] : []),
              ...(args.since ? [`--since=${args.since}`] : []),
            ])
            out = statOut.trim()
          } catch {
            // 退回摘要模式
          }
        }
        return truncate(out)
      },
    })
  )

  // 4. git_branch ------------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: "git_branch",
      description:
        "查看分支列表（只读）：当前分支标记、各分支最近提交、与上游的领先/落后情况。",
      parameters: {
        include_remote: {
          type: "boolean",
          description: "可选，是否包含远程分支（默认 false）",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        if (!isRepo()) throw new Error("当前目录不是 Git 仓库（未找到 .git）。")
        const branchArgs = ["branch", "-vv", "--no-color"]
        if (args.include_remote) branchArgs.push("-r")
        const { stdout } = await runGit(branchArgs)
        return stdout.trim() || "没有分支。"
      },
    })
  )

  // 5. git_commit ------------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: "git_commit",
      description:
        "受控提交：默认只提交已暂存的内容；files 指定文件列表时先暂存这些文件再提交；add_all=true 时暂存全部变更（含未跟踪文件）。含提交信息规范校验，禁止 amend。",
      parameters: {
        message: {
          type: "string",
          description: "提交信息（首行 ≤72 字符，详细说明放到空行后的正文）",
          required: true,
        },
        files: {
          type: "array",
          description: "可选，要提交的文件路径列表；提供时先 git add 这些文件",
        },
        add_all: {
          type: "boolean",
          description: "可选，是否暂存全部变更（git add -A，默认 false）",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        if (!isRepo()) throw new Error("当前目录不是 Git 仓库（未找到 .git）。")

        const check = validateCommitMessage(args.message)
        if (!check.ok) throw new Error(`提交信息校验失败：${check.reason}`)

        const addAll = args.add_all === true
        const files = Array.isArray(args.files) ? args.files : null

        // 防护 1：提交前检查暂存状态
        const { stdout: statusBefore } = await runGit(["status", "--porcelain=v1"])
        const st = parseStatus(statusBefore)
        if (st.conflicted.length > 0) {
          throw new Error(
            `存在未解决的合并冲突（${st.conflicted.join(", ")}），请先解决冲突。`
          )
        }
        if (!addAll && !files && st.staged.length === 0) {
          throw new Error(
            `暂存区为空，没有可提交的内容。未暂存的变更：${
              [...st.unstaged, ...st.untracked].join(", ") || "（无）"
            }。请先用 files 参数指定文件，或设 add_all=true 暂存全部变更。`
          )
        }

        // 防护 2：按需暂存
        if (files) {
          for (const f of files) {
            await runGit(["add", "--", f])
          }
        } else if (addAll) {
          await runGit(["add", "-A"])
        }

        // 提交（hooks 失败时如实抛出 stderr，不重试）
        await runGit(["commit", "-m", check.message])

        // 后置确认：哈希 + 变更统计
        const { stdout: showOut } = await runGit(["show", "--stat", "--format=%h", "HEAD"])
        const firstLine = showOut.split("\n")[0]
        const stat = parseStat(showOut)
        const statText = stat
          ? `\n变更统计: ${stat.files} 个文件, +${stat.insertions} 行, -${stat.deletions} 行`
          : ""
        return `提交成功: ${firstLine}\n${check.message.split("\n")[0]}${statText}`
      },
    })
  )
}
