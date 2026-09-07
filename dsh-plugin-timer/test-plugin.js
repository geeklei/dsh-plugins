// dsh-plugin-timer 测试脚本
import { apply, name, inject, parseDuration } from "./index.js"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let passed = 0
let failed = 0
function check(label, cond) {
  if (cond) { console.log(`  ✅ ${label}`); passed++ } else { console.log(`  ❌ ${label}`); failed++ }
}

const work = mkdtempSync(join(tmpdir(), "dsh-plugin-timer-test-"))
process.chdir(work)

const registered = {}
apply({ tools: { register(t) { registered[t.name] = t } } })

console.log(`插件名: ${name}, inject: ${inject.join(", ")}`)
check("注册了 3 个工具", Object.keys(registered).length === 3)
check("包含 set_timer", !!registered.set_timer)
check("包含 list_timers", !!registered.list_timers)
check("包含 cancel_timer", !!registered.cancel_timer)
const SET = registered.set_timer, LIST = registered.list_timers, CANCEL = registered.cancel_timer

// 场景 1：时长解析
console.log("\n场景 1：parseDuration")
check("纯数字按秒", parseDuration("90") === 90)
check("s 单位", parseDuration("30s") === 30)
check("m 单位", parseDuration("5m") === 300)
check("h 单位", parseDuration("2h") === 7200)
check("d 单位", parseDuration("1d") === 86400)
check("组合式 1h30m", parseDuration("1h30m") === 5400)
check("组合式带空格", parseDuration("1 h 30 m") === 5400)
check("数字类型直通", parseDuration(120) === 120)
check("拒绝 0", parseDuration("0") === null)
check("拒绝负数", parseDuration(-5) === null)
check("拒绝空串", parseDuration("") === null)
check("拒绝非法单位", parseDuration("1x") === null)
check("拒绝重复单位", parseDuration("1h2h") === null)
check("拒绝纯单位", parseDuration("h") === null)

// 场景 2：设置与列表
console.log("\n场景 2：set_timer 与 list_timers")
const r1 = await SET.execute({ duration: "1h", label: "开会提醒" })
check("设置成功返回 ID", /ID: t\w+/.test(r1))
check("返回剩余时间", r1.includes("1小时"))
const id1 = r1.match(/ID: (t\w+)/)[1]
const r2 = await SET.execute({ duration: "2s", label: "即将到期的提醒" })
const id2 = r2.match(/ID: (t\w+)/)[1]
check("持久化文件已生成", existsSync(".timers.json"))
const list1 = await LIST.execute({})
check("列表显示两个待到期", list1.includes("待到期 (2/2)"))
check("剩余最短排前面", list1.indexOf(id2) < list1.indexOf(id1))
check("持久化内容可读", JSON.parse(readFileSync(".timers.json", "utf8")).length === 2)

// 场景 3：到期检测
console.log("\n场景 3：到期检测")
await new Promise((r) => setTimeout(r, 2100))
const list2 = await LIST.execute({})
check("到期后不显示在待到期", !list2.includes(id2))
check("提示有到期项未显示", list2.includes("1 个已到期定时器未显示"))
const list3 = await LIST.execute({ include_done: true })
check("include_done 显示已到期", list3.includes("【已到期】") && list3.includes(id2))

// 场景 4：取消
console.log("\n场景 4：cancel_timer")
try {
  await CANCEL.execute({ id: "t nonexistent" })
  check("取消不存在的 ID 报错（未触发）", false)
} catch (e) {
  check("取消不存在的 ID 报错", e.message.includes("未找到"))
}
const r4 = await CANCEL.execute({ id: id1 })
check("取消成功返回剩余数", r4.includes("剩余 1 个"))
const r5 = await CANCEL.execute({ all_done: true })
check("all_done 清理到期项", r5.includes("已清理 1 个"))
check("清理后存储为空", JSON.parse(readFileSync(".timers.json", "utf8")).length === 0)
const list5 = await LIST.execute({})
check("全部清空后提示无定时器", list5.includes("没有任何定时器"))

// 场景 5：参数校验与损坏恢复
console.log("\n场景 5：参数校验与损坏文件恢复")
try {
  await SET.execute({ duration: "abc", label: "x" })
  check("非法时长报错（未触发）", false)
} catch (e) {
  check("非法时长报错并给示例", e.message.includes("无法解析时长") && e.message.includes("示例"))
}
try {
  await SET.execute({ duration: "999d", label: "x" })
  check("超 30 天报错（未触发）", false)
} catch (e) {
  check("超 30 天报错", e.message.includes("超出范围"))
}
try {
  await SET.execute({ duration: "5m", label: "  " })
  check("空 label 报错（未触发）", false)
} catch (e) {
  check("空 label 报错", e.message.includes("label 不能为空"))
}
writeFileSync(".timers.json", "{corrupted!!!")
const list6 = await LIST.execute({})
check("损坏文件不崩溃，返回空", list6.includes("没有任何定时器"))
await SET.execute({ duration: "1m", label: "恢复后写入" })
check("损坏后可正常重建", JSON.parse(readFileSync(".timers.json", "utf8")).length === 1)

// 场景 6：上限
console.log("\n场景 6：数量上限")
rmSync(".timers.json")
const now = Date.now()
writeFileSync(
  ".timers.json",
  JSON.stringify(Array.from({ length: 50 }, (_, i) => ({
    id: `t${i}`, label: `#${i}`, dueAt: now + 3600_000, createdAt: now,
  })))
)
try {
  await SET.execute({ duration: "1m", label: "超额" })
  check("达到 50 个上限报错（未触发）", false)
} catch (e) {
  check("达到 50 个上限报错", e.message.includes("上限"))
}

forceRm(work)
console.log(`\n${"=".repeat(40)}`)
console.log(`测试完成: ${passed} 通过, ${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)

function forceRm(dir) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) }
  catch { console.log(`  ⚠ 临时目录清理失败（不影响测试结果）: ${dir}`) }
}
