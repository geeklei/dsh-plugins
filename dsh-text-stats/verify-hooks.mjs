import { apply } from "./index.js"

const listeners = {}
const registered = []
const logs = []

const ctx = {
  logger: new Proxy({}, {
    get: (_target, level) => (message) => logs.push([level, message]),
  }),
  on(event, listener) {
    (listeners[event] ??= []).push(listener)
  },
  effect(fn) {
    fn()
  },
  tools: {
    register(tool) {
      registered.push(tool)
    },
  },
}

apply(ctx)

function assert(condition, label) {
  if (!condition) {
    console.error(`FAIL: ${label}`)
    process.exitCode = 1
  } else {
    console.log(`ok: ${label}`)
  }
}

assert(registered.length === 1, "tool registered")
assert(registered[0].name === "text_stats", "tool name is text_stats")

const pre = listeners["tools/pre-execute"]
const execHook = listeners["tools/execute"]
const resultHook = listeners["tools/result"]
assert(pre?.length === 1, "pre-execute listener registered")
assert(execHook?.length === 1, "execute listener registered")
assert(resultHook?.length === 1, "result listener registered")
assert(listeners["ready"]?.length === 1, "ready listener registered")
assert(listeners["dispose"]?.length === 1, "dispose listener registered")

const nextAllow = async () => ({ kind: "allow" })

// pre-execute: small text_stats input passes through to next()
const small = { name: "text_stats", arguments: { text: "hello world" }, agent: { id: "a1" } }
const allow = await pre[0](small, nextAllow)
assert(allow.kind === "allow", "small text_stats input allowed")

// pre-execute: oversized input is denied with a reason
const big = { name: "text_stats", arguments: { text: "x".repeat(100_001) } }
const deny = await pre[0](big, nextAllow)
assert(deny.kind === "deny" && deny.reason.includes("too large"), "oversized input denied with reason")

// pre-execute: other tools delegate via next()
const other = { name: "other_tool", arguments: {} }
const delegated = await pre[0](other, nextAllow)
assert(delegated.kind === "allow", "non-text_stats call delegates to next()")

// execute: timing wrapper still runs the body and returns its result
let ran = false
const nextExec = async () => {
  ran = true
  return { isError: false, value: "ok" }
}
const out = await execHook[0]({ name: "text_stats", arguments: { text: "abc" } }, nextExec)
assert(ran && out.value === "ok", "execute wrapper ran through and returned result")

// execute: non-text_stats passes through untouched
let otherRan = false
const out2 = await execHook[0]({ name: "other_tool" }, async () => {
  otherRan = true
  return { isError: false, value: "x" }
})
assert(otherRan && out2.value === "x", "execute wrapper passes other tools through")

// result: success and failure are observed in counters + history
resultHook[0](
  { name: "text_stats", arguments: { text: "hello" }, agent: { id: "a1" } },
  { isError: false, value: "Characters: 5\n" },
)
resultHook[0](
  { name: "text_stats", arguments: { text: "boom" } },
  { isError: true, error: { message: "kaboom" } },
)
assert(ctx.textStats.calls === 2, "result observer counted 2 calls")
assert(ctx.textStats.failed === 1, "result observer counted 1 failure")
assert(ctx.textStats.chars === 5, "result observer accumulated 5 chars")
assert(ctx.textStats.recent.length === 2, "result history has 2 entries")
assert(ctx.textStats.recent[0].chars === 5, "history entry carries chars field")
assert(ctx.textStats.recent[0].ok === true && ctx.textStats.recent[1].ok === false, "history entries carry ok flag")

// tools/result history is bounded (RECENT_RESULTS = 20)
for (let i = 0; i < 25; i++) {
  resultHook[0](
    { name: "text_stats", arguments: { text: "x" } },
    { isError: false, value: "Characters: 1" },
  )
}
assert(ctx.textStats.recent.length === 20, "result history is bounded at 20")

// ready/dispose lifecycle listeners fire without throwing
listeners["ready"][0]()
listeners["dispose"][0]()
assert(logs.some(([level, msg]) => level === "info" && msg.includes("ready")), "ready logged")
assert(logs.some(([level, msg]) => level === "info" && msg.includes("disposed")), "dispose logged")

// tool body: summary mode (default) still works
const value = await registered[0].execute({ text: "hi\nworld" }, { signal: new AbortController().signal })
assert(value.includes("Characters: 8") && value.includes("Words: 2"), "tool body still computes stats")

// tool body: deny counters expose split reasons
assert(ctx.textStats.denied === 1 && ctx.textStats.deniedByChars === 1, "deny counters split by chars/words")

// word-limit gate removed: oversized-words-but-small-chars input is impossible (words <= chars),
// so any text that passes the chars gate also passes the (former) words gate
const wordy = await pre[0]({ name: "text_stats", arguments: { text: "w ".repeat(50_000) } }, nextAllow)
assert(wordy.kind === "allow", "50k words within chars limit allowed (word gate removed)")

// tool body: detailed mode exposes char breakdown for CJK/mixed text
const mixed = "你好 world!\n\n你好"
const detailed = await registered[0].execute({ text: mixed, mode: "detailed" }, { signal: new AbortController().signal })
assert(detailed.includes("CJK chars: 4"), "detailed mode counts CJK chars")
assert(detailed.includes("Non-ASCII chars: 4"), "detailed mode counts non-ASCII chars")
assert(detailed.includes("non-empty: 2, empty: 1"), "detailed mode breaks down lines")

// tool body: json mode returns a structured object
const jsonRaw = await registered[0].execute({ text: mixed, mode: "json" }, { signal: new AbortController().signal })
const parsed = JSON.parse(jsonRaw)
assert(parsed.chars === 13 && parsed.lines === 3 && parsed.words === 3, "json mode returns structured stats")
assert(parsed.cjkChars === 4 && parsed.emptyLines === 1, "json mode includes new fields")
assert(parsed.estimatedTokens === 5, "json mode includes CJK-weighted token estimate")

// token estimate: CJK-weighted, higher than old bytes/4 for Chinese text
const zh = await registered[0].execute({ text: "你好世界" }, { signal: new AbortController().signal })
const zhTokens = Number(zh.match(/Estimated tokens: (\d+)/)[1])
assert(zhTokens === 3, "CJK-weighted token estimate for pure Chinese text")

// unknown mode falls back to summary
const fallback = await registered[0].execute({ text: "hi", mode: "bogus" }, { signal: new AbortController().signal })
assert(fallback.includes("Characters: 2"), "unknown mode falls back to summary")

// regression: surrogate-pair text inside the chars limit is allowed (gate uses code points now)
const emoji = "\u{1F600}".repeat(60_000)
const emojiGate = await pre[0]({ name: "text_stats", arguments: { text: emoji } }, nextAllow)
assert(emojiGate.kind === "allow", "60k emoji (120k utf-16 units) allowed under 100k code-point gate")
const emojiJson = JSON.parse(await registered[0].execute({ text: emoji, mode: "json" }, { signal: new AbortController().signal }))
assert(emojiJson.chars === 60_000, "emoji counted as code points")

// regression: ideographic space U+3000 counts as whitespace, not CJK
const jpSpace = JSON.parse(await registered[0].execute({ text: "\u3000", mode: "json" }, { signal: new AbortController().signal }))
assert(jpSpace.whitespaceChars === 1 && jpSpace.cjkChars === 0, "U+3000 counted as whitespace not CJK")

// regression: fullwidth latin and halfwidth katakana are not CJK
const fw = JSON.parse(await registered[0].execute({ text: "\uFF21\uFF66", mode: "json" }, { signal: new AbortController().signal }))
assert(fw.cjkChars === 0, "fullwidth latin / halfwidth katakana not counted as CJK")

// regression: failed result without error object does not throw
resultHook[0]({ name: "text_stats", arguments: { text: "x" } }, { isError: true })
assert(ctx.textStats.recent[ctx.textStats.recent.length - 1].summary === "unknown error", "missing error object yields unknown error summary")
const blocks = registered[0].output.render({ text: "hi" }, value)
assert(Array.isArray(blocks) && blocks[0].type === "text" && blocks[0].text === value, "output render still works")

console.log("\ndone")