import type {
  SdkProvider,
  SdkQueryHandle,
  SdkQueryOptions,
  SdkResultMessage,
} from '../sdk-types.js'

// ── Option mapping ──────────────────────────────────────────────────

/** Map BatonJS permissionMode to Codex approvalPolicy. */
function mapApprovalPolicy(
  mode: string | undefined,
): 'never' | 'on-failure' | 'on-request' | undefined {
  if (mode === undefined) return undefined
  switch (mode) {
    case 'bypassPermissions':
    case 'fullAccess':
    case 'dontAsk':
      return 'never'
    case 'acceptEdits':
      return 'on-failure'
    case 'default':
    case 'plan':
    case 'delegate':
      return 'on-request'
    default: {
      // Exhaustiveness: unknown permissionMode values are silently ignored
      const _unmatched: never = mode as never
      void _unmatched
      return undefined
    }
  }
}

/** Build Codex ThreadOptions from BatonJS SdkQueryOptions. */
function buildThreadOptions(options: SdkQueryOptions): Record<string, unknown> {
  const threadOpts: Record<string, unknown> = {}
  if (options.model !== undefined) threadOpts['model'] = options.model
  if (options.cwd !== undefined) threadOpts['workingDirectory'] = options.cwd
  const policy = mapApprovalPolicy(options.permissionMode)
  if (policy !== undefined) threadOpts['approvalPolicy'] = policy
  if (options.effort !== undefined) threadOpts['modelReasoningEffort'] = options.effort
  return threadOpts
}

/** Build Codex TurnOptions from BatonJS SdkQueryOptions. */
function buildTurnOptions(options: SdkQueryOptions): Record<string, unknown> {
  const turnOpts: Record<string, unknown> = {}
  if (options.abortController !== undefined) {
    turnOpts['signal'] = options.abortController.signal
  }
  if (options.outputFormat !== undefined) {
    turnOpts['outputSchema'] = options.outputFormat.schema
  }
  return turnOpts
}

// ── Result normalization ─────────────────────────────────────────────

/** Shape of the Turn/RunResult returned by thread.run(). */
interface CodexRunResult {
  readonly finalResponse: string
  readonly items: unknown[]
  readonly usage: {
    readonly input_tokens: number
    readonly cached_input_tokens: number
    readonly output_tokens: number
    readonly reasoning_output_tokens: number
  } | null
}

/** Normalize a successful Codex turn into an SdkResultMessage. */
function toSdkResultMessage(result: CodexRunResult, hasSchema: boolean): SdkResultMessage {
  let structuredOutput: unknown = undefined
  if (hasSchema) {
    try {
      structuredOutput = JSON.parse(result.finalResponse)
    } catch {
      // structured_output stays undefined; agent.ts falls back to raw string
    }
  }

  return {
    type: 'result',
    subtype: 'success',
    total_cost_usd: 0,
    result: result.finalResponse,
    ...(structuredOutput !== undefined && { structured_output: structuredOutput }),
  }
}

// ── Adapter factory ──────────────────────────────────────────────────

/**
 * Create an SdkProvider backed by @openai/codex-sdk.
 * Uses dynamic import() so only the chosen SDK needs to be installed.
 *
 * Adapts the Codex SDK's Promise-based `thread.run()` into the
 * AsyncIterable-based `SdkQueryHandle` contract that BatonJS expects.
 *
 * Design decisions:
 * - Uses buffered `thread.run()` (not `runStreamed()`) for simplicity.
 * - Reports `total_cost_usd` as 0 (Codex provides token usage, not dollar costs).
 * - Cancellation via `AbortSignal` wired through `TurnOptions.signal`.
 */
export async function createCodexAdapter(): Promise<SdkProvider> {
  const { Codex } = await import('@openai/codex-sdk')
  const codex = new Codex()

  return {
    query(params: { prompt: string; options: SdkQueryOptions }): SdkQueryHandle {
      const { prompt, options } = params
      const threadOpts = buildThreadOptions(options)
      const turnOpts = buildTurnOptions(options)
      const hasSchema = options.outputFormat !== undefined

      // ── Promise → AsyncIterable bridge ─────────────────────────
      async function* iterate(): AsyncGenerator<Record<string, unknown>> {
        let result: CodexRunResult
        try {
          const thread = codex.startThread(threadOpts as Parameters<typeof codex.startThread>[0])
          const turn = await thread.run(prompt, turnOpts as Parameters<typeof thread.run>[1])
          result = turn as unknown as CodexRunResult
        } catch (e: unknown) {
          // thread.run() throws on turn failure — yield as error message
          const message = e instanceof Error ? e.message : String(e)
          const errorMsg: SdkResultMessage = {
            type: 'result',
            subtype: 'error',
            total_cost_usd: 0,
            errors: [message],
          }
          yield errorMsg as unknown as Record<string, unknown>
          return
        }

        yield toSdkResultMessage(result, hasSchema) as unknown as Record<string, unknown>
      }

      const gen = iterate()

      return {
        [Symbol.asyncIterator]: () => gen[Symbol.asyncIterator](),
        interrupt() {
          // Cancellation is handled via AbortSignal wired through turnOpts.signal
        },
        return() {
          // No-op: thread.run() is a buffered Promise, not a stream
        },
      }
    },
  }
}
