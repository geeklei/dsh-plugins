import { defineTool } from "@deepseek-ai/dsh-tools"
import { execFile } from "node:child_process"
import { platform, arch, versions } from "node:process"
import os from "node:os"

export const name = "env-inspector"
export const inject = ["tools"]

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------
const CMD_TIMEOUT_MS = 8000

/**
 * 敏感变量名匹配（不区分大小写）。命中任一模式即视为敏感值，
 * 输出时掩码处理。宁可误报（多掩码）不可漏报。
 */
const SENSITIVE_PATTERNS = [
  /key/i, // API_KEY, KEY, apiKey, PRIVATE_KEY...
  /token/i,
  /secret/i,
  /password|passwd|pwd$/i,
  /credential/i,
  /auth/i, // AUTH, AUTHORIZATION, GITHUB_AUTH...
  /cookie/i,
  /session/i, // SESSION_ID 可能泄露登录态
  /signature|sign$/i,
  /cert(?!ain)/i, // 证书，排除 contain 之类词
]

/** 判断变量名是否敏感 */
export function isSensitive(name) {
  return SENSITIVE_PATTERNS.some((p) => p.test(name))
}

/** 掩码：保留前 2 后 1 字符，中间以 *** 代替；过短则全掩码 */
export function maskValue(value) {
  const v = String(value)
  if (v.length <= 3) return "***"
  return `${v.slice(0, 2)}***${v.slice(-1)}(len=${v.length})`
}

/** 执行一条诊断命令，失败时返回错误说明而非抛出 */
function runCmd(cmd, args) {
  return new Promise((resolvePromise) => {
    execFile(
      cmd,
      args,
      { timeout: CMD_TIMEOUT_MS, windowsHide: true, shell: platform === "win32" },
      (err, stdout) => {
        if (err) resolvePromise(`${cmd} ${args.join(" ")}: 不可用（${err.code ?? "未安装或执行失败"}）`)
        else resolvePromise(String(stdout).trim().split("\n")[0])
      }
    )
  })
}

/** PATH 解析为目录列表 */
function parsePath() {
  const raw = process.env.PATH || process.env.Path || ""
  const entries = raw.split(platform === "win32" ? ";" : ":").filter(Boolean)
  return entries
}

// ---------------------------------------------------------------------------
// 工具注册
// ---------------------------------------------------------------------------
export function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: "inspect_env",
      description:
        "检查运行环境：Node/npm/git 版本、平台信息、PATH 目录列表、环境变量（敏感值自动掩码）。排障时一问即得。可用 scope 控制输出范围：all（默认）/ versions / path / env。",
      parameters: {
        scope: {
          type: "string",
          description: '输出范围："all"（默认）| "versions" | "path" | "env"',
        },
        env_filter: {
          type: "string",
          description: '可选，scope 含 env 时按子串过滤变量名（大小写不敏感），如 "npm" 只看 NPM_* 变量',
        },
        env_show_sensitive: {
          type: "boolean",
          description: "可选，默认 false；true 时也在输出中列出敏感变量名（值仍然掩码，永不显示明文）",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        const scope = args.scope || "all"
        const validScopes = ["all", "versions", "path", "env"]
        if (!validScopes.includes(scope)) {
          throw new Error(`无效 scope: "${scope}"。可选值: ${validScopes.join(", ")}`)
        }
        const parts = []

        // 1. 版本与平台
        if (scope === "all" || scope === "versions") {
          const [nodeV, npmV, gitV] = await Promise.all([
            Promise.resolve(versions.node),
            runCmd("npm", ["--version"]),
            runCmd("git", ["--version"]),
          ])
          parts.push(
            [
              "== 平台与版本 ==",
              `平台: ${platform}/${arch}`,
              `主机名: ${os.hostname()}`,
              `Node: v${nodeV}`,
              `npm: ${npmV}`,
              `git: ${gitV}`,
            ].join("\n")
          )
        }

        // 2. PATH
        if (scope === "all" || scope === "path") {
          const entries = parsePath()
          parts.push(
            ["\n== PATH ==" + ` (共 ${entries.length} 项)`, ...entries.map((e, i) => `${i + 1}. ${e}`)].join("\n")
          )
        }

        // 3. 环境变量（脱敏）
        if (scope === "all" || scope === "env") {
          const filter = args.env_filter ? String(args.env_filter).toLowerCase() : null
          const lines = []
          let shown = 0
          let maskedCount = 0
          for (const [k, v] of Object.entries(process.env)) {
            if (filter && !k.toLowerCase().includes(filter)) continue
            if (isSensitive(k)) {
              maskedCount++
              if (args.env_show_sensitive) {
                lines.push(`${k} = ${maskValue(v ?? "")}`)
              } else {
                continue
              }
            } else {
              lines.push(`${k} = ${v ?? ""}`)
            }
            shown++
          }
          const head = `\n== 环境变量 ==` + (filter ? ` (过滤: ${filter})` : "")
          const note =
            maskedCount > 0 && !args.env_show_sensitive
              ? `\n[另有 ${maskedCount} 个敏感变量已隐藏（key/token/secret/password 等）。值永不显示明文；传 env_show_sensitive=true 可查看掩码后的形式]`
              : maskedCount > 0
                ? `\n[其中 ${maskedCount} 个敏感变量值为掩码形式]`
                : ""
          parts.push([head, ...lines, note].filter(Boolean).join("\n"))
        }

        return parts.join("\n")
      },
    })
  )
}
