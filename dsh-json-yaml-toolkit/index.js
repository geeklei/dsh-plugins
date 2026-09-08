import { defineTool } from "@deepseek-ai/dsh-tools"
import YAML from "yaml"
import TOML from "smol-toml"
import Ajv from "ajv"
import { readFileSync, existsSync, statSync } from "node:fs"
import { resolve, isAbsolute, sep } from "node:path"

export const name = "json-yaml-toolkit"
export const inject = ["tools"]

// ---------------------------------------------------------------------------
// 配置与基础设施
// ---------------------------------------------------------------------------
const MAX_INPUT_SIZE = 1024 * 1024 // 1MB 输入上限
const OUTPUT_LIMIT = 10000 // 输出截断阈值（字符）
const FORMATS = ["json", "yaml", "toml"]
const ajv = new Ajv({ allErrors: true, strict: false })

function safePath(p) {
  if (!p || typeof p !== "string") throw new Error("path 参数必须是字符串")
  const abs = isAbsolute(p) ? resolve(p) : resolve(process.cwd(), p)
  const root = resolve(process.cwd())
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`拒绝访问：路径 "${p}" 在工作目录之外。`)
  }
  return abs
}

function readTarget(p) {
  const abs = safePath(p)
  if (!existsSync(abs)) throw new Error(`文件不存在: ${abs}`)
  const st = statSync(abs)
  if (!st.isFile()) throw new Error(`目标不是普通文件: ${abs}`)
  if (st.size > MAX_INPUT_SIZE) {
    throw new Error(`文件过大（${(st.size / 1024 / 1024).toFixed(1)}MB，上限 1MB）。`)
  }
  return readFileSync(abs, "utf8")
}

/** 解析输入：format 缺省时自动嗅探 */
function parseInput(text, format) {
  if (format && !FORMATS.includes(format)) {
    throw new Error(`无效格式: "${format}"。可选: ${FORMATS.join(", ")}`)
  }
  const fmt = format || sniffFormat(text)
  try {
    if (fmt === "yaml") return YAML.parse(text)
    if (fmt === "toml") return TOML.parse(text)
    return JSON.parse(text)
  } catch (e) {
    throw new Error(`按 ${fmt.toUpperCase()} 解析失败: ${String(e.message).split("\n")[0]}`)
  }
}

/** 格式嗅探：JSON 首字符 { [ " 数字或 true/false/null；TOML 看 [section] 或 key = ；其余按 YAML */
export function sniffFormat(text) {
  const t = text.trim()
  if (/^[[{"]/.test(t) || /^-?\d/.test(t) || /^(true|false|null)\b/.test(t)) {
    try {
      JSON.parse(t)
      return "json"
    } catch {
      // 继续嗅探
    }
  }
  if (/^\s*\[\[?[^\]]+\]?\]\s*$/.test(t.split("\n")[0].trim()) || /^\s*[\w"'.-]+\s*=\s*/m.test(t)) {
    return "toml"
  }
  return "yaml"
}

/** 序列化为目标格式 */
function stringifyOutput(data, format) {
  if (format === "yaml") return YAML.stringify(data)
  if (format === "toml") return TOML.stringify(data)
  return JSON.stringify(data, null, 2)
}

function truncate(text) {
  if (text.length <= OUTPUT_LIMIT) return text
  return text.slice(0, OUTPUT_LIMIT) + `\n\n[输出已截断，完整长度 ${text.length} 字符]`
}

/**
 * 点路径查询：a.b.0.c 支持数组下标；"a.b[*].c" 通配展开数组。
 * 返回匹配值数组；路径段不存在时返回空数组（查询语义，不报错）。
 */
export function queryPath(data, path) {
  const segs = path.split(".").filter((s) => s !== "")
  let current = [data]
  for (const seg of segs) {
    const next = []
    for (const node of current) {
      if (node == null) continue
      if (seg.endsWith("[*]")) {
        const key = seg.slice(0, -3)
        const arr = key === "" ? node : node[key]
        if (Array.isArray(arr)) next.push(...arr)
      } else if (Array.isArray(node) && /^\d+$/.test(seg)) {
        const v = node[Number(seg)]
        if (v !== undefined) next.push(v)
      } else if (typeof node === "object" && seg in node) {
        next.push(node[seg])
      }
    }
    current = next
  }
  return current
}

// ---------------------------------------------------------------------------
// 工具注册
// ---------------------------------------------------------------------------
export function apply(ctx) {
  // 1. convert_format --------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: "convert_format",
      description:
        "JSON/YAML/TOML 互转。源内容来自 text（优先）或 file（工作目录内路径）；源格式缺省时自动嗅探。TOML 不支持顶层嵌套数组与 null，转换含这些结构的 TOML 输出会给出警告。",
      parameters: {
        to: {
          type: "string",
          description: "目标格式：json / yaml / toml",
          required: true,
        },
        text: {
          type: "string",
          description: "源内容字符串（与 file 二选一，text 优先）",
        },
        file: {
          type: "string",
          description: "源文件路径（工作目录内，与 text 二选一）",
        },
        from: {
          type: "string",
          description: "可选，源格式（缺省自动嗅探）",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        if (!FORMATS.includes(args.to)) {
          throw new Error(`无效目标格式: "${args.to}"。可选: ${FORMATS.join(", ")}`)
        }
        let text
        if (args.text != null && args.text !== "") {
          text = String(args.text)
        } else if (args.file) {
          text = readTarget(args.file)
        } else {
          throw new Error("请提供 text 或 file 之一作为源内容。")
        }
        const data = parseInput(text, args.from)
        if (data == null) throw new Error("源内容解析结果为空，无法转换。")

        const warnings = []
        if (args.to === "toml") {
          const roundTrip = TOML.parse(TOML.stringify(data))
          const a = JSON.stringify(data)
          const b = JSON.stringify(roundTrip)
          if (a !== b) {
            warnings.push("⚠ TOML 对顶层嵌套数组/null 等结构支持有限，输出经往返校验存在信息损失，请人工核对。")
          }
        }
        const out = stringifyOutput(data, args.to)
        const head = warnings.length > 0 ? warnings.join("\n") + "\n\n" : ""
        return head + truncate(out)
      },
    })
  )

  // 2. query_json ------------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: "query_json",
      description:
        '用点路径查询结构化数据："a.b.0.c" 取字段与数组下标，"users[*].name" 通配展开数组。源来自 text（优先）或 file，格式自动嗅探。返回 JSON 值列表；单值时直接返回该值。',
      parameters: {
        path: {
          type: "string",
          description: '点路径，如 "config.port"、"users[*].name"、"items.0.id"',
          required: true,
        },
        text: {
          type: "string",
          description: "源内容字符串（与 file 二选一）",
        },
        file: {
          type: "string",
          description: "源文件路径（工作目录内，与 text 二选一）",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        let text
        if (args.text != null && args.text !== "") text = String(args.text)
        else if (args.file) text = readTarget(args.file)
        else throw new Error("请提供 text 或 file 之一作为源内容。")
        const data = parseInput(text)
        const pathStr = String(args.path ?? "").trim()
        if (!pathStr) throw new Error("path 不能为空。")
        const results = queryPath(data, pathStr)
        if (results.length === 0) {
          return `路径 "${pathStr}" 无匹配结果（0 项）。`
        }
        if (results.length === 1) {
          return truncate(typeof results[0] === "string" ? results[0] : JSON.stringify(results[0], null, 2))
        }
        const rendered = results.map((r, i) => `${i}. ${typeof r === "string" ? r : JSON.stringify(r)}`)
        return truncate(`共 ${results.length} 项:\n` + rendered.join("\n"))
      },
    })
  )

  // 3. validate_schema -------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: "validate_schema",
      description:
        "用 JSON Schema (draft-07+) 校验数据。data 为 JSON 字符串，schema 为 JSON Schema 对象或其 JSON 字符串。校验失败时列出全部错误路径与原因。",
      parameters: {
        data: {
          type: "string",
          description: "待校验的 JSON 字符串（或 yaml/toml，自动嗅探）",
          required: true,
        },
        schema: {
          type: "string",
          description: "JSON Schema（JSON 字符串或对象字面量）",
          required: true,
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        const schemaText = String(args.schema ?? "")
        let schema
        try {
          schema = JSON.parse(schemaText)
        } catch {
          try {
            schema = YAML.parse(schemaText)
          } catch {
            throw new Error("schema 不是合法的 JSON/YAML。")
          }
        }
        if (!schema || typeof schema !== "object") {
          throw new Error("schema 必须是对象形式的 JSON Schema。")
        }
        let dataObj
        try {
          dataObj = JSON.parse(String(args.data))
        } catch {
          dataObj = parseInput(String(args.data))
        }
        const validate = ajv.compile(schema)
        const ok = validate(dataObj)
        if (ok) return "✅ 校验通过：数据符合 schema。"
        const lines = validate.errors.map(
          (e) => `  - ${e.instancePath || "/"} ${e.message}`
        )
        return `❌ 校验失败（${validate.errors.length} 处）:\n${lines.join("\n")}`
      },
    })
  )
}
