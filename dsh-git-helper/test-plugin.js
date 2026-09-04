// dsh-git-helper 测试脚本：mock ctx.tools.register，在临时 git 仓库中验证 5 个工具
import { apply, name, inject } from "./index.js"
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync, statSync, chmodSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"

let passed = 0
let failed = 0

function check(name_, condition) {
  if (condition) {
    console.log(`  ✅ ${name_}`)
    passed += 1
  } else {
    console.log(`  ❌ ${name_}`)
    failed += 1
  }
}

// ---------------------------------------------------------------------------
// 搭建临时 git 仓库
// ---------------------------------------------------------------------------
const repo = mkdtempSync(join(tmpdir(), "dsh-git-helper-test-"))
process.chdir(repo)

function git(...args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" })
}

git("init", "-b", "main")
git("config", "user.name", "Test User")
git("config", "user.email", "test@example.com")
writeFileSync(join(repo, "a.txt"), "hello world\n")
git("add", "a.txt")
git("commit", "-m", "init commit")
writeFileSync(join(repo, "a.txt"), "hello world changed\n")
writeFileSync(join(repo, "b.txt"), "untracked file\n")

// ---------------------------------------------------------------------------
// 注册工具
// ---------------------------------------------------------------------------
const registered = {}
apply({
  tools: {
    register(tool) {
      registered[tool.name] = tool
    },
  },
})

console.log(`插件名: ${name}, inject: ${inject.join(", ")}`)
check("注册了 5 个工具", Object.keys(registered).length === 5)
check("包含 git_status", !!registered.git_status)
check("包含 git_diff", !!registered.git_diff)
check("包含 git_log", !!registered.git_log)
check("包含 git_branch", !!registered.git_branch)
check("包含 git_commit", !!registered.git_commit)

const T = registered

// 场景 1：git_status -------------------------------------------------------
console.log("\n场景 1：git_status 识别三类状态")
const statusOut = await T.git_status.execute({})
check("识别当前分支 main", statusOut.includes("main"))
check("识别未暂存修改", statusOut.includes("未暂存的修改") && statusOut.includes("a.txt"))
check("识别未跟踪文件", statusOut.includes("未跟踪文件") && statusOut.includes("b.txt"))
check("无合并冲突提示", !statusOut.includes("合并冲突"))

// 场景 2：git_diff ---------------------------------------------------------
console.log("\n场景 2：git_diff 输出差异")
const diffOut = await T.git_diff.execute({})
check("显示未暂存差异", diffOut.includes("hello world changed") || diffOut.includes("-hello"))
check("不含暂存差异（暂存区为空）", !diffOut.includes("index 0000000"))
const stagedDiff = await T.git_diff.execute({ scope: "staged" })
check("暂存区为空时提示无差异", stagedDiff.includes("没有差异内容"))
// 暂存后 staged diff 应有内容
git("add", "a.txt")
const stagedDiff2 = await T.git_diff.execute({ scope: "staged" })
check("暂存后 staged diff 有内容", stagedDiff2.includes("hello world changed"))
const commitDiff = await T.git_diff.execute({ scope: "commit", commit: "HEAD" })
check("scope=commit 查看提交差异", commitDiff.includes("init commit") === false && commitDiff.includes("+hello"))
check("scope=commit 缺 commit 参数时报错", await T.git_diff
  .execute({ scope: "commit" })
  .catch((e) => e.message.includes("commit 参数")))

// 场景 3：git_log ----------------------------------------------------------
console.log("\n场景 3：git_log 历史记录")
const logOut = await T.git_log.execute({})
check("包含提交短哈希与作者", /#{0}[0-9a-f]{7,} \| Test User \|/.test(logOut))
check("包含提交标题", logOut.includes("init commit"))
const logLimit = await T.git_log.execute({ limit: 1 })
check("limit 生效（1 条提交）", logLimit.trim().split("\n").length === 1)

// 场景 4：git_branch -------------------------------------------------------
console.log("\n场景 4：git_branch 分支概览")
const branchOut = await T.git_branch.execute({})
check("显示当前分支标记", branchOut.includes("*"))
check("显示 main 分支", branchOut.includes("main"))

// 场景 5：git_commit 防护与正常路径 ---------------------------------------
console.log("\n场景 5：git_commit 三重防护")
try {
  await T.git_commit.execute({ message: "空提交测试" })
  check("暂存区为空时拒绝提交（未触发）", false)
} catch (e) {
  check("暂存区为空时拒绝提交", e.message.includes("暂存区为空"))
}
try {
  await T.git_commit.execute({ message: "x".repeat(80), add_all: true })
  check("首行超 72 字符被拒绝（未触发）", false)
} catch (e) {
  check("首行超 72 字符被拒绝", e.message.includes("72"))
}
// 用未跟踪文件测试 add_all 提交路径
const commitOut = await T.git_commit.execute({
  message: "add untracked file b.txt",
  add_all: true,
})
check("提交成功并返回哈希", /提交成功: [0-9a-f]{7,}/.test(commitOut))
check("提交后返回变更统计", commitOut.includes("变更统计"))
check("仓库中新增了提交", git("log", "--oneline").includes("add untracked file b.txt"))
check("add_all 后未跟踪文件已入库", git("status", "--porcelain").trim() === "")

// 场景 6：非仓库目录报错 ----------------------------------------------------
console.log("\n场景 6：非仓库目录友好报错")
const notRepo = mkdtempSync(join(tmpdir(), "dsh-git-helper-norepo-"))
process.chdir(notRepo)
try {
  await T.git_status.execute({})
  check("非仓库目录抛出友好错误（未触发）", false)
} catch (e) {
  check("非仓库目录抛出友好错误", e.message.includes("不是 Git 仓库"))
}
process.chdir(repo)

// ---------------------------------------------------------------------------
// 清理与汇总
// ---------------------------------------------------------------------------
// Windows 下 .git 内部文件为只读，先递归去掉只读属性再删除
function forceRm(dir) {
  try {
    const stack = [dir]
    while (stack.length > 0) {
      const cur = stack.pop()
      let entries = []
      try {
        entries = readdirSync(cur)
      } catch {
        continue
      }
      for (const e of entries) {
        const p = join(cur, e)
        let st
        try {
          st = statSync(p)
        } catch {
          continue
        }
        if (st.isDirectory()) stack.push(p)
        try {
          chmodSync(p, st.isDirectory() ? 0o777 : 0o666)
        } catch {
          // 尽力而为
        }
      }
    }
  } catch {
    // 清理失败不影响测试结果
  }
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  } catch (e) {
    console.log(`  ⚠ 临时目录清理失败（不影响测试结果）: ${dir} - ${e.message}`)
  }
}
forceRm(repo)
forceRm(notRepo)

console.log(`\n${"=".repeat(40)}`)
console.log(`测试完成: ${passed} 通过, ${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)
