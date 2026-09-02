# Git 分支操作速查表

> 详细说明见 [GIT_BRANCH_GUIDE.md](./GIT_BRANCH_GUIDE.md)。完整命令可直接复制执行。

## 日常流

```bash
# ① 开始：同步 main
git checkout main && git -c credential.helper=manager pull

# ② 开发：切功能分支
git checkout -b feat/<plugin>-<简述>

# ③ 提交前：跑对应插件测试
node <plugin>/verify-hooks.mjs

# ④ 合并：--no-ff 保留功能边界
git checkout main
git merge --no-ff feat/<plugin>-<简述> -m "merge: <一句话说明>"
node <plugin>/verify-hooks.mjs        # 合并后复跑

# ⑤ 推送 + 清理分支（合并即删）
git -c credential.helper=manager push origin main
git branch -d feat/<plugin>-<简述>
```

## 发布（tag 触发 CI）

```bash
cd <插件目录>
npm version patch            # 或 minor / major
git tag "<包名>@$(node -p "require('./package.json').version")"
git push && git push origin <包名>@<新版本号>
```

- tag 格式：`<包名>@<版本号>`，必须打在**含最新 workflow 的提交**上
- 发布前先补 `CHANGELOG.md`；发布成功后**不重建/强推**同名 tag

## 提交信息

```
feat(text-stats): 门禁改用码点计数     # type(scope): 中文简述
merge: dsh-text-stats 0.2.0           # merge commit
docs: 新增 xxx 文档
```

## 红线（禁止）

| ❌ 禁止 | ✅ 改为 |
| --- | --- |
| `git branch -D` 强删分支 | `git branch -d`（未合并会拒绝） |
| 直接在 main 上开发新功能 | 切功能分支（纯文档可直接提交） |
| 无 tty 环境 `git push` | `git -c credential.helper=manager push` |
| 重建已发布的 tag | 新版本新 tag |
| package.json 写 `"publish": "pnpm publish"` | 发布直接用 `pnpm publish`，脚本移除 |

## 排查速查

| 现象 | 第一反应 |
| --- | --- |
| `push` 卡死无输出 | 加 `-c credential.helper=manager` 重试 |
| 删分支报 `used by worktree` | `git checkout main` 后再删 |
| 打了 tag 但 Action 没跑 | `git ls-remote --tags origin` 核查 tag 是否在远程、指向是否最新 |
| Action 失败但 npm 已有新版本 | 发布已成功，查后置脚本问题即可，**不要重发** |
| npm 403 | `npm view <pkg> maintainers` 查归属 |
