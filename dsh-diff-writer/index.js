import { defineTool } from "@deepseek-ai/dsh-tools"
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs"
import { resolve, isAbsolute, sep } from "node:path"

export const name = "diff-writer"
export const inject = ["tools"]

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------
const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB，超过拒绝读取
const PATCHES_LIMIT = 20 // 单次调用最多应用 20 个补丁

/** 解析并校验目标路径：必须在工作目录内，防止越权写入 */
function safePath(p) {
  if (!p || typeof p !== "string") {
    throw new Error("path 参数必须是字符串")
  }
  const abs = isAbsolute(p) ? resolve(p) : resolve(process.cwd(), p)
  const root = resolve(process.cwd())
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(
      `拒绝访问：路径 "${p}" 在工作目录之外。本工具只允许编辑工作目录内的文件。`
    )
  }
  return abs
}

/** 读取目标文件内容（带大小与存在性校验） */
function readTarget(abs) {
  if (!existsSync(abs)) {
    throw new Error(`文件不存在: ${abs}`)
  }
  const st = statSync(abs)
  if (!st.isFile()) {
    throw new Error(`目标不是普通文件: ${abs}`)
  }
  if (st.size > MAX_FILE_SIZE) {
    throw new Error(
      `文件过大（${(st.size / 1024 / 1024).toFixed(1)}MB，上限 2MB），请改用其他方式处理。`
    )
  }
  return readFileSync(abs, "utf8")
}

/**
 * 应用单个 search/replace 补丁。
 * 返回 { content, applied }；匹配失败时不修改内容，返回错误原因。
 */
function applyOne(content, patch, index) {
  const { search, replace, all } = patch
  if (typeof search !== "string" || search.length === 0) {
    return { error: `第 ${index + 1} 个补丁的 search 不能为空` }
  }
  if (typeof replace !== "string") {
    return { error: `第 ${index + 1} 个补丁缺少 replace（可为空字符串表示删除）` }
  }

  const count = content.split(search).length - 1
  if (count === 0) {
    return { error: `第 ${index + 1} 个补丁的 search 在文件中未找到匹配。请确认内容与文件完全一致（含缩进与换行）。search 前 40 字符: ${JSON.stringify(search.slice(0, 40))}` }
  }
  if (count > 1 && !all) {
    return {
      error: `第 ${index + 1} 个补丁的 search 匹配到 ${count} 处（默认仅替换唯一匹配处）。请扩充 search 上下文使其唯一，或设置 all=true 全量替换。`,
    }
  }
  // 字符串替换不支持查找后向引用，直接按次数替换
  const next = all
    ? content.split(search).join(replace)
    : content.replace(search, () => replace)
  return { content: next, replacements: all ? count : 1 }
}

// ---------------------------------------------------------------------------
// 工具注册
// ---------------------------------------------------------------------------
export function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: "apply_patch",
      description:
        "对文件应用精确的 search/replace 补丁，避免整文件覆盖导致误改。支持一次应用多个补丁（按顺序执行）、all=true 全量替换、create=true 新建文件。所有路径必须位于工作目录内。",
      parameters: {
        path: {
          type: "string",
          description: "目标文件路径（相对或绝对，必须在工作目录内）",
          required: true,
        },
        patches: {
          type: "array",
          description:
            "补丁列表，按顺序应用，每项 { search: string, replace: string, all?: boolean }；search 必须与文件内容精确匹配，默认只替换唯一匹配处，多处匹配时要求扩充上下文或设 all=true",
          required: true,
        },
        create: {
          type: "boolean",
          description: "可选，文件不存在时创建新文件（此时 patches 可为空数组）",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        const abs = safePath(args.path)
        const patches = Array.isArray(args.patches) ? args.patches : []
        if (patches.length > PATCHES_LIMIT) {
          throw new Error(`单次最多应用 ${PATCHES_LIMIT} 个补丁，当前 ${patches.length} 个。请拆分多次调用。`)
        }

        // 创建模式：文件不存在时以空内容起步
        let content
        if (existsSync(abs)) {
          if (args.create) {
            throw new Error(`文件已存在: ${abs}。create=true 仅用于新建文件，编辑已有文件请去掉该参数。`)
          }
          content = readTarget(abs)
        } else if (args.create) {
          content = ""
        } else {
          throw new Error(`文件不存在: ${abs}。如需新建文件请传 create=true。`)
        }

        if (patches.length === 0 && !args.create) {
          throw new Error("patches 不能为空。编辑已有文件至少需要一个补丁。")
        }

        // 顺序应用补丁，任一失败立即中止（前面的补丁不回滚，由调用方决定重试策略）
        let total = 0
        for (let i = 0; i < patches.length; i++) {
          const r = applyOne(content, patches[i], i)
          if (r.error) throw new Error(r.error)
          content = r.content
          total += r.replacements
        }

        mkdirSync(resolve(abs, ".."), { recursive: true })
        writeFileSync(abs, content, "utf8")
        return `已写入 ${abs}: 应用 ${patches.length} 个补丁，共替换 ${total} 处。`
      },
    })
  )
}
