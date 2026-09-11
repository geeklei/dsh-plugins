// dsh-csv-explorer 测试脚本
import { apply, name, inject, sniffDelimiter, parseCsv, toNumber } from "./index.js"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let passed = 0
let failed = 0
function check(label, cond) {
  if (cond) { console.log(`  ✅ ${label}`); passed++ } else { console.log(`  ❌ ${label}`); failed++ }
}

const work = mkdtempSync(join(tmpdir(), "dsh-csv-explorer-test-"))
process.chdir(work)

const registered = {}
apply({ tools: { register(t) { registered[t.name] = t } } })

console.log(`插件名: ${name}, inject: ${inject.join(", ")}`)
check("注册了 2 个工具", Object.keys(registered).length === 2 && !!registered.csv_preview && !!registered.csv_stats)
const PREVIEW = registered.csv_preview, STATS = registered.csv_stats

const salesCsv = `name,region,amount,qty
Alice,East,"1,200.50",3
Bob,West,800,2
Carol,East,950.75,5
Dave,,1200,1
Eve,North,ab,4`

// 场景 1：分隔符嗅探与解析
console.log("\n场景 1：分隔符嗅探")
check("逗号", sniffDelimiter("a,b\n1,2") === ",")
check("分号", sniffDelimiter("a;b\n1;2") === ";")
check("Tab", sniffDelimiter("a\tb\n1\t2") === "\t")
check("管道", sniffDelimiter("a|b\n1|2") === "|")
check("无分隔符默认逗号", sniffDelimiter("abc\ndef") === ",")
const parsed = parseCsv(salesCsv, ",")
check("表头识别", parsed.headers.join(",") === "name,region,amount,qty")
check("数据行数", parsed.rows.length === 5)
check("引号内逗号不切分", parsed.rows[0][2] === "1,200.50")
check("短行补齐", parsed.rows[3][3] === "1")
check("空表头补列名", parseCsv(",b\n1,2", ",").headers[0] === "列1")

// 场景 2：数值识别
console.log("\n场景 2：toNumber")
check("普通数", toNumber("800") === 800)
check("千分位", toNumber('"1,200.50"'.replace(/"/g, "")) === 1200.5)
check("负数", toNumber("-12.5") === -12.5)
check("百分号", toNumber("85%") === 85)
check("货币符号", toNumber("¥99") === 99 && toNumber("$1,000") === 1000)
check("科学计数", toNumber("1.5e3") === 1500)
check("非数值 null", toNumber("ab") === null)
check("空串 null", toNumber("") === null)
check("纯逗号串不误判", toNumber(",,,") === null)

// 场景 3：csv_preview
console.log("\n场景 3：csv_preview")
const r3 = await PREVIEW.execute({ text: salesCsv })
check("嗅探到逗号", r3.includes('分隔符: ","'))
check("总行数", r3.includes("总行数: 5"))
check("列数", r3.includes("列数: 4"))
check("Markdown 表格含表头", r3.includes("| name | region | amount | qty |"))
check("含引号内逗号的单元格完整", r3.includes("1,200.50"))
check("默认预览 5 行且无剩余提示", !r3.includes("剩余"))
const r3b = await PREVIEW.execute({ text: salesCsv, rows: 2 })
check("rows 限制生效", r3b.includes("剩余 3 行未显示"))
// BOM + CRLF
const r3c = await PREVIEW.execute({ text: "\uFEFFname,city\r\nA,Beijing\r\n" })
check("BOM+CR LF 处理", r3c.includes("总行数: 1") && r3c.includes("Beijing"))
// 分号分隔
const r3d = await PREVIEW.execute({ text: "a;b\n1;2\n3;4" })
check("分号嗅探生效", r3d.includes('分隔符: ";"'))
// 显式分隔符覆盖嗅探
const r3e = await PREVIEW.execute({ text: "a,b\n1,2", delimiter: ";" })
check("显式分隔符覆盖", r3e.includes("（显式指定）") && r3e.includes("列数: 1"))
// text/file 二选一
writeFileSync("sales.csv", salesCsv)
const r3f = await PREVIEW.execute({ file: "sales.csv" })
check("file 输入可用", r3f.includes("总行数: 5"))
try {
  await PREVIEW.execute({})
  check("缺源报错（未触发）", false)
} catch (e) { check("缺源报错", e.message.includes("text 或 file")) }
try {
  await PREVIEW.execute({ file: "../outside.csv" })
  check("路径越界拒绝（未触发）", false)
} catch (e) { check("路径越界拒绝", e.message.includes("工作目录之外")) }

// 场景 4：csv_stats
console.log("\n场景 4：csv_stats")
const r4 = await STATS.execute({ text: salesCsv })
check("amount 列统计", r4.includes("[2] amount:") && r4.includes("min: 800") && r4.includes("max: 1200"))
check("千分位计入数值", r4.includes("sum: 4151.25"))
check("qty 列统计", r4.includes("[3] qty:") && r4.includes("median: 3"))
check("非数值单元格计数", r4.includes("非数值 1 个"))
check("非数值列跳过", r4.includes("[0] name: 非数值列") && r4.includes("[1] region: 非数值列"))
// 指定列（列名与下标）
const r4b = await STATS.execute({ text: salesCsv, columns: ["qty"] })
check("按列名统计", r4b.includes("[3] qty:") && !r4b.includes("[2] amount:"))
const r4c = await STATS.execute({ text: salesCsv, columns: ["2"] })
check("按列下标统计", r4c.includes("[2] amount:"))
try {
  await STATS.execute({ text: salesCsv, columns: ["nope"] })
  check("列不存在报错（未触发）", false)
} catch (e) { check("列不存在报错", e.message.includes("不存在") && e.message.includes("可用列")) }
// 全非数值 CSV
const r4d = await STATS.execute({ text: "a,b\nx,y\nz,w" })
check("全非数值提示", r4d.includes("[0] a: 非数值列") && r4d.includes("[1] b: 非数值列"))

// 场景 5：统计正确性（中位数/标准差）
console.log("\n场景 5：统计口径")
const numsCsv = "v\n1\n2\n3\n4"
const r5 = await STATS.execute({ text: numsCsv })
check("偶数行中位数取均值", r5.includes("median: 2.5"))
check("均值", r5.includes("mean: 2.5"))
check("标准差", r5.includes("std: 1.11803") || r5.includes("std: 1.118"))

forceRm(work)
console.log(`\n${"=".repeat(40)}`)
console.log(`测试完成: ${passed} 通过, ${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)

function forceRm(dir) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) }
  catch { console.log(`  ⚠ 临时目录清理失败（不影响测试结果）: ${dir}`) }
}
