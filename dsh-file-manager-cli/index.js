import { mkdir, readdir, realpath, rm, stat, writeFile } from "node:fs/promises"
import { dirname, relative, resolve, sep } from "node:path"

export const name = "file-manager"
export const inject = ["commands"]

const root = resolve(process.cwd())
const canonicalRoot = realpath(root)

function result(kind, text) {
  return { kind, text }
}

// Windows 保留设备名（不区分大小写，含扩展名前缀）
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

function input(rawInput, command) {
  const value = rawInput.trim()
  if (!value || /\s/u.test(value)) {
    return result("error", `用法：/${command} <相对路径>`)
  }
  const segments = value.split(/[\\/]+/u)
  if (segments.some(segment => RESERVED_NAME.test(segment.split(".")[0]))) {
    return result("error", "路径包含系统保留名称")
  }
  return value
}

function insideRoot(value) {
  const target = resolve(root, value)
  const path = relative(root, target)
  if (path === ".." || path.startsWith(`..${sep}`)) {
    throw new Error("路径必须位于 dsh 当前工作目录内")
  }
  return target
}

async function existingInsideRoot(target) {
  const info = await stat(target)
  const actual = await realpath(target)
  const path = relative(await canonicalRoot, actual)
  if (path === ".." || path.startsWith(`..${sep}`)) {
    throw new Error("路径不能通过符号链接离开 dsh 当前工作目录")
  }
  return info
}

// 在创建任何目录/文件之前，沿路径向上找到最深的已存在祖先，
// 并校验其真实路径未通过符号链接离开根目录（目标本身可能尚不存在）
async function ensureAncestorInsideRoot(target) {
  let ancestor = target
  while (true) {
    let actual
    try {
      actual = await realpath(ancestor)
    } catch (error) {
      if (error && error.code === "ENOENT") {
        if (ancestor === root) return // 根本身不存在，交由后续 mkdir 处理
        const parent = dirname(ancestor)
        if (parent === ancestor) throw error
        ancestor = parent
        continue
      }
      throw error
    }
    const path = relative(await canonicalRoot, actual)
    if (path === ".." || path.startsWith(`..${sep}`)) {
      throw new Error("路径不能通过符号链接离开 dsh 当前工作目录")
    }
    return
  }
}

async function list({ rawInput }) {
  const value = input(rawInput, "fs-list")
  if (typeof value !== "string") return value
  try {
    const target = insideRoot(value)
    await existingInsideRoot(target)
    const entries = await readdir(target, { withFileTypes: true })
    const lines = entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(entry => `${entry.isDirectory() ? "[目录]" : "[文件]"} ${entry.name}`)
    return result("success", lines.length ? lines.join("\n") : "(空目录)")
  } catch (error) {
    return result("error", error instanceof Error ? error.message : String(error))
  }
}

async function makeDirectory({ rawInput }) {
  const value = input(rawInput, "fs-mkdir")
  if (typeof value !== "string") return value
  try {
    const target = insideRoot(value)
    await ensureAncestorInsideRoot(target)
    await mkdir(target, { recursive: true })
    await existingInsideRoot(target)
    return result("success", `已创建目录：${value}`)
  } catch (error) {
    return result("error", error instanceof Error ? error.message : String(error))
  }
}

async function touch({ rawInput }) {
  const value = input(rawInput, "fs-touch")
  if (typeof value !== "string") return value
  try {
    const target = insideRoot(value)
    const parent = insideRoot(dirname(value))
    await ensureAncestorInsideRoot(parent)
    await mkdir(parent, { recursive: true })
    await existingInsideRoot(parent)
    await writeFile(target, "", { flag: "a" })
    return result("success", `已创建文件：${value}`)
  } catch (error) {
    return result("error", error instanceof Error ? error.message : String(error))
  }
}

async function remove({ rawInput }) {
  const value = input(rawInput, "fs-rm")
  if (typeof value !== "string") return value
  try {
    const target = insideRoot(value)
    if (target === root) return result("error", "禁止删除插件工作根目录")
    await existingInsideRoot(target)
    await rm(target, { recursive: false })
    return result("success", `已删除：${value}`)
  } catch (error) {
    return result("error", error instanceof Error ? error.message : String(error))
  }
}

export function apply(ctx) {
  const commands = [
    ["fs-list", "列出目录内容", list],
    ["fs-mkdir", "创建目录（可递归创建父目录）", makeDirectory],
    ["fs-touch", "创建空文件", touch],
    ["fs-rm", "删除文件或空目录", remove],
  ]
  for (const [name, description, handler] of commands) {
    ctx.effect(() => ctx.commands.register({
      name,
      description,
      input: { hint: "<相对路径>" },
      handler,
    }))
  }
}
