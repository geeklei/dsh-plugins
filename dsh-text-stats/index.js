import { defineTool } from "@deepseek-ai/dsh-tools"

export const name = "text-stats"
export const inject = ["tools"]

/** Maximum chars accepted by text_stats before the pre-execute gate denies the call. */
const MAX_TEXT_CHARS = 100_000
/** How many recent results the tools/result observer keeps in memory. */
const RECENT_RESULTS = 20

/** Estimated tokens per CJK character (empirical, most tokenizers fit ~1.5-2 chars/token). */
const TOKENS_PER_CJK = 0.6
/** Estimated tokens per non-CJK character (ASCII-heavy text averages ~4 chars/token). */
const TOKENS_PER_OTHER = 0.25
/** CJK unified ideographs: extension A, main block, compatibility ideographs. */
function isCjk(codePoint) {
  return (
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff)
  )
}

/** Code-point count (matches the tool's "Characters" semantics, not UTF-16 length). */
function codePointLength(text) {
  let n = 0
  for (const _ of text) n += 1
  return n
}

/** Weighted token estimate: CJK chars cost more than ASCII ones. */
function estimateTokens(text) {
  let tokens = 0
  for (const ch of text) {
    tokens += isCjk(ch.codePointAt(0)) ? TOKENS_PER_CJK : TOKENS_PER_OTHER
  }
  return Math.ceil(tokens)
}

function computeStats(text) {
  const chars = [...text].length
  const bytes = Buffer.byteLength(text, "utf8")
  const lines = text.length === 0 ? 0 : text.split(/\r?\n/).length
  const nonEmptyLines = text.split(/\r?\n/).filter((l) => l.trim().length > 0).length
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  let cjk = 0
  let whitespace = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0)
    // whitespace check first: ideographic space U+3000 is both CJK-block-adjacent and whitespace
    if (/\s/.test(ch)) whitespace += 1
    else if (isCjk(cp)) cjk += 1
  }
  const nonAscii = chars - [...text].filter((ch) => ch.codePointAt(0) < 0x80).length
  return {
    chars,
    bytes,
    lines,
    nonEmptyLines,
    emptyLines: lines - nonEmptyLines,
    words,
    cjkChars: cjk,
    nonAsciiChars: nonAscii,
    whitespaceChars: whitespace,
    estimatedTokens: estimateTokens(text),
  }
}

function renderSummary(s) {
  return [
    `Characters: ${s.chars}`,
    `Bytes: ${s.bytes}`,
    `Lines: ${s.lines}`,
    `Words: ${s.words}`,
    `Estimated tokens: ${s.estimatedTokens}`,
  ].join("\n")
}

function renderDetailed(s) {
  return [
    `Characters: ${s.chars}`,
    `  CJK chars: ${s.cjkChars}`,
    `  Non-ASCII chars: ${s.nonAsciiChars}`,
    `  Whitespace chars: ${s.whitespaceChars}`,
    `Bytes: ${s.bytes}`,
    `Lines: ${s.lines} (non-empty: ${s.nonEmptyLines}, empty: ${s.emptyLines})`,
    `Words: ${s.words}`,
    `Estimated tokens: ${s.estimatedTokens} (CJK-weighted estimate, not a real tokenizer)`,
  ].join("\n")
}

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
    deniedByChars: 0,
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
      // code-point length, consistent with the tool's "Characters" output
      const textChars = codePointLength(text)
      if (textChars > MAX_TEXT_CHARS) {
        stats.denied += 1
        stats.deniedByChars += 1
        return {
          kind: "deny",
          reason: `text_stats input too large: ${textChars} chars (max ${MAX_TEXT_CHARS}). Split the text into smaller chunks and call text_stats per chunk.`,
        }
      }
      // Note: a word-count gate is unnecessary because words <= chars <= MAX_TEXT_CHARS.
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
      chars: exec.name === "text_stats" ? codePointLength(String(exec.arguments?.text ?? "")) : undefined,
      summary: result.isError
        ? result.error?.message ?? "unknown error"
        : JSON.stringify(result.value).slice(0, 120),
    })
    if (stats.recent.length > RECENT_RESULTS) stats.recent.shift()

    if (exec.name === "text_stats" && !result.isError) {
      const text = String(exec.arguments?.text ?? "")
      stats.chars += codePointLength(text)
      ctx.logger.debug(`[text-stats] result ok chars=${stats.chars}`)
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
      mode: {
        type: "string",
        description: 'Output detail level: "summary" (default), "detailed" (char breakdown + line breakdown) or "json" (structured object).',
      },
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: value }],
    },
    async execute(args) {
      const text = String(args.text ?? "")
      const mode = args.mode === "detailed" || args.mode === "json" ? args.mode : "summary"
      const stats = computeStats(text)
      if (mode === "json") return JSON.stringify(stats)
      if (mode === "detailed") return renderDetailed(stats)
      return renderSummary(stats)
    },
  }))
}