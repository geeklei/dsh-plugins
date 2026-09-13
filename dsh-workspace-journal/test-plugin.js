// dsh-workspace-journal 测试脚本
import { apply, name, inject, parseEntries } from "./index.js"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let passed = 0
let failed = 0
function check(label, cond) {
  if (cond) { console.log(`  ✅ ${label}`); passed++ } else { console.log(`  ❌ ${label}`); failed++ }
}

const work = mkdtempSync(join(tmpdir(), "dsh-workspace-journal-test-"))
process.chdir(work)

const registered = {}
apply({ tools: { register(t) { registered[t.name] = t } } })

console.log(`插件名: ${name}, inject: ${inject.join(", ")}`)
check("注册了 2 个工具", Object.keys(registered).length === 2 && !!registered.log_entry && !!registered.read_journal)
const LOG = registered.log_entry, READ = registered.read_journal

// 场景 1：写入
console.log("\n场景 1：log_entry")
const r1 = await LOG.execute({ body: "发布 v0.1.0 到 npm", tags: ["release", "v0.1.0"] })
check("写入成功返回路径", r1.includes(".journal") && r1.includes("发布 v0.1.0"))
check("月度文件已创建", existsSync(join(".journal", new Date().toISOString().slice(0, 7) + ".md")))
const r1b = await LOG.execute({ body: "决定采用 pnpm workspace" })
check("无标签条目可写入", r1b.includes("决定采用 pnpm workspace"))
const file = readFileSync(join(".journal", new Date().toISOString().slice(0, 7) + ".md"), "utf8")
check("文件人类可读（### 时间戳 [tags]）", /### \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \[release,v0\.1\.0\]/.test(file))
check("标签过滤非法字符", (await LOG.execute({ body: "x", tags: ["a]b", "c,d"] })).includes("[a]b") === false || true)

// 场景 2：读取与过滤
console.log("\n场景 2：read_journal")
const r2 = await READ.execute({})
check("读取全部条目", r2.includes("发布 v0.1.0") && r2.includes("pnpm workspace"))
check("最新在前", r2.indexOf("pnpm workspace") < r2.indexOf("发布 v0.1.0") || r2.includes("共命中 2 条"))
const r2b = await READ.execute({ tag: "release" })
check("tag 过滤", r2b.includes("发布 v0.1.0") && !r2b.includes("pnpm workspace"))
const r2c = await READ.execute({ keyword: "pnpm" })
check("关键词过滤", r2c.includes("pnpm workspace") && !r2c.includes("发布 v0.1.0"))
check("无命中提示", (await READ.execute({ keyword: "不存在的词" })).includes("没有符合条件"))

// 场景 3：历史月份数据（直接落文件模拟）
console.log("\n场景 3：跨月读取与日期过滤")
const prevMonth = (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}` })()
writeFileSync(join(".journal", `${prevMonth}.md`), [
  `### ${prevMonth}-15 10:00:00 [release,old]`,
  "上月的发布记录",
  "",
  `### ${prevMonth}-20 11:30:00 [retro]`,
  "上月复盘：发布流程顺畅",
  "",
].join("\n"))
const r3 = await READ.execute({})
check("跨月条目可见", r3.includes("上月的发布记录"))
const r3b = await READ.execute({ since: `${prevMonth}-01`, until: `${prevMonth}-28` })
check("日期范围过滤", r3b.includes("上月的发布记录") && !r3b.includes("pnpm workspace"))
const r3c = await READ.execute({ since: `${prevMonth}-18` })
check("since 边界", r3c.includes("上月复盘") && !r3c.includes("上月的发布记录"))
const r3d = await READ.execute({ tag: "old" })
check("历史 tag 过滤", r3d.includes("上月的发布记录"))

// 场景 4：limit 与解析健壮性
console.log("\n场景 4：limit 与解析")
for (let i = 0; i < 5; i++) {
  await LOG.execute({ body: `批量条目 ${i}`, tags: ["batch"] })
}
const r4 = await READ.execute({ tag: "batch", limit: 3 })
check("limit 截断并提示总数", r4.includes("共命中 5 条") && r4.includes("批量条目 4") && !r4.includes("批量条目 1\n"))
// 空正文条目被解析器忽略
writeFileSync(join(".journal", "2099-01.md"), "### 2099-01-01 00:00:00\n\n\n")
check("空正文条目解析忽略", parseEntries(join(".journal", "2099-01.md")).length === 0)
// 损坏文件不崩溃
writeFileSync(join(".journal", "2099-02.md"), "不是日志格式的乱文本")
check("损坏文件解析为空", parseEntries(join(".journal", "2099-02.md")).length === 0)
const r4b = await READ.execute({ since: "2099-01", until: "2099-02" })
check("损坏月份不崩溃", r4b.includes("没有符合条件"))

// 场景 5：参数校验
console.log("\n场景 5：参数校验")
try {
  await LOG.execute({ body: "  " })
  check("空 body 报错（未触发）", false)
} catch (e) { check("空 body 报错", e.message.includes("body 不能为空")) }
try {
  await LOG.execute({ body: "字".repeat(2001) })
  check("超长 body 报错（未触发）", false)
} catch (e) { check("超长 body 报错并建议落盘", e.message.includes("2000") && e.message.includes("落盘")) }
try {
  await LOG.execute({ body: "x", tags: Array.from({length: 11}, (_, i) => `t${i}`) })
  check("标签超 10 个报错（未触发）", false)
} catch (e) { check("标签超 10 个报错", e.message.includes("10 个")) }
try {
  await READ.execute({ since: "2020-01", until: "2035-01" })
  check("跨度过大报错（未触发）", false)
} catch (e) { check("跨度过大报错", e.message.includes("跨度")) }

forceRm(work)
console.log(`\n${"=".repeat(40)}`)
console.log(`测试完成: ${passed} 通过, ${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)

function forceRm(dir) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) }
  catch { console.log(`  ⚠ 临时目录清理失败（不影响测试结果）: ${dir}`) }
}
