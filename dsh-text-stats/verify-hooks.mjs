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

// tool body + render still work
const value = await registered[0].execute({ text: "hi\nworld" }, { signal: new AbortController().signal })
assert(value.includes("Characters: 8") && value.includes("Words: 2"), "tool body still computes stats")
const blocks = registered[0].output.render({ text: "hi" }, value)
assert(Array.isArray(blocks) && blocks[0].type === "text" && blocks[0].text === value, "output render still works")

console.log("\ndone")