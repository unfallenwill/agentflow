import { query } from '@tencent-ai/agent-sdk'
import type { Options, ResultMessage } from '@tencent-ai/agent-sdk'
import type { AgentContext, AgentOpts } from '../types.js'

/** Default timeout for a single agent call (ms) */
const DEFAULT_AGENT_TIMEOUT_MS = 120_000

/** Internal error wrapper to distinguish SDK errors from null results */
class QueryError {
  constructor(public readonly message: string) {}
}

/**
 * Execute a single agent call via the SDK.
 *
 * - Acquires a semaphore slot for the duration of the call.
 * - Passes `schema` as SDK `outputFormat` for structured output.
 * - Tracks spending via BudgetTracker.
 * - Returns `null` on any failure (soft failure pattern).
 * - Times out if the SDK process hangs.
 */
export async function executeAgent<T = unknown>(
  prompt: string,
  opts: AgentOpts | undefined,
  ctx: AgentContext,
): Promise<T | null> {
  const label = opts?.label
  const phase = opts?.phase

  ctx.bus.emit({ kind: 'agent_start', label, phase })

  const release = await ctx.semaphore.acquire()
  const startTime = Date.now()

  // Create a per-call AbortController for timeout + signal forwarding
  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  try {
    // Build SDK options
    const sdkOpts: Options = {
      permissionMode: ctx.permissionMode ?? 'bypassPermissions',
      abortController: controller,
    }

    if (opts?.schema !== undefined) {
      sdkOpts.outputFormat = { type: 'json_schema', schema: opts.schema }
    }

    if (opts?.model !== undefined) {
      sdkOpts.model = opts.model
    } else if (ctx.defaultModel !== undefined) {
      sdkOpts.model = ctx.defaultModel
    }

    if (ctx.cwd !== undefined) {
      sdkOpts.cwd = ctx.cwd
    }

    // Forward remaining budget to SDK
    const remaining = ctx.budget.remaining()
    if (remaining !== null) {
      sdkOpts.maxBudgetUsd = remaining
    }

    // Forward engine-level abort signal
    if (ctx.signal !== undefined) {
      if (ctx.signal.aborted) {
        controller.abort()
      } else {
        const onAbort = () => controller.abort()
        ctx.signal.addEventListener('abort', onAbort, { once: true })
      }
    }

    // Execute query with timeout protection.
    // SDK's AsyncGenerator may hang on errors (e.g., 429),
    // so we race it against a timeout that resolves to a sentinel.
    const TIMEOUT_SENTINEL = Symbol('timeout')
    const q = query({ prompt, options: sdkOpts })

    const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
      timeoutId = setTimeout(() => {
        controller.abort()
        resolve(TIMEOUT_SENTINEL)
      }, DEFAULT_AGENT_TIMEOUT_MS)
    })

    const queryPromise = (async (): Promise<ResultMessage | null> => {
      try {
        let resultMsg: ResultMessage | null = null
        for await (const message of q) {
          if (message.type === 'result') {
            resultMsg = message as ResultMessage
          }
        }
        return resultMsg
      } catch (e: unknown) {
        // SDK throws ExecutionError (e.g. 429), AbortError, etc.
        // Propagate the error message to the caller.
        const msg = e instanceof Error ? e.message : String(e)
        return new QueryError(msg) as unknown as null
      }
    })()

    const raceResult = await Promise.race([queryPromise, timeoutPromise])

    // Clear timeout — query or timeout finished
    clearTimeout(timeoutId)
    timeoutId = undefined

    // Handle timeout
    if (raceResult === TIMEOUT_SENTINEL) {
      ctx.bus.emit({
        kind: 'agent_error',
        label,
        error: `Agent timed out after ${DEFAULT_AGENT_TIMEOUT_MS / 1000}s`,
      })
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
      return null
    }

    // Handle query error (e.g. 429 ExecutionError caught by IIFE)
    if (raceResult instanceof QueryError) {
      ctx.bus.emit({ kind: 'agent_error', label, error: raceResult.message })
      return null
    }

    const resultMsg = raceResult as ResultMessage | null

    // No result at all
    if (resultMsg === null) {
      ctx.bus.emit({ kind: 'agent_error', label, error: 'No result message received' })
      return null
    }

    // Error subtypes (non-success)
    if (resultMsg.subtype !== 'success') {
      const errPayload = resultMsg as unknown as { errors?: string[] }
      const errors = errPayload.errors ?? ['Unknown execution error']
      ctx.bus.emit({
        kind: 'agent_error',
        label,
        error: errors.join('; '),
      })
      return null
    }

    // At this point resultMsg is the success variant with .result and .structured_output
    const successMsg = resultMsg as ResultMessage & { result: string; structured_output?: unknown }

    // Record cost
    const costUsd = successMsg.total_cost_usd
    const withinBudget = ctx.budget.record(costUsd)

    const duration = Date.now() - startTime
    ctx.bus.emit({ kind: 'agent_end', label, cost: costUsd, duration_ms: duration })

    if (!withinBudget) {
      ctx.bus.emit({ kind: 'agent_error', label, error: 'Budget exceeded after agent call' })
      return null
    }

    // Extract result: prefer structured_output when schema was provided
    if (opts?.schema !== undefined && successMsg.structured_output !== undefined) {
      return successMsg.structured_output as T
    }

    // Fall back: try JSON parse, otherwise return raw string
    try {
      return JSON.parse(successMsg.result) as T
    } catch {
      return successMsg.result as T
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    ctx.bus.emit({ kind: 'agent_error', label, error: message })
    return null
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    release()
  }
}
