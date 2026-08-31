// 安全修复回归验证：逐项验证审计报告中漏洞已修复
import { exportSession } from '../dsh-session-exporter/index.js'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const cwd = process.cwd()
let pass = 0, fail = 0
function check(name, cond) {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}`) }
}

const mockCtx = {
  session: { history: [
    { role: 'user', content: '<script>alert("xss")</script> 我的密钥 sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' },
    { role: 'assistant', content: '回复内容' },
  ]},
  tools: { registry: new Map([['t', { name: '<img onerror=alert(1)>', description: '<b>desc</b>', parameters: { properties: {} } }]]) },
  commands: { registry: new Map() },
}

console.log('\n[1] 任意路径写入防护 (Critical #1)')
// 穿越路径必须被拒绝
try {
  await exportSession({ ctx: mockCtx, format: 'txt', outputPath: '../../escape-poc.txt' })
  check('拒绝 ../ 路径穿越写入', false)
} catch (e) {
  check('拒绝 ../ 路径穿越写入', /当前工作目录内/.test(e.message))
}
// 绝对路径必须被拒绝
try {
  await exportSession({ ctx: mockCtx, format: 'txt', outputPath: path.join(os.tmpdir(), 'escape-poc.txt') })
  check('拒绝绝对路径写入', false)
} catch (e) {
  check('拒绝绝对路径写入', /当前工作目录内/.test(e.message))
}
// 根目录内合法路径可写
const ok = await exportSession({ ctx: mockCtx, format: 'txt', outputPath: 'output/verify-ok.txt' })
check('根目录内合法路径可写', /verify-ok\.txt/.test(ok) && (await fs.stat('output/verify-ok.txt')).isFile())

console.log('\n[2] HTML 导出 XSS 防护 (Critical #2)')
const html = await exportSession({ ctx: mockCtx, format: 'html' })
check('会话内容中的 <script> 已转义', !html.includes('<script>alert') && html.includes('&lt;script&gt;'))
check('工具名中的 <img onerror> 已转义', !html.includes('<img onerror') && html.includes('&lt;img'))
check('已注入 CSP 头', html.includes('Content-Security-Policy'))

console.log('\n[3] 敏感信息清理增强 (Medium)')
const txt = await exportSession({ ctx: mockCtx, format: 'txt' })
check('sk- 密钥被清理', !txt.includes('sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ'))
const jsonOut = await exportSession({ ctx: mockCtx, format: 'json', includeMetadata: true })
const meta = JSON.parse(jsonOut).metadata
check('元数据用户名已脱敏', typeof meta.user === 'string' && meta.user.includes('*'))

console.log('\n[4] 符号链接逃逸防护 (High, file-manager)')
const fm = await import('../dsh-file-manager/index.js')
// 直接复用插件内部逻辑较困难（未导出），改为行为级验证：
// 在工作目录建立指向外部的符号链接，调用 fs-mkdir 命令处理函数
const tmpOutside = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-outside-'))
const linkInRoot = path.join(cwd, 'output', 'symlink-escape')
try { await fs.rm(linkInRoot, { recursive: true, force: true }) } catch {}
await fs.symlink(tmpOutside, linkInRoot, 'dir')
let handler = null
const fakeCtx = {
  effect: (fn) => fn(),
  commands: { register: (cmd) => { if (cmd.name === 'fs-mkdir') handler = cmd.handler } },
}
fm.apply(fakeCtx)
const res = await handler({ rawInput: 'output/symlink-escape/evil' })
check('符号链接逃逸被拦截且未创建目录', res.kind === 'error' && !(await fs.stat(path.join(tmpOutside, 'evil')).catch(() => null)))

console.log('\n[5] Windows 保留名校验 (Low)')
const reserved = await handler({ rawInput: 'CON' })
check('CON 被拒绝', reserved.kind === 'error' && /保留名称/.test(reserved.text))

// 清理验证产物
await fs.rm(linkInRoot, { force: true })
await fs.rm(path.join(cwd, 'output', 'verify-ok.txt'), { force: true })
await fs.rm(tmpOutside, { recursive: true, force: true })

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
