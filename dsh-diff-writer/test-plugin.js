// dsh-diff-writer 测试脚本：mock ctx.tools.register，在临时目录中验证 apply_patch
import { apply, name, inject } from "./index.js"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let passed = 0
let failed = 0
function check(label, cond) {
  if (cond) {
    console.log(`  ✅ ${label}`)
    passed++
  } else {
    console.log(`  ❌ ${label}`)
    failed++
  }
}

const work = mkdtempSync(join(tmpdir(), "dsh-diff-writer-test-"))
process.chdir(work)

const registered = {}
apply({ tools: { register(t) { registered[t.name] = t } } })

console.log(`插件名: ${name}, inject: ${inject.join(", ")}`)
check("注册了 apply_patch", Object.keys(registered).length === 1 && !!registered.apply_patch)
const T = registered.apply_patch

// 场景 1：唯一匹配替换
console.log("\n场景 1：唯一匹配 search/replace")
writeFileSync("config.txt", "name = old\nport = 3000\nname2 = old\n")
const r1 = await T.execute({
  path: "config.txt",
  patches: [{ search: "port = 3000", replace: "port = 8080" }],
})
check("替换成功并返回统计", r1.includes("替换 1 处"))
check("目标行已更新", readFileSync("config.txt", "utf8").includes("port = 8080"))
check("其他行未受影响", readFileSync("config.txt", "utf8").includes("name = old"))

// 场景 2：多处匹配默认拒绝
console.log("\n场景 2：多处匹配防护")
try {
  await T.execute({ path: "config.txt", patches: [{ search: "old", replace: "new" }] })
  check("多处匹配默认拒绝（未触发）", false)
} catch (e) {
  check("多处匹配默认拒绝", e.message.includes("2 处") && e.message.includes("all=true"))
}
await T.execute({ path: "config.txt", patches: [{ search: "old", replace: "new", all: true }] })
const c2 = readFileSync("config.txt", "utf8")
check("all=true 全量替换", c2.includes("new") && !/old/.test(c2))

// 场景 3：多补丁顺序执行 + 空 replace 删除
console.log("\n场景 3：多补丁顺序执行")
writeFileSync("multi.txt", "alpha\nbeta\ngamma\n")
await T.execute({
  path: "multi.txt",
  patches: [
    { search: "beta", replace: "" }, // 删除行内容
    { search: "alpha", replace: "ALPHA" },
  ],
})
const c3 = readFileSync("multi.txt", "utf8")
check("空 replace 删除内容", !c3.includes("beta"))
check("第二个补丁生效", c3.includes("ALPHA"))

// 场景 4：匹配失败时中止且不写文件
console.log("\n场景 4：匹配失败中止")
writeFileSync("fail.txt", "keep me\n")
try {
  await T.execute({ path: "fail.txt", patches: [{ search: "not-exist", replace: "x" }] })
  check("未匹配时报错（未触发）", false)
} catch (e) {
  check("未匹配时报错并提示", e.message.includes("未找到匹配"))
}
check("失败时文件未被改动", readFileSync("fail.txt", "utf8") === "keep me\n")

// 场景 5：新建文件
console.log("\n场景 5：create 新建")
await T.execute({ path: "new-dir/new.txt", patches: [], create: true })
check("create=true 新建空文件", existsSync("new-dir/new.txt"))
try {
  await T.execute({ path: "new-dir/new.txt", patches: [], create: true })
  check("create 已存在文件时报错（未触发）", false)
} catch (e) {
  check("create 已存在文件时报错", e.message.includes("已存在"))
}

// 场景 6：安全边界
console.log("\n场景 6：路径与参数边界")
try {
  await T.execute({ path: "../outside.txt", patches: [{ search: "a", replace: "b" }] })
  check("拒绝工作目录外路径（未触发）", false)
} catch (e) {
  check("拒绝工作目录外路径", e.message.includes("工作目录之外"))
}
try {
  await T.execute({ path: "config.txt", patches: [] })
  check("空 patches 报错（未触发）", false)
} catch (e) {
  check("空 patches 报错", e.message.includes("patches 不能为空"))
}
try {
  await T.execute({ path: "no-such.txt", patches: [{ search: "a", replace: "b" }] })
  check("文件不存在报错（未触发）", false)
} catch (e) {
  check("文件不存在报错并提示 create", e.message.includes("不存在") && e.message.includes("create=true"))
}
// 绝对路径在工作目录内应允许
await T.execute({ path: join(work, "abs.txt"), patches: [], create: true })
check("工作目录内绝对路径可用", existsSync("abs.txt"))

// ---------------------------------------------------------------------------
forceRm(work)
console.log(`\n${"=".repeat(40)}`)
console.log(`测试完成: ${passed} 通过, ${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)

function forceRm(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  } catch (e) {
    console.log(`  ⚠ 临时目录清理失败（不影响测试结果）: ${dir}`)
  }
}
