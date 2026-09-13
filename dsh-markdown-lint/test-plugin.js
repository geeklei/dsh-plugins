// dsh-markdown-lint 测试脚本
import { apply, name, inject, maskCodeBlocks, checkHeadings, checkListIndent, checkLinks, autoFix } from "./index.js"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let passed = 0
let failed = 0
function check(label, cond) {
  if (cond) { console.log(`  ✅ ${label}`); passed++ } else { console.log(`  ❌ ${label}`); failed++ }
}

const work = mkdtempSync(join(tmpdir(), "dsh-markdown-lint-test-"))
process.chdir(work)

const registered = {}
apply({ tools: { register(t) { registered[t.name] = t } } })

console.log(`插件名: ${name}, inject: ${inject.join(", ")}`)
check("注册了 2 个工具", Object.keys(registered).length === 2 && !!registered.lint_markdown && !!registered.fix_markdown)
const LINT = registered.lint_markdown, FIX = registered.fix_markdown

// 场景 1：标题层级
console.log("\n场景 1：heading-hierarchy")
const r1 = await LINT.execute({ text: "# 标题\n正文\n### 三级\n#### 四级" })
check("检测跳级", r1.includes("H1 之后直接出现 H3"))
check("标注可自动修复", r1.includes("可自动修复"))
const r1b = await LINT.execute({ text: "# A\n## B\n# C\n## D" })
check("检测多 H1", r1b.includes("2 个 H1"))
check("多 H1 不可修复", r1b.includes("文件级") && !/文件级.*可自动修复/.test(r1b))
const r1c = await LINT.execute({ text: "# 标题\n## 二级\n### 三级" })
check("正常层级不报", r1c.includes("✅"))
// 代码块内的 # 不算标题
const r1d = await LINT.execute({ text: "# 标题\n```bash\n# 这是注释\n### 假标题\n```\n" })
check("代码块内 # 跳过", r1d.includes("✅"))
check("maskCodeBlocks 正确", (() => {
  const m = maskCodeBlocks(["# a", "```", "# in", "```", "## b"])
  return m[0] === false && m[1] === true && m[2] === true && m[3] === true && m[4] === false
})())

// 场景 2：列表缩进
console.log("\n场景 2：list-indent")
const r2 = await LINT.execute({ text: "# 标题\n- 项\n\t- Tab缩进\n- 项2" })
check("检测 Tab 缩进", r2.includes("Tab"))
const mixed = "# 标题\n- 项\n  - 两格\n    - 四格嵌套\n  - 两格\n    - 四格2\n    - 四格3"
const r2b = await LINT.execute({ text: mixed })
check("检测嵌套步长不一致", r2b.includes("4 空格与主流 2 空格不一致"))
const r2c = await LINT.execute({ text: "- 项\n  - 两格\n  - 两格\n- 项2" })
check("一致缩进不报", r2c.includes("✅"))
// 有序列表也算
const r2d = await LINT.execute({ text: "# 标题\n1. 项\n\t2. Tab缩进" })
check("有序列表 Tab 也报", r2d.includes("Tab"))

// 场景 3：相对链接存在性
console.log("\n场景 3：link-exists")
mkdirSync(join(work, "docs"), { recursive: true })
writeFileSync(join(work, "README.md"), "# 主文档\n")
writeFileSync(join(work, "docs", "guide.md"), "# 指南\n")
const docText = [
  "# 文档",
  "[存在的相对链接](docs/guide.md)",
  "[不存在的链接](docs/missing.md)",
  "[上级链接](./no-such.md)",
  "[http 跳过](https://example.com/x)",
  "[锚点跳过](#section)",
  "[纯锚点目标](#)",
  "```markdown",
  "[代码块内链接](no-check.md)",
  "```",
].join("\n")
writeFileSync("doc.md", docText)
const r3 = await LINT.execute({ file: "doc.md" })
check("检出缺失链接 2 处", (r3.match(/目标不存在/g) || []).length === 2)
check("http/锚点/代码块不误报", r3.includes("发现 2 个问题"))
check("报错含解析路径", r3.includes("解析为"))
// file 模式以文件所在目录解析相对路径
mkdirSync(join(work, "sub"), { recursive: true })
writeFileSync(join(work, "sub", "inner.md"), "[上级存在的链接](../README.md)\n[上级缺失链接](../ghost.md)")
const r3b = await LINT.execute({ file: "sub/inner.md" })
check("相对基准为文件所在目录", r3b.includes("发现 1 个问题"))
// text 模式以 cwd 解析
const r3c = await LINT.execute({ text: "[存在](README.md)\n[缺失](nope.md)" })
check("text 模式以 cwd 解析", r3c.includes("发现 1 个问题"))

// 场景 4：fix_markdown（text 模式返回全文）
console.log("\n场景 4：fix_markdown text 模式")
const r4 = await FIX.execute({ text: "# 标题\n正文\n### 跳级标题\n- 项\n\t- Tab" })
check("报告修复数", r4.includes("应用了 2 处修复"))
check("标题降级为 H2", r4.includes("## 跳级标题"))
check("Tab 转 4 空格", / {4}- Tab/.test(r4))
const r4b = await FIX.execute({ text: "# 标题\n## 二级\n正文" })
check("无问题时不输出全文", r4b.includes("没有可自动修复") && !r4b.includes("修复后全文"))

// 场景 5：fix_markdown file 模式 write
console.log("\n场景 5：fix_markdown file 模式")
writeFileSync("broken.md", "# 标题\n正文\n#### 跳四级\n- 项\n\t- Tab\n")
const r5preview = await FIX.execute({ file: "broken.md" })
check("write=false 不写文件", !r5preview.includes("已写回文件") && readFileSync("broken.md", "utf8").includes("####"))
const r5 = await FIX.execute({ file: "broken.md", write: true })
check("write=true 写回", r5.includes("已写回文件"))
const fixed = readFileSync("broken.md", "utf8")
check("文件内容已修复", fixed.includes("## 跳四级") && / {4}- Tab/.test(fixed))
// 修复后复检应只剩不可修复项
const r5b = await LINT.execute({ file: "broken.md" })
check("修复后复检通过", r5b.includes("✅"))

// 场景 6：路径与边界
console.log("\n场景 6：路径与边界")
try {
  await LINT.execute({ file: "../outside.md" })
  check("路径越界拒绝（未触发）", false)
} catch (e) { check("路径越界拒绝", e.message.includes("工作目录之外")) }
try {
  await LINT.execute({})
  check("缺源报错（未触发）", false)
} catch (e) { check("缺源报错", e.message.includes("text 或 file")) }
// 空文件
const r6 = await LINT.execute({ text: "\n\n" })
check("空内容通过", r6.includes("✅"))

forceRm(work)
console.log(`\n${"=".repeat(40)}`)
console.log(`测试完成: ${passed} 通过, ${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)

function forceRm(dir) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) }
  catch { console.log(`  ⚠ 临时目录清理失败（不影响测试结果）: ${dir}`) }
}
