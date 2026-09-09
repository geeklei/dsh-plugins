import { defineTool } from "@deepseek-ai/dsh-tools"
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"

export const name = "http-client"
export const inject = ["tools"]

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------
const ALLOWLIST_FILE = ".http-allowlist.json"
const DEFAULT_TIMEOUT_MS = 15000
const MAX_TIMEOUT_MS = 60000
const MAX_BODY_BYTES = 1024 * 1024 // 响应体上限 1MB，超出即中止读取
const OUTPUT_LIMIT = 8000 // 返回给模型的文本截断阈值（字符）
const ALLOWED_METHODS = ["GET", "POST"]

// ---------------------------------------------------------------------------
// 白名单管理
// ---------------------------------------------------------------------------
/** 读取白名单：工作目录 .http-allowlist.json，{"allow":["api.example.com"]} */
function loadAllowlist() {
  const p = resolve(process.cwd(), ALLOWLIST_FILE)
  if (!existsSync(p)) return []
  try {
    const data = JSON.parse(readFileSync(p, "utf8"))
    if (!Array.isArray(data.allow)) return []
    return data.allow.filter((h) => typeof h === "string" && h.length > 0)
  } catch {
    return [] // 损坏视作空白名单（fail closed）
  }
}

/** 域名匹配：支持精确匹配与 "*.example.com" 通配（不含裸 example.com） */
export function isHostAllowed(hostname, allowlist) {
  const host = hostname.toLowerCase()
  for (const rule of allowlist) {
    const r = rule.toLowerCase()
    if (r === host) return true
    if (r.startsWith("*.")) {
      const suffix = r.slice(1) // ".example.com"
      if (host.endsWith(suffix)) return true
    }
  }
  return false
}

function saveAllowlist(additions) {
  const p = resolve(process.cwd(), ALLOWLIST_FILE)
  const current = loadAllowlist()
  const merged = [...new Set([...current, ...additions])]
  writeFileSync(p, JSON.stringify({ allow: merged }, null, 2), "utf8")
  return merged
}

/**
 * 安全校验 URL：
 * 1. 必须是 http(s) 绝对 URL
 * 2. 禁止 IP 直连（防止绕过域名白名单）、禁止 userinfo、禁止非默认端口（可显式配置例外）
 * 3. 主机必须在白名单内，或 allow_unlisted=true 且追加进白名单
 */
function checkUrl(rawUrl, allowUnlisted) {
  let u
  try {
    u = new URL(rawUrl)
  } catch {
    throw new Error(`无效 URL: "${rawUrl}"。必须是完整的 http(s) 绝对地址。`)
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`仅允许 http/https 协议，收到: ${u.protocol}`)
  }
  if (u.username || u.password) {
    throw new Error("拒绝包含 userinfo 的 URL（http://user:pass@host）。")
  }
  const host = u.hostname.toLowerCase()
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) {
    throw new Error(`拒绝 IP 直连（${host}）。白名单基于域名，请使用域名访问。`)
  }
  const isLocal = host === "localhost" || host === "127.0.0.1"
  if (u.port && !isLocal && u.port !== "80" && u.port !== "443") {
    throw new Error(`拒绝非标准端口 ${u.port}（仅允许 80/443，localhost 例外）。`)
  }

  const allowlist = loadAllowlist()
  if (!isHostAllowed(host, allowlist)) {
    if (!allowUnlisted) {
      throw new Error(
        `主机 "${host}" 不在白名单中。当前白名单: ${allowlist.join(", ") || "（空）"}。` +
          `可传 allow_unlisted=true 将其追加到 ${ALLOWLIST_FILE}（一次性确认，之后无需重复）。`
      )
    }
    return { url: u, allowlist: saveAllowlist([host]), addedNew: true }
  }
  return { url: u, allowlist, addedNew: false }
}

/** 读取响应体：超过 maxBytes 立即中止并标注截断 */
async function readBody(response, maxBytes) {
  const reader = response.body.getReader()
  const chunks = []
  let received = 0
  let truncated = false
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > maxBytes) {
      chunks.push(value.subarray(0, value.byteLength - (received - maxBytes)))
      truncated = true
      await reader.cancel()
      break
    }
    chunks.push(value)
  }
  const text = Buffer.concat(chunks).toString("utf8")
  return { text, truncated, receivedBytes: received }
}

/** 统一执行请求 */
async function doRequest({ method, rawUrl, headers, body, timeoutMs, allowUnlisted }) {
  const { url, allowlist, addedNew } = checkUrl(rawUrl, allowUnlisted)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetch(url, {
      method,
      headers: headers && typeof headers === "object" ? headers : undefined,
      body: method === "POST" && body != null ? String(body) : undefined,
      signal: controller.signal,
      redirect: "follow",
    })
  } catch (e) {
    clearTimeout(timer)
    if (e.name === "AbortError") {
      throw new Error(`请求超时（${timeoutMs}ms）: ${url.href}`)
    }
    throw new Error(`请求失败: ${e.message}（${url.href}）`)
  }
  clearTimeout(timer)

  const { text, truncated, receivedBytes } = await readBody(response, MAX_BODY_BYTES)
  const meta = [
    `URL: ${url.href}`,
    `状态: ${response.status} ${response.statusText}`,
    `响应大小: ${receivedBytes} 字节${truncated ? `（超出 ${MAX_BODY_BYTES / 1024}KB 上限，已截断）` : ""}`,
    `白名单: ${addedNew ? `已将 ${url.hostname} 加入白名单` : `${url.hostname} 在白名单内`}（共 ${allowlist.length} 条）`,
  ].join("\n")

  let bodyOut = text
  let sizeNote = truncated ? `\n[响应体超过 ${MAX_BODY_BYTES / 1024}KB 上限，已截断]` : ""
  if (bodyOut.length > OUTPUT_LIMIT) {
    bodyOut = bodyOut.slice(0, OUTPUT_LIMIT) + `\n[输出已截断，完整长度 ${text.length} 字符]`
  }
  bodyOut += sizeNote
  return `${meta}\n\n${bodyOut}`
}

// ---------------------------------------------------------------------------
// 工具注册
// ---------------------------------------------------------------------------
export function apply(ctx) {
  const commonParams = {
    headers: {
      type: "object",
      description: "可选，请求头键值对",
      additionalProperties: true,
    },
    timeout_ms: {
      type: "number",
      description: "可选，超时毫秒数（默认 15000，上限 60000）",
    },
    allow_unlisted: {
      type: "boolean",
      description:
        "可选，主机不在白名单时是否追加白名单后放行（默认 false 直接拒绝）；true 会写入 .http-allowlist.json",
    },
  }

  ctx.tools.register(
    defineTool({
      name: "http_get",
      description:
        "发起受控的 GET 请求：仅允许白名单域名的 http(s) 地址（禁止 IP 直连与非标准端口），超时默认 15s，响应体上限 1MB，返回文本自动截断。主机不在白名单时可用 allow_unlisted=true 首次放行。",
      parameters: {
        url: { type: "string", description: "完整的 http(s) URL", required: true },
        ...commonParams,
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        const timeoutMs = Math.min(Math.max(Number(args.timeout_ms ?? DEFAULT_TIMEOUT_MS), 1), MAX_TIMEOUT_MS)
        return doRequest({
          method: "GET",
          rawUrl: args.url,
          headers: args.headers,
          timeoutMs,
          allowUnlisted: args.allow_unlisted === true,
        })
      },
    })
  )

  ctx.tools.register(
    defineTool({
      name: "http_post",
      description:
        "发起受控的 POST 请求：安全约束同 http_get（白名单域名、超时、1MB 上限、截断）。body 为字符串（通常是 JSON 文本，配合 Content-Type: application/json）。",
      parameters: {
        url: { type: "string", description: "完整的 http(s) URL", required: true },
        body: { type: "string", description: "请求体字符串", required: true },
        ...commonParams,
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        const timeoutMs = Math.min(Math.max(Number(args.timeout_ms ?? DEFAULT_TIMEOUT_MS), 1), MAX_TIMEOUT_MS)
        return doRequest({
          method: "POST",
          rawUrl: args.url,
          headers: args.headers,
          body: args.body,
          timeoutMs,
          allowUnlisted: args.allow_unlisted === true,
        })
      },
    })
  )
}
