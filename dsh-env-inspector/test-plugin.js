// dsh-env-inspector 测试脚本
import { apply, name, inject, isSensitive, maskValue } from "./index.js"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let passed = 0
let failed = 0
function check(label, cond) {
  if (cond) { console.log(`  ✅ ${label}`); passed++ } else { console.log(`  ❌ ${label}`); failed++ }
}

const work = mkdtempSync(join(tmpdir(), "dsh-env-inspector-test-"))
process.chdir(work)

const registered = {}
apply({ tools: { register(t) { registered[t.name] = t } } })

console.log(`插件名: ${name}, inject: ${inject.join(", ")}`)
check("注册了 inspect_env", Object.keys(registered).length === 1 && !!registered.inspect_env)
const T = registered.inspect_env

// 场景 1：脱敏核心逻辑（不依赖环境）
console.log("\n场景 1：敏感名识别与掩码")
const sensitiveNames = [
  "API_KEY", "apiKey", "OPENAI_API_KEY", "ACCESS_TOKEN", "refreshToken",
  "DB_PASSWORD", "passwd", "AWS_SECRET_ACCESS_KEY", "GITHUB_AUTH",
  "SESSION_ID", "CLIENT_SECRET", "COOKIE_STR", "PRIVATE_KEY",
]
for (const n of sensitiveNames) {
  check(`识别敏感: ${n}`, isSensitive(n))
}
const safeNames = ["HOME", "PATH", "NODE_ENV", "USERNAME", "TEMP", "LANG", "EDITOR"]
for (const n of safeNames) {
  check(`不误报: ${n}`, !isSensitive(n))
}
check("短值全掩码", maskValue("abc") === "***")
check("长值保留首2尾1", /^ab\*\*\*z\(len=4\)$/.test(maskValue("abdz")))

// 场景 2：完整输出
console.log("\n场景 2：inspect_env 完整输出")
process.env.DSH_TEST_API_KEY = "sk-1234567890abcdef"
process.env.DSH_TEST_TOKEN = "ghp_abcdef123456"
process.env.DSH_TEST_VISIBLE = "hello"
const out = await T.execute({})
check("包含 Node 版本", /Node: v\d/.test(out))
check("包含 npm 版本行", /npm: \d/.test(out))
check("包含 git 版本行", /git: git version \d/.test(out))
check("包含 PATH 段落", out.includes("== PATH =="))
check("包含环境变量段落", out.includes("== 环境变量 =="))
check("普通变量显示明文", out.includes("DSH_TEST_VISIBLE = hello"))
check("敏感变量明文不出现", !out.includes("sk-1234567890abcdef") && !out.includes("ghp_abcdef123456"))
check("提示隐藏的敏感变量数量", /另有 \d+ 个敏感变量已隐藏/.test(out))

// 场景 3：env_show_sensitive 掩码显示
console.log("\n场景 3：敏感变量掩码显示")
const out3 = await T.execute({ scope: "env", env_show_sensitive: true })
check("列出敏感变量名", out3.includes("DSH_TEST_API_KEY"))
check("值为掩码形式", /DSH_TEST_API_KEY = sk\*\*\*f\(len=\d+\)/.test(out3))
check("明文仍不出现", !out3.includes("sk-1234567890abcdef"))

// 场景 4：env_filter 过滤
console.log("\n场景 4：env_filter 过滤")
const out4 = await T.execute({ scope: "env", env_filter: "dsh_test" })
check("过滤命中目标变量", out4.includes("DSH_TEST_VISIBLE"))
check("不含无关变量", !out4.includes("HOME ="))

// 场景 5：scope 校验与各 scope
console.log("\n场景 5：scope 控制")
try {
  await T.execute({ scope: "bogus" })
  check("无效 scope 报错（未触发）", false)
} catch (e) {
  check("无效 scope 报错", e.message.includes("无效 scope"))
}
const outPath = await T.execute({ scope: "path" })
check("scope=path 只含 PATH", outPath.includes("== PATH ==") && !outPath.includes("== 环境变量 ==") && !outPath.includes("Node:"))
const outVer = await T.execute({ scope: "versions" })
check("scope=versions 只含版本", outVer.includes("Node:"))
check("versions 不含 env", !outVer.includes("== 环境变量 =="))

forceRm(work)
console.log(`\n${"=".repeat(40)}`)
console.log(`测试完成: ${passed} 通过, ${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)

function forceRm(dir) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) }
  catch { console.log(`  ⚠ 临时目录清理失败（不影响测试结果）: ${dir}`) }
}
