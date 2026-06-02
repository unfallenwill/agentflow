import Ajv from 'ajv'
import type { AgentContext } from './context.js'
import type { AgentOpts } from '../types.js'
import type { SdkQueryOptions, SdkResultMessage } from './sdk.js'

/** Default timeout for a single agent call (ms) */
const DEFAULT_AGENT_TIMEOUT_MS = 120_000

/** Shared Ajv instance for JSON Schema validation */
const ajv = new Ajv({ allErrors: true })

/** Default max retry attempts for transient errors */
const DEFAULT_MAX_RETRIES = 2

/** Base delay for exponential backoff (ms) */
const RETRY_BASE_DELAY_MS = 1_000

/** Cap for backoff delay (ms) */
const RETRY_MAX_DELAY_MS = 30_000

/** Internal discriminated return from the query IIFE */
type QueryOutput = { ok: true; value: SdkResultMessage | null } | { ok: false; error: string }

/** Query execution result including retry metadata */
interface QueryAttempt {
  output: QueryOutput
  /** Whether the error is retryable (429, network) vs fatal (abort, timeout) */
  retryable: boolean
}

/**
 * Check if an error message indicates a retryable transient failure.
 * Matches rate limiting (429) and common network error patterns.
 */
function isRetryableError(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('429') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('econnreset') ||
    lower.includes('econnrefused') ||
    lower.includes('etimedout') ||
    lower.includes('socket hang up') ||
    lower.includes('network error') ||
    lower.includes('fetch failed')
  )
}

/**
 * Compute exponential backoff delay with jitter.
 * delay = min(base * 2^attempt, maxDelay) * random(0.5, 1.0)
 */
function backoffDelay(attempt: number): number {
  const base = RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
  const capped = Math.min(base, RETRY_MAX_DELAY_MS)
  const jitter = 0.5 + Math.random() * 0.5
  return Math.floor(capped * jitter)
}

/**
 * Execute a single SDK query attempt with timeout protection.
 */
async function executeQueryAttempt(
  sdk: AgentContext['sdk'],
  prompt: string,
  sdkOpts: SdkQueryOptions,
  controller: AbortController,
  timeoutMs: number,
): Promise<QueryAttempt> {
  const TIMEOUT_SENTINEL = Symbol('timeout')
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const q = sdk.query({ prompt, options: { ...sdkOpts, abortController: controller } })

  const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort()
      resolve(TIMEOUT_SENTINEL)
    }, timeoutMs)
  })

  const queryPromise = (async (): Promise<QueryOutput> => {
    try {
      let resultMsg: SdkResultMessage | null = null
      for await (const message of q) {
        if ('type' in message && message['type'] === 'result') {
          resultMsg = message as unknown as SdkResultMessage
        }
      }
      return { ok: true, value: resultMsg }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, error: msg }
    }
  })()

  const raceResult = await Promise.race([queryPromise, timeoutPromise])

  clearTimeout(timeoutId)
  timeoutId = undefined

  // Timeout is never retryable
  if (raceResult === TIMEOUT_SENTINEL) {
    try {
      q.interrupt()
    } catch {
      /* best effort */
    }
    try {
      q.return()
    } catch {
      /* best effort */
    }
    return {
      output: { ok: false, error: `Agent timed out after ${timeoutMs / 1000}s` },
      retryable: false,
    }
  }

  const output = raceResult as QueryOutput
  const retryable = !output.ok && isRetryableError(output.error)
  return { output, retryable }
}

/**
 * Execute a single agent call via the SDK.
 *
 * - Acquires a semaphore slot for the duration of the call.
 * - Passes `schema` as SDK `outputFormat` for structured output.
 * - Tracks spending via BudgetTracker.
 * - Returns `null` on any failure (soft failure pattern).
 * - Times out if the SDK process hangs.
 * - Retries transient errors (429, network) with exponential backoff.
 */
export async function executeAgent<T = unknown>(
  prompt: string,
  opts: AgentOpts | undefined,
  ctx: AgentContext,
): Promise<T | null> {
  const label = opts?.label
  const phase = opts?.phase
  const maxRetries = opts?.maxRetries ?? DEFAULT_MAX_RETRIES

  ctx.bus.emit({ kind: 'agent_start', label, phase })

  const release = await ctx.semaphore.acquire()
  const startTime = Date.now()

  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  let budgetReserved = false
  let reservedAmount = 0

  try {
    // Build SDK options
    const sdkOpts: SdkQueryOptions = {
      permissionMode: ctx.permissionMode ?? 'bypassPermissions',
      abortController: controller,
    }

    if (opts?.schema !== undefined) {
      sdkOpts.outputFormat = { type: 'json_schema', schema: opts.schema }
    }

    // When schema is provided, inject it into the prompt so the model knows
    // the expected output structure. The SDK outputFormat is also set above
    // for forward compatibility, but current SDK versions don't wire it through
    // to the CLI — so the prompt injection is the actual working path.
    let effectivePrompt = prompt
    if (opts?.schema !== undefined) {
      effectivePrompt = `${prompt}\n\nYou must respond with valid JSON matching this schema (no markdown fences, no explanation, only the JSON):\n${JSON.stringify(opts.schema, null, 2)}`
    }

    if (opts?.model !== undefined) {
      sdkOpts.model = opts.model
    } else if (ctx.defaultModel !== undefined) {
      sdkOpts.model = ctx.defaultModel
    }

    if (ctx.cwd !== undefined) {
      sdkOpts.cwd = ctx.cwd
    }

    // ── Budget reservation ──────────────────────────────────────────────
    // For limited budgets: atomically reserve to prevent concurrent overshoot.
    // For unlimited budgets: skip reservation, record cost post-call.
    const isLimited = ctx.budget.remaining() !== null

    if (isLimited) {
      const remaining = ctx.budget.remaining() as number // guaranteed non-null when limited
      if (remaining === 0) {
        ctx.bus.emit({ kind: 'agent_error', label, error: 'Budget insufficient for agent call' })
        return null
      }
      // Reserve the full remaining budget pessimistically
      if (!ctx.budget.tryAcquire(remaining)) {
        ctx.bus.emit({ kind: 'agent_error', label, error: 'Budget insufficient for agent call' })
        return null
      }
      budgetReserved = true
      reservedAmount = remaining
      sdkOpts.maxBudgetUsd = remaining
    }

    // Forward engine-level abort signal
    if (ctx.signal !== undefined) {
      if (ctx.signal.aborted) {
        controller.abort()
      } else {
        onAbort = () => controller.abort()
        ctx.signal.addEventListener('abort', onAbort, { once: true })
      }
    }

    // ── Execute with retry loop ────────────────────────────────────────

    let lastError = ''
    let queryOutput: QueryOutput | undefined

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Check if externally aborted before retrying
      if (controller.signal.aborted) {
        ctx.bus.emit({ kind: 'agent_error', label, error: 'Agent aborted' })
        return null
      }

      const attemptResult = await executeQueryAttempt(
        ctx.sdk,
        effectivePrompt,
        sdkOpts,
        controller,
        DEFAULT_AGENT_TIMEOUT_MS,
      )
      queryOutput = attemptResult.output

      // Success or non-retryable error → exit loop
      if (queryOutput.ok || !attemptResult.retryable) {
        break
      }

      // Retryable error → retry if attempts remain
      lastError = queryOutput.error
      if (attempt < maxRetries) {
        const delay = backoffDelay(attempt)
        ctx.bus.emit({
          kind: 'agent_error',
          label,
          error: `${lastError} (retry ${attempt + 1}/${maxRetries} in ${delay}ms)`,
        })
        // Abort-signal-aware sleep: resolves early if signal fires during backoff
        await new Promise<void>((resolve) => {
          timeoutId = setTimeout(resolve, delay)
          if (controller.signal.aborted) {
            clearTimeout(timeoutId)
            timeoutId = undefined
            resolve()
            return
          }
          const onSleepAbort = () => {
            clearTimeout(timeoutId)
            timeoutId = undefined
            resolve()
          }
          controller.signal.addEventListener('abort', onSleepAbort, { once: true })
        })
        timeoutId = undefined
      }
    }

    // ── Handle final result ────────────────────────────────────────────

    // queryOutput is always set by the loop (at least one iteration runs)
    // but TypeScript can't prove that — use a fallback for type safety
    const finalOutput = queryOutput ?? { ok: false, error: 'No query output' }

    // Handle query error
    if (!finalOutput.ok) {
      ctx.bus.emit({ kind: 'agent_error', label, error: finalOutput.error })
      return null
    }

    const resultMsg = finalOutput.value

    // No result at all
    if (resultMsg === null) {
      ctx.bus.emit({ kind: 'agent_error', label, error: 'No result message received' })
      return null
    }

    // Error subtypes (non-success)
    if (resultMsg.subtype !== 'success') {
      const errors = resultMsg.errors ?? ['Unknown execution error']
      ctx.bus.emit({
        kind: 'agent_error',
        label,
        error: errors.join('; '),
      })
      return null
    }

    // At this point resultMsg is the success variant with .result and .structured_output
    const successMsg = resultMsg as SdkResultMessage & {
      result: string
      structured_output?: unknown
    }

    // Adjust budget: replace reservation with actual cost
    const costUsd = successMsg.total_cost_usd
    if (budgetReserved) {
      ctx.budget.adjust(reservedAmount, costUsd)
      budgetReserved = false
    } else {
      ctx.budget.record(costUsd)
    }

    const duration = Date.now() - startTime
    ctx.bus.emit({ kind: 'agent_end', label, cost: costUsd, duration_ms: duration })

    if (ctx.budget.isExceeded()) {
      ctx.bus.emit({ kind: 'agent_error', label, error: 'Budget exceeded after agent call' })
      return null
    }

    // Extract result: prefer structured_output when schema was provided
    if (opts?.schema !== undefined && successMsg.structured_output !== undefined) {
      return successMsg.structured_output as T
    }

    // Fall back: try JSON parse (strip markdown fences if present), otherwise raw string
    const raw = successMsg.result
    let parsed: T
    try {
      const stripped = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '')
      parsed = JSON.parse(stripped) as T
    } catch {
      return raw as T
    }

    // Validate against schema when provided
    if (opts?.schema !== undefined) {
      const validate = ajv.compile(opts.schema)
      if (!validate(parsed)) {
        const errors = validate.errors?.map((e) => `${e.instancePath} ${e.message}`).join('; ')
        ctx.bus.emit({
          kind: 'agent_error',
          label,
          error: `Schema validation failed: ${errors}`,
        })
        return null
      }
    }

    return parsed
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    ctx.bus.emit({ kind: 'agent_error', label, error: message })
    return null
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    if (onAbort !== undefined) ctx.signal?.removeEventListener('abort', onAbort)
    // Release budget reservation if adjust() was never called (error paths)
    if (budgetReserved) ctx.budget.adjust(reservedAmount, 0)
    release()
  }
}
