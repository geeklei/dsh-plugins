// dsh-json-yaml-toolkit 测试脚本
import { apply, name, inject, queryPath, sniffFormat } from "./index.js"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let passed = 0
let failed = 0
function check(label, cond) {
  if (cond) { console.log(`  ✅ ${label}`); passed++ } else { console.log(`  ❌ ${label}`); failed++ }
}

const work = mkdtempSync(join(tmpdir(), "dsh-json-yaml-toolkit-test-"))
process.chdir(work)

const registered = {}
apply({ tools: { register(t) { registered[t.name] = t } } })

console.log(`插件名: ${name}, inject: ${inject.join(", ")}`)
check("注册了 3 个工具", Object.keys(registered).length === 3)
const CONV = registered.convert_format, QUERY = registered.query_json, VALID = registered.validate_schema

const userJson = JSON.stringify({
  name: "Alice", age: 30, tags: ["admin", "dev"],
  address: { city: "Beijing", zip: "100000" },
})

// 场景 1：convert_format 互转
console.log("\n场景 1：convert_format")
const yamlOut = await CONV.execute({ to: "yaml", text: userJson })
check("JSON→YAML 含字段", yamlOut.includes("name: Alice") && yamlOut.includes("city: Beijing"))
const tomlOut = await CONV.execute({ to: "toml", text: userJson })
check("JSON→TOML 含 section", tomlOut.includes("[address]") && tomlOut.includes('city = "Beijing"'))
const jsonBack = await CONV.execute({ to: "json", text: yamlOut })
check("YAML→JSON 往返一致", JSON.parse(jsonBack).address.zip === "100000")
const tomlText = `[owner]\nname = "Tom"\nport = 8080\n`
const jFromToml = await CONV.execute({ to: "json", text: tomlText })
check("TOML→JSON", JSON.parse(jFromToml).owner.port === 8080)
const yFromToml = await CONV.execute({ to: "yaml", text: tomlText })
check("TOML→YAML", yFromToml.includes("name: Tom"))
// file 输入
writeFileSync("data.json", userJson)
const fromFile = await CONV.execute({ to: "yaml", file: "data.json" })
check("file 输入可用", fromFile.includes("name: Alice"))
// 自动嗅探
check("嗅探 JSON", sniffFormat(userJson) === "json")
check("嗅探 TOML", sniffFormat(tomlText) === "toml")
check("嗅探 YAML", sniffFormat("name: Alice\nage: 30") === "yaml")
// 错误路径
try {
  await CONV.execute({ to: "xml", text: userJson })
  check("无效目标格式报错（未触发）", false)
} catch (e) { check("无效目标格式报错", e.message.includes("无效目标格式")) }
try {
  await CONV.execute({ to: "json", text: "{broken" })
  check("损坏输入报错（未触发）", false)
} catch (e) { check("损坏输入报错", e.message.includes("解析失败")) }
try {
  await CONV.execute({ to: "json" })
  check("缺源报错（未触发）", false)
} catch (e) { check("缺源报错", e.message.includes("text 或 file")) }
try {
  await CONV.execute({ to: "json", file: "../outside.json" })
  check("路径越界拒绝（未触发）", false)
} catch (e) { check("路径越界拒绝", e.message.includes("工作目录之外")) }
// TOML 损失警告
const lossy = await CONV.execute({ to: "toml", text: "[[items]]\nname=\"a\"\n" })
check("顶层数组转 TOML 出警告或可解析", lossy.includes("⚠") || lossy.includes("items"))

// 场景 2：query_json
console.log("\n场景 2：query_json")
const q1 = await QUERY.execute({ path: "address.city", text: userJson })
check("点路径取值", q1 === "Beijing")
const q2 = await QUERY.execute({ path: "tags.0", text: userJson })
check("数组下标取值", q2 === "admin")
const q3 = await QUERY.execute({ path: "tags[*]", text: userJson })
check("通配展开数组", q3.includes("admin") && q3.includes("dev"))
check("无匹配提示", (await QUERY.execute({ path: "no.such.path", text: userJson })).includes("无匹配结果"))
const usersYaml = "users:\n  - name: A\n    age: 1\n  - name: B\n    age: 2\n"
const q4 = await QUERY.execute({ path: "users[*].name", text: usersYaml })
check("YAML 通配查询", q4.includes("A") && q4.includes("B"))
// queryPath 单元级：嵌套通配
const nested = { a: [{ b: [1, 2] }, { b: [3] }] }
const r = queryPath(nested, "a[*].b[*]")
check("嵌套通配扁平展开", JSON.stringify(r) === "[1,2,3]")

// 场景 3：validate_schema
console.log("\n场景 3：validate_schema")
const schema = JSON.stringify({
  type: "object",
  properties: { name: { type: "string" }, age: { type: "integer", minimum: 0 } },
  required: ["name"],
})
check("校验通过", (await VALID.execute({ data: userJson, schema })).includes("✅"))
const bad = await VALID.execute({
  data: JSON.stringify({ age: -1 }),
  schema,
})
check("校验失败列出错误", bad.includes("❌") && bad.includes("required property 'name'") && bad.includes(">= 0"))
const badYaml = await VALID.execute({ data: "name: 123", schema })
check("YAML 数据自动嗅探校验", badYaml.includes("❌") && badYaml.includes("must be string"))
// YAML schema
const yamlSchema = "type: object\nrequired:\n  - name\n"
check("YAML schema 可用", (await VALID.execute({ data: userJson, schema: yamlSchema })).includes("✅"))
try {
  await VALID.execute({ data: userJson, schema: "not-json{" })
  check("非法 schema 报错（未触发）", false)
} catch (e) { check("非法 schema 报错", e.message.includes("schema")) }

forceRm(work)
console.log(`\n${"=".repeat(40)}`)
console.log(`测试完成: ${passed} 通过, ${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)

function forceRm(dir) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) }
  catch { console.log(`  ⚠ 临时目录清理失败（不影响测试结果）: ${dir}`) }
}
