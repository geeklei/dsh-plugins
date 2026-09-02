# Git 分支操作规范

适用仓库：`dsh-plugins`（多插件平级独立包仓库，tag 触发 CI 发布）。
本规范基于本仓库实际工作流沉淀，供所有协作者（包括 AI Agent）遵循。

## 📚 目录

1. [分支模型](#分支模型)
2. [分支命名规范](#分支命名规范)
3. [日常操作流程](#日常操作流程)
4. [发布与 tag 规范](#发布与-tag-规范)
5. [分支生命周期与清理](#分支生命周期与清理)
6. [本仓库专属注意事项](#本仓库专属注意事项)
7. [常见问题排查](#常见问题排查)

## 分支模型

本仓库采用最简单的单主干模型：

- **`main`**：唯一长期分支，始终与 `origin/main` 保持同步，任何时刻都应处于可构建、测试通过的状态
- **功能分支**：短期分支，从最新 `main` 切出，完成后合并回 `main` 并删除
- 不使用 develop / release 等长期分支；多插件平级独立，各插件版本独立演进，不需要集成分支

## 分支命名规范

```
feat/<plugin>-<简述>     新功能，如 feat/text-stats-0.2.0
fix/<plugin>-<简述>      缺陷修复，如 fix/file-manager-path-check
docs/<plugin>-<简述>     纯文档变更
chore/<简述>             构建、CI、依赖等杂项
```

- 建议带插件名前缀（本仓库是多插件仓库，便于一眼定位归属）
- 全小写、用连字符分隔，不放版本号以外特殊字符

## 日常操作流程

### 1. 开始前

```bash
git checkout main
git -c credential.helper=manager pull   # 本仓库推送/拉取需显式指定凭据助手（见后文）
```

### 2. 切出功能分支

```bash
git checkout -b feat/<plugin>-<简述>
```

### 3. 开发与提交

- 提交信息：`type(scope): 简述`，如 `fix(text-stats): 门禁改用码点计数`
- 提交前跑对应插件的测试（如 `node dsh-text-stats/verify-hooks.mjs`）
- 约定：提交信息、README、注释等使用中文

### 4. 合并回 main

```bash
git checkout main
git merge --no-ff feat/<plugin>-<简述> -m "merge: <一句话说明>"
node <plugin>/verify-hooks.mjs   # 合并后复跑测试
```

- 统一使用 `--no-ff` 生成 merge commit，保留功能边界（本仓库历史遵循此惯例）
- 纯文档等单提交改动可直接在 main 上提交，不必开分支

### 5. 推送

```bash
git -c credential.helper=manager push origin main
```

## 发布与 tag 规范

发布由 GitHub Actions 按 tag 触发（`dsh-*@*`），详见 `.github/workflows/npm-publish.yml`。

```bash
cd <插件目录>
# 提升版本号（或手动改 package.json）
npm version patch   # minor / major 视变更性质
git tag "<包名>@$(node -p "require('./package.json').version")"
git push && git push origin <包名>@<新版本号>
```

规则：

- tag 格式必须为 `<包名>@<版本号>`，如 `dsh-text-stats@0.2.0`
- **tag 必须打在包含最新 workflow 的提交上**（GitHub 从 tag 指向的 commit 读取 workflow 文件）
- 发布前确认 `CHANGELOG.md` 已补充对应版本条目
- tag 已发布成功后**不要**重建/强推同名 tag，会导致重复发布

## 分支生命周期与清理

- 功能分支合并回 main 后**立即删除**，不留已合并的僵尸分支
- 删除用 `git branch -d`（安全模式，未合并会被拒绝），禁止使用 `-D` 强删
- 删除前用 `git branch --merged main` 确认；本仓库功能分支只在本地存在，不推送到远程，无需清理远程分支
- 每次开始新任务前，可用 `git branch --merged main` 做一次清理检查

## 本仓库专属注意事项

1. **凭据助手**：无 tty 的会话（脚本 / AI Agent）中直接 `git push` 会挂起，必须用
   `git -c credential.helper=manager push`（凭据管理器已存 GitHub token）
2. **worktree 残留**：会话中途切换分支后，worktree 可能停留在功能分支的旧提交上，
   删除分支会报 `used by worktree`。处理：`git checkout main` 后再删
3. **行尾符**：Windows 环境下 Git 会提示 LF→CRLF 转换，属正常现象；用 edit 工具
   精确修改文件时注意实际行尾可能是 CRLF
4. **根目录不是 pnpm workspace**：各插件目录独立安装依赖，分支操作不涉及根级
   lockfile 合并冲突
5. **CI 中的 publish 脚本**：不要在 package.json 里写 `"publish": "pnpm publish"`
   之类的生命周期脚本，CI 的 `npm publish` 成功后会触发它并导致 Action 报 failure

## 常见问题排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `git push` 卡死无输出 | 无 tty 会话未指定凭据助手 | `git -c credential.helper=manager push` |
| 删除分支报 `used by worktree` | 当前 worktree 停在该分支上 | 先 `git checkout main` 再删 |
| 打了 tag 但 Action 没跑 | tag 没推到远程，或 tag 指向旧 workflow | `git ls-remote --tags origin` 核查 |
| Action 失败但 npm 已有新版本 | publish 后置脚本/检查失败 | 看日志确认发布已成功，修脚本问题，不重发 |
| npm 403 | 包名被抢注 / token 权限不足 | `npm view <pkg> maintainers` 查归属，按踩坑记录排查 |
