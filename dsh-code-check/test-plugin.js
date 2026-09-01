// 测试 dsh-code-check 插件的核心功能：审查流水线与结构化报告
import { reviewCode, renderReport } from "./index.js"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

// 无论从哪里启动，都把工作目录固定到插件自身目录（CI 的 prepublishOnly 会在包目录内运行）
process.chdir(dirname(fileURLToPath(import.meta.url)))

let passed = 0
let failed = 0

function check(name, condition) {
  if (condition) {
    console.log(`  ✅ ${name}`)
    passed += 1
  } else {
    console.log(`  ❌ ${name}`)
    failed += 1
  }
}

console.log("🔧 开始测试 dsh-code-check 插件\n")

// 场景 1：审查插件自身 index.js（应产出完整结构化报告，且评分较高）
console.log("场景 1：审查自身文件 index.js")
try {
  const report = await reviewCode({ path: "index.js" })
  check("报告包含标题", report.includes("代码审查报告"))
  check("报告包含问题概览表", report.includes("问题概览"))
  check("报告包含下一步行动", report.includes("下一步行动"))
  check("报告包含整体评分", /（\d+\/100）/u.test(report))
  check("自身代码评分不低于 75", !/🔴 D/u.test(report))
} catch (error) {
  check(`审查自身文件（报错: ${error.message}）`, false)
}

// 场景 2：审查一段有问题的代码片段（应检出 no-var、eval 等）
console.log("\n场景 2：审查含明显问题的代码片段")
const badSnippet = [
  "var name = 'world'",          // no-var + quotes
  "let unused = 1",              // no-unused-vars
  "eval('alert(1)')",            // eval 安全风险
  "if (name == 'world') { }",    // eqeqeq + no-empty
  "console.log(name)",           // console 调试
  "// TODO: 补完单元测试",
  "const xs = [1, 2, 3];",
  "xs.map(x =>  x * 2)",
].join("\n")
try {
  const report = await reviewCode({ snippet: badSnippet, language: "javascript" })
  check("检出 no-var 警告", report.includes("no-var"))
  check("检出 eval 风险", report.includes("eval"))
  check("检出 TODO 标记", report.includes("TODO"))
  check("包含必须修复或建议改进分区", report.includes("建议改进") || report.includes("必须修复"))
  check("给出修复建议", report.includes("建议："))
} catch (error) {
  check(`审查代码片段（报错: ${error.message}）`, false)
}

// 场景 3：格式混乱的片段（应触发 Prettier 未通过提示）
console.log("\n场景 3：格式校验")
const uglySnippet = "const  a={x:1,   y:2};function  f( ) {return a}   \n"
try {
  const report = await reviewCode({ snippet: uglySnippet, language: "javascript" })
  check("检出格式问题", report.includes("代码格式") || report.includes("需调整"))
} catch (error) {
  check(`格式校验（报错: ${error.message}）`, false)
}

// 场景 4：参数校验（既无 path 也无 snippet 应报错）
console.log("\n场景 4：参数校验")
try {
  await reviewCode({})
  check("缺少参数时应抛出错误", false)
} catch (error) {
  check("缺少参数时应抛出错误", /path|snippet/u.test(error.message))
}

// 场景 5：路径越权防护（../ 逃逸应当被拒绝）
console.log("\n场景 5：路径安全")
try {
  await reviewCode({ path: "../../Windows/System32/drivers/etc/hosts" })
  check("越权路径应被拒绝", false)
} catch (error) {
  check("越权路径应被拒绝", /工作目录/u.test(error.message))
}

// 场景 6：renderReport 可独立复用（结构化输出设计）
console.log("\n场景 6：报告渲染函数独立性")
const stub = renderReport({
  target: "demo.js",
  meta: { lineCount: 10, bytes: 256 },
  eslint: { configSource: "项目配置", messages: [{ line: 1, column: 1, severity: 2, ruleId: "no-var", message: "Unexpected var.", fixable: true }], errorCount: 1, warningCount: 0 },
  format: { ok: true, changedLines: 0 },
  heuristics: [],
  fixedCount: 0,
})
check("stub 报告包含规则名", stub.includes("no-var"))
check("stub 报告包含可自动修复提示", stub.includes("自动修复"))

console.log(`\n📊 测试结果: ${passed} 通过, ${failed} 失败`)
if (failed > 0) process.exit(1)
console.log("✅ 全部测试通过")
