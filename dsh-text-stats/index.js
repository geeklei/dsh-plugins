import { defineTool } from "@deepseek-ai/dsh-tools"

export const name = "text-stats"
export const inject = ["tools"]

/** Maximum chars accepted by text_stats before the pre-execute gate denies the call. */
const MAX_TEXT_CHARS = 100_000
/** Maximum words accepted by text_stats before the pre-execute gate denies the call. */
const MAX_TEXT_WORDS = 200_000
/** How many recent results the tools/result observer keeps in memory. */
const RECENT_RESULTS = 20

function agentId(exec) {
  return exec.agent ? String(exec.agent.id) : "unknown"
}

export function apply(ctx) {
  // Lifecycle hooks: log when the plugin starts and stops.
  ctx.on("ready", () => {
    ctx.logger.info("[text-stats] plugin ready")
  })

  ctx.on("dispose", () => {
    ctx.logger.info("[text-stats] plugin disposed")
  })

  // Shared observation state updated by the hooks below;
  // readable by other plugins via ctx.textStats.
  const stats = {
    calls: 0,
    denied: 0,
    failed: 0,
    chars: 0,
    totalMs: 0,
    recent: [],
  }
  ctx.textStats = stats

  // tools/pre-execute: audit every call and gate oversized text_stats input.
  ctx.on("tools/pre-execute", async (exec, next) => {
    const args = exec.arguments ?? {}
    ctx.logger.debug(`[text-stats] pre-execute ${exec.name} agent=${agentId(exec)}`)

    if (exec.name === "text_stats") {
      const text = String(args.text ?? "")
      if (text.length > MAX_TEXT_CHARS) {
        stats.denied += 1
        return {
          kind: "deny",
          reason: `text_stats input too large: ${text.length} chars (max ${MAX_TEXT_CHARS}).`,
        }
      }
      const words = text.trim() ? text.trim().split(/\s+/).length : 0
      if (words > MAX_TEXT_WORDS) {
        stats.denied += 1
        return {
          kind: "deny",
          reason: `text_stats input too large: ${words} words (max ${MAX_TEXT_WORDS}).`,
        }
      }
    }

    return next()
  })

  // tools/execute: measure dispatch wall time for text_stats (metrics pattern).
  ctx.on("tools/execute", async (exec, next) => {
    if (exec.name !== "text_stats") return next()
    const started = performance.now()
    try {
      return await next()
    } finally {
      stats.totalMs += performance.now() - started
    }
  })

  // tools/result: observe frozen outcomes, keep counters and a bounded history.
  ctx.on("tools/result", (exec, result) => {
    stats.calls += 1
    if (result.isError) stats.failed += 1

    stats.recent.push({
      name: exec.name,
      agent: agentId(exec),
      at: new Date().toISOString(),
      ok: !result.isError,
      summary: result.isError
        ? result.error.message
        : JSON.stringify(result.value).slice(0, 120),
    })
    if (stats.recent.length > RECENT_RESULTS) stats.recent.shift()

    if (exec.name === "text_stats" && !result.isError) {
      const text = String(exec.arguments?.text ?? "")
      stats.chars += text.length
      ctx.logger.debug(`[text-stats] result ok chars=${text.length}`)
    }
  })

  ctx.tools.register(defineTool({
    name: "text_stats",
    description: "Count characters, lines, words and bytes, then estimate token usage of the given text.",
    parameters: {
      text: {
        type: "string",
        required: true,
        description: "The text to inspect.",
      },
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: value }],
    },
    async execute(args) {
      const text = String(args.text ?? "")
      const chars = [...text].length
      const bytes = Buffer.byteLength(text, "utf8")
      const lines = text.length === 0 ? 0 : text.split(/\r?\n/).length
      const words = text.trim() ? text.trim().split(/\s+/).length : 0
      const tokens = Math.ceil(bytes / 4)

      return [
        `Characters: ${chars}`,
        `Bytes: ${bytes}`,
        `Lines: ${lines}`,
        `Words: ${words}`,
        `Estimated tokens: ${tokens}`,
      ].join("\n")
    },
  }))
}