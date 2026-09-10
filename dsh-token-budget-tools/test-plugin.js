// dsh-token-budget 测试脚本
import { apply, name, inject, estimateTokens, splitByBudget, parseHeadings, extractSection } from "./index.js"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let passed = 0
let failed = 0
function check(label, cond) {
  if (cond) { console.log(`  ✅ ${label}`); passed++ } else { console.log(`  ❌ ${label}`); failed++ }
}

const work = mkdtempSync(join(tmpdir(), "dsh-token-budget-test-"))
process.chdir(work)

const registered = {}
apply({ tools: { register(t) { registered[t.name] = t } } })

console.log(`插件名: ${name}, inject: ${inject.join(", ")}`)
check("注册了 3 个工具", Object.keys(registered).length === 3)
const COUNT = registered.count_tokens, SPLIT = registered.split_text, EXTRACT = registered.extract_section

// 场景 1：估算口径
console.log("\n场景 1：count_tokens / estimateTokens")
check("纯 CJK 估算", estimateTokens("四字测试") === Math.ceil(4 * 0.6))
check("纯 ASCII 估算", estimateTokens("abcdefgh") === Math.ceil(8 * 0.25))
check("混合加权", estimateTokens("中文abc") === Math.ceil(2 * 0.6 + 3 * 0.25))
const c1 = await COUNT.execute({ text: "四字测试" })
check("count_tokens 输出估算值", c1.includes(`估算 tokens: ${Math.ceil(4 * 0.6)}`))
check("count_tokens 输出 CJK 占比", c1.includes("占 100.0%"))
writeFileSync("sample.txt", "hello 中文混合")
const c2 = await COUNT.execute({ file: "sample.txt" })
check("file 输入可用", c2.includes(`估算 tokens: ${Math.ceil(5 * 0.25 + 2 * 0.6 + 3 * 0.25)}`))
try {
  await COUNT.execute({})
  check("缺源报错（未触发）", false)
} catch (e) { check("缺源报错", e.message.includes("text 或 file")) }

// 场景 2：split_text 段落级
console.log("\n场景 2：split_text 段落分块")
// 每段约 0.6*20=12 tokens，预算 30 → 每块最多 2 段
const paraText = Array.from({ length: 8 }, (_, i) => `第${i}段内容` + "字".repeat(14)).join("\n\n")
const r2 = await SPLIT.execute({ text: paraText, budget: 30 })
check("分块数符合预期", /共 2 块/.test(r2))
check("每块带估算标注", r2.includes("[~"))
// 空段落被跳过
const withEmpty = "段落一内容\n\n\n\n段落二内容\n\n\n"
const r2b = await SPLIT.execute({ text: withEmpty, budget: 100 })
check("空段落跳过", /共 1 块/.test(r2b))

// 场景 3：split_text 降级切分
console.log("\n场景 3：段落超预算降级")
// 单段超预算：按行切
const lineHeavy = Array.from({ length: 6 }, (_, i) => `行${i} ` + "x".repeat(40)).join("\n")
const r3 = await SPLIT.execute({ text: lineHeavy, budget: 50 })
const est3 = splitByBudget(lineHeavy, 50)
check("按行降级切分且每块不超预算", est3.every((c) => c.est <= 50))
check("切出多块", est3.length > 1)
// 单行超预算：按句硬切
const sentenceHeavy = "第一句。第二句。第三句。".repeat(10)
const est3b = splitByBudget(sentenceHeavy, 40)
check("按句切分每块不超预算", est3b.every((c) => c.est <= 40))
// 无标点超长行：硬切
const noPunct = "字".repeat(1000)
const est3c = splitByBudget(noPunct, 30)
check("硬切每块不超预算", est3c.every((c) => c.est <= 30))
check("硬切覆盖全文", est3c.map(c=>c.text).join("").length === 1000)
// 参数校验
const rClamp = await SPLIT.execute({ text: "短文本", budget: 10 })
check("过小预算钳制到下限 50", rClamp.includes("预算 50"))
try {
  await SPLIT.execute({ text: "字".repeat(20000), budget: 50 })
  check("切块过多报错（未触发）", false)
} catch (e) { check("切块过多报错（预算太小）", e.message.includes("超过单次上限")) }

// 场景 4：extract_section 目录与提取
console.log("\n场景 4：extract_section")
const md = [
  "# 总览",
  "总览正文",
  "",
  "## 安装",
  "安装正文第一段",
  "",
  "安装正文第二段",
  "",
  "### 前置要求",
  "需要 Node 18+",
  "",
  "## 使用",
  "使用正文",
].join("\n")
writeFileSync("doc.md", md)
const toc = await EXTRACT.execute({ file: "doc.md" })
check("目录列出全部标题", toc.includes("[H1] 总览") && toc.includes("[H2] 安装") && toc.includes("[H3] 前置要求"))
check("目录有层级缩进", toc.includes("  - [H2]"))
const sec = await EXTRACT.execute({ file: "doc.md", title: "安装" })
check("提取章节正文", sec.includes("安装正文第一段") && sec.includes("安装正文第二段"))
check("章节不含下一个同级标题内容", !sec.includes("使用正文"))
check("章节不含更高级标题内容", !sec.includes("总览正文"))
check("章节含 token 估算", sec.includes("估算 tokens:"))
const sub = await EXTRACT.execute({ file: "doc.md", title: "前置要求" })
check("提取子章节", sub.includes("需要 Node 18+") && !sub.includes("使用正文"))
try {
  await EXTRACT.execute({ file: "doc.md", title: "不存在的标题" })
  check("未命中标题报错（未触发）", false)
} catch (e) { check("未命中标题报错并列出现有标题", e.message.includes("未找到标题") && e.message.includes("总览")) }
// 代码块内的 # 不算标题
const withCode = "# 标题\n```python\n# 这是注释\nprint(1)\n```\n"
const toc2 = await EXTRACT.execute({ text: withCode })
check("代码块内 # 不计入目录", toc2.includes("共 1 个"))

// 场景 5：路径与边界
console.log("\n场景 5：路径与边界")
try {
  await SPLIT.execute({ file: "../outside.txt", budget: 1000 })
  check("路径越界拒绝（未触发）", false)
} catch (e) { check("路径越界拒绝", e.message.includes("工作目录之外")) }
try {
  await SPLIT.execute({ text: "字".repeat(500_001), budget: 5000 })
  check("超长输入拒绝（未触发）", false)
} catch (e) { check("超长输入拒绝", e.message.includes("过长")) }
// parseHeadings 单元级
check("parseHeadings 行号正确", parseHeadings(md)[0].line === 0 && parseHeadings(md)[1].line === 3)
const secRange = extractSection(md, parseHeadings(md), 1)
check("extractSection 行号范围正确", secRange.startLine === 4 && secRange.title === "安装")

forceRm(work)
console.log(`\n${"=".repeat(40)}`)
console.log(`测试完成: ${passed} 通过, ${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)

function forceRm(dir) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) }
  catch { console.log(`  ⚠ 临时目录清理失败（不影响测试结果）: ${dir}`) }
}
