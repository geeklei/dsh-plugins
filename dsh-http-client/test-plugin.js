// dsh-http-client 测试脚本：本地起 http 服务器，验证白名单/超时/截断
import { apply, name, inject, isHostAllowed } from "./index.js"
import { createServer } from "node:http"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let passed = 0
let failed = 0
function check(label, cond) {
  if (cond) { console.log(`  ✅ ${label}`); passed++ } else { console.log(`  ❌ ${label}`); failed++ }
}

const work = mkdtempSync(join(tmpdir(), "dsh-http-client-test-"))
process.chdir(work)

// 本地测试服务器：通过 http://localhost:<port> 访问（localhost 是域名，非 IP 字面量，可入白名单）
const server = createServer((req, res) => {
  if (req.url === "/json") {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ ok: true, items: [1, 2, 3] }))
  } else if (req.url === "/echo" && req.method === "POST") {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ received: body.length, method: "POST" }))
    })
  } else if (req.url === "/slow") {
    setTimeout(() => { res.writeHead(200); res.end("finally") }, 3000)
  } else if (req.url === "/big") {
    res.writeHead(200)
    res.end("x".repeat(2 * 1024 * 1024)) // 2MB，触发 1MB 上限
  } else if (req.url === "/redirect") {
    res.writeHead(302, { Location: "/json" })
    res.end()
  } else {
    res.writeHead(404)
    res.end("not found")
  }
})
await new Promise((r) => server.listen(0, "127.0.0.1", r))
const port = server.address().port
const BASE = `http://localhost:${port}`

const registered = {}
apply({ tools: { register(t) { registered[t.name] = t } } })

console.log(`插件名: ${name}, inject: ${inject.join(", ")}`)
check("注册了 2 个工具", Object.keys(registered).length === 2 && !!registered.http_get && !!registered.http_post)
const GET = registered.http_get, POST = registered.http_post

// 场景 1：白名单机制
console.log("\n场景 1：白名单")
check("精确匹配", isHostAllowed("api.example.com", ["api.example.com"]))
check("通配匹配子域", isHostAllowed("a.example.com", ["*.example.com"]))
check("通配不匹配裸域", !isHostAllowed("example.com", ["*.example.com"]))
check("大小写不敏感", isHostAllowed("API.EXAMPLE.COM", ["api.example.com"]))
check("空白名单全拒绝", !isHostAllowed("anything.com", []))
try {
  await GET.execute({ url: `${BASE}/json` })
  check("未加白主机默认拒绝（未触发）", false)
} catch (e) {
  check("未加白主机默认拒绝并给提示", e.message.includes("不在白名单") && e.message.includes("allow_unlisted"))
}
const r1 = await GET.execute({ url: `${BASE}/json`, allow_unlisted: true })
check("allow_unlisted 放行并写白名单", r1.includes("已将 localhost 加入白名单"))
check("白名单文件已生成", existsSync(".http-allowlist.json"))
check("白名单文件内容正确", JSON.parse(readFileSync(".http-allowlist.json", "utf8")).allow.includes("localhost"))
const r2 = await GET.execute({ url: `${BASE}/json` })
check("白名单生效后直接放行", r2.includes("状态: 200") && (r2.includes('"ok": true') || r2.includes('"ok":true')))
check("元信息含状态码", r2.includes("状态: 200 OK"))

// 场景 2：URL 安全校验
console.log("\n场景 2：URL 安全校验")
const badUrls = [
  ["ftp://localhost/x", "非http协议"],
  ["http://192.168.1.1/x", "IP直连"],
  [`http://localhost:${port + 1}/x`, "非标准端口"],
]
for (const [u, why] of badUrls) {
  try {
    await GET.execute({ url: u })
    check(`拒绝${why}（未触发）: ${u}`, false)
  } catch {
    check(`拒绝${why}`, true)
  }
}
// userinfo URL 单测（new URL 会剥离 userinfo，需确认被拦截）
try {
  await GET.execute({ url: `http://user:pass@localhost:${port}/json` })
  check("拒绝 userinfo（未触发）", false)
} catch (e) {
  check("拒绝 userinfo", e.message.includes("userinfo"))
}
// 无效 URL
try {
  await GET.execute({ url: "not a url" })
  check("拒绝无效 URL（未触发）", false)
} catch (e) {
  check("拒绝无效 URL", e.message.includes("无效 URL"))
}

// 场景 3：POST
console.log("\n场景 3：http_post")
const r3 = await POST.execute({
  url: `${BASE}/echo`,
  body: JSON.stringify({ hello: "world" }),
  headers: { "Content-Type": "application/json" },
})
check("POST 正常返回", r3.includes("状态: 200") && (r3.includes('"received": 18') || r3.includes('"received":17')))

// 场景 4：超时
console.log("\n场景 4：超时")
const t0 = Date.now()
try {
  await GET.execute({ url: `${BASE}/slow`, timeout_ms: 500 })
  check("超时中断（未触发）", false)
} catch (e) {
  const elapsed = Date.now() - t0
  check("超时中断并报错", e.message.includes("超时") && elapsed < 2500)
}

// 场景 5：响应体截断
console.log("\n场景 5：截断")
const r5 = await GET.execute({ url: `${BASE}/big` })
check("1MB 上限触发截断", r5.includes("已截断") && r5.length < 20000)
check("输出截断标注存在", r5.includes("[响应体超过 1024KB 上限，已截断]"))

// 场景 6：重定向
console.log("\n场景 6：重定向")
const r6 = await GET.execute({ url: `${BASE}/redirect` })
check("跟随重定向到 /json", r6.includes("状态: 200") && (r6.includes('"ok": true') || r6.includes('"ok":true')))

server.close()
forceRm(work)
console.log(`\n${"=".repeat(40)}`)
console.log(`测试完成: ${passed} 通过, ${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)

function forceRm(dir) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) }
  catch { console.log(`  ⚠ 临时目录清理失败（不影响测试结果）: ${dir}`) }
}
