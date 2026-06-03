import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type {
  SdkProvider,
  SdkQueryHandle,
  SdkQueryOptions,
  SdkResultMessage,
} from '../sdk-types.js'

// ── Metrics JSON shape (from reasonix run --metrics) ─────────────────

export interface RunMetrics {
  model?: string
  steps?: number
  cost?: number
  prompt_tokens?: number
  completion_tokens?: number
  cache_hit_tokens?: number
  cache_miss_tokens?: number
  duration_ms?: number
  error?: string
}

// ── Cost estimation ───────────────────────────────────────────────────

/**
 * Per-million-token pricing for known DeepSeek model families.
 *
 * Ordered from most-specific prefix to least-specific so that
 * `resolvePricing` matches `deepseek-v4-flash` before `deepseek-v4`.
 */
const MODEL_PRICING: readonly {
  readonly prefix: string
  readonly input: number
  readonly cachedInput: number
  readonly output: number
}[] = [
  { prefix: 'deepseek-v4-flash', input: 0.1, cachedInput: 0.025, output: 0.4 },
  { prefix: 'deepseek-v4-pro', input: 2.0, cachedInput: 0.5, output: 8.0 },
  { prefix: 'deepseek-chat', input: 0.27, cachedInput: 0.07, output: 1.1 },
  { prefix: 'deepseek-reasoner', input: 0.55, cachedInput: 0.14, output: 2.19 },
  { prefix: 'mimo-v2.5-pro', input: 2.0, cachedInput: 0.5, output: 8.0 },
  { prefix: 'mimo-v2-flash', input: 0.1, cachedInput: 0.025, output: 0.4 },
]

/** Fallback pricing when the model name is unrecognised — uses deepseek-chat rates. */
const DEFAULT_PRICING = {
  input: 0.27,
  cachedInput: 0.07,
  output: 1.1,
} as const

/** Resolve per-million-token pricing for the given model name. */
export function resolvePricing(model: string | undefined): {
  input: number
  cachedInput: number
  output: number
} {
  if (model !== undefined) {
    for (const entry of MODEL_PRICING) {
      if (model.startsWith(entry.prefix)) return entry
    }
  }
  return DEFAULT_PRICING
}

/**
 * Estimate USD cost from Reasonix metrics token counts.
 */
export function estimateCostFromTokens(metrics: RunMetrics, model: string | undefined): number {
  // Prefer the cost provided by Reasonix itself
  if (metrics.cost !== undefined && metrics.cost > 0) return metrics.cost

  const promptTokens = metrics.prompt_tokens ?? 0
  const cachedTokens = metrics.cache_hit_tokens ?? 0
  const completionTokens = metrics.completion_tokens ?? 0

  if (promptTokens === 0 && completionTokens === 0) return 0

  const pricing = resolvePricing(model)
  const nonCachedInput = Math.max(0, promptTokens - cachedTokens)

  return (
    (nonCachedInput * pricing.input +
      cachedTokens * pricing.cachedInput +
      completionTokens * pricing.output) /
    1_000_000
  )
}

// ── CLI arg building ──────────────────────────────────────────────────

/** Build reasonix CLI args from batonjs SdkQueryOptions. */
export function buildArgs(prompt: string, options: SdkQueryOptions, metricsPath: string): string[] {
  const args = ['run', '--metrics', metricsPath]

  if (options.model !== undefined) {
    args.push('--model', options.model)
  }

  // Prompt goes last as the positional argument
  args.push(prompt)

  return args
}

// ── Output cleaning ───────────────────────────────────────────────────

// Strip ANSI escape sequences (color codes, dim/bold, etc.)
const ANSI_RE = /\x1b\[[0-9;]*m/g

// Trailing token-usage line: "  · 11067 tok · in 11028 (11008 cached / 20 new) · out 39 (19 reasoning) · ¥0.0003"
const TOKEN_STATS_RE = /\n?\s*·\s*\d+\s*tok\s*·\s*in\s+\d+.*?(?:\$|¥)\s*\d+\.\d+.*$/

/**
 * Clean reasonix stdout to extract the pure response text.
 *
 * Reasonix appends ANSI-colored thinking markers and a token-usage
 * summary line to stdout. This strips them so batonjs gets clean text.
 */
export function cleanOutput(raw: string): string {
  let text = raw.trim()
  // Strip ANSI escape codes first
  text = text.replace(ANSI_RE, '')
  // Remove trailing token stats line
  text = text.replace(TOKEN_STATS_RE, '')
  return text.trim()
}

/**
 * Extract JSON from reasonix output that may contain thinking/reasoning
 * text before the actual JSON response.
 *
 * Strategy: find the first '{' or '[' in the text, match its balanced
 * brackets, and try JSON.parse. If that fails, advance past it and
 * try the next opener.
 */
export function extractJson(text: string): string | null {
  // Try the full text first (fast path)
  const trimmed = text.trim()
  try {
    JSON.parse(trimmed)
    return trimmed
  } catch {
    // continue
  }

  // Try stripping markdown fences first
  const stripped = trimmed
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/, '')
    .trim()
  try {
    JSON.parse(stripped)
    return stripped
  } catch {
    // continue
  }

  // Find JSON inside markdown fences
  const fenceMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/)
  if (fenceMatch?.[1]) {
    try {
      JSON.parse(fenceMatch[1])
      return fenceMatch[1]
    } catch {
      // continue
    }
  }

  // Scan forward: find each '{' or '[', match balanced brackets, try parse
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch !== '{' && ch !== '[') continue

    const open = ch
    const close = open === '{' ? '}' : ']'
    let depth = 0
    let inStr = false
    let esc = false
    let endIdx = -1

    for (let j = i; j < text.length; j++) {
      const c = text[j]!
      if (esc) {
        esc = false
        continue
      }
      if (c === '\\' && inStr) {
        esc = true
        continue
      }
      if (c === '"') {
        inStr = !inStr
        continue
      }
      if (inStr) continue
      if (c === open) depth++
      if (c === close) depth--
      if (depth === 0) {
        endIdx = j
        break
      }
    }

    if (endIdx === -1) continue

    const candidate = text.slice(i, endIdx + 1)
    try {
      JSON.parse(candidate)
      return candidate
    } catch {
      // Move past this opener and try the next one
      continue
    }
  }

  return null
}

// ── Metrics parsing ───────────────────────────────────────────────────

/** Parse the metrics JSON file written by `reasonix run --metrics`. */
export function parseMetrics(metricsPath: string): RunMetrics {
  try {
    const raw = readFileSync(metricsPath, 'utf-8')
    return JSON.parse(raw) as RunMetrics
  } catch {
    return {}
  }
}

// ── Binary resolution ─────────────────────────────────────────────────

/** Resolve the reasonix binary path. Returns 'reasonix' to rely on PATH lookup. */
function resolveBinary(): string {
  return 'reasonix'
}

// ── Adapter factory ───────────────────────────────────────────────────

/**
 * Create an SdkProvider backed by the Reasonix CLI (`reasonix run`).
 *
 * Spawns the Go binary as a child process, pipes the prompt via stdin,
 * captures stdout as the response, and parses `--metrics` output for
 * cost estimation.
 *
 * Design decisions:
 * - Uses `--metrics` temp file for reliable cost/token data.
 * - Cancellation via `SIGTERM` on abort signal.
 * - stdout is captured as the full response text.
 */
export async function createReasonixAdapter(): Promise<SdkProvider> {
  const binary = resolveBinary()

  return {
    query(params: { prompt: string; options: SdkQueryOptions }): SdkQueryHandle {
      const { prompt, options } = params

      // Create a temp directory for the metrics file
      const tmpDir = mkdtempSync(join(tmpdir(), 'batonjs-reasonix-'))
      const metricsPath = join(tmpDir, 'metrics.json')

      const hasSchema = options.outputFormat !== undefined

      // Inject schema instruction into prompt if outputFormat is set
      let effectivePrompt = prompt
      if (hasSchema) {
        const schema = options.outputFormat!.schema
        effectivePrompt = `${prompt}\n\nYou must respond with valid JSON matching this schema (no markdown fences, no explanation, only the JSON):\n${JSON.stringify(schema, null, 2)}`
      }

      const args = buildArgs(effectivePrompt, options, metricsPath)

      const child = spawn(binary, args, {
        cwd: options.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      })

      let stdout = ''
      let stderr = ''
      let settled = false

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })

      // Close stdin — reasonix reads prompt from the positional arg
      child.stdin.end()

      // Wire abort signal
      if (options.abortController?.signal) {
        const signal = options.abortController.signal
        const onAbort = () => {
          if (!settled) {
            child.kill('SIGTERM')
          }
        }
        if (signal.aborted) {
          onAbort()
        } else {
          signal.addEventListener('abort', onAbort, { once: true })
          child.on('close', () => {
            signal.removeEventListener('abort', onAbort)
          })
        }
      }

      // ── Promise → AsyncIterable bridge ─────────────────────────
      async function* iterate(): AsyncGenerator<Record<string, unknown>> {
        const exitCode = await new Promise<number>((resolve) => {
          child.on('close', resolve)
        })

        settled = true

        // Read and parse metrics
        const metrics = parseMetrics(metricsPath)

        // Cleanup temp dir
        try {
          rmSync(tmpDir, { recursive: true, force: true })
        } catch {
          // best effort
        }

        if (exitCode !== 0) {
          const errorMsg = stderr.trim() || `reasonix exited with code ${exitCode}`
          const result: SdkResultMessage = {
            type: 'result',
            subtype: 'error',
            total_cost_usd: estimateCostFromTokens(metrics, options.model),
            errors: [errorMsg],
          }
          yield result as unknown as Record<string, unknown>
          return
        }

        // Success — clean reasonix output
        const resultText = cleanOutput(stdout)
        let structuredOutput: unknown = undefined

        if (hasSchema) {
          const jsonStr = extractJson(resultText)
          if (jsonStr !== null) {
            structuredOutput = JSON.parse(jsonStr)
          }
        }

        const costUsd = estimateCostFromTokens(metrics, options.model ?? metrics.model)

        const result: SdkResultMessage = {
          type: 'result',
          subtype: 'success',
          total_cost_usd: costUsd,
          result: resultText,
          ...(structuredOutput !== undefined && { structured_output: structuredOutput }),
        }
        yield result as unknown as Record<string, unknown>
      }

      const gen = iterate()

      return {
        [Symbol.asyncIterator]: () => gen[Symbol.asyncIterator](),
        interrupt() {
          if (!settled) {
            child.kill('SIGTERM')
          }
        },
        return() {
          if (!settled) {
            child.kill('SIGTERM')
          }
        },
      }
    },
  }
}
