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

/**
 * Normalize a JSON Schema for OpenAI Structured Output compatibility.
 *
 * OpenAI requires:
 *   - `additionalProperties: false` on every object
 *   - All properties listed in `required`
 *
 * This mutates the schema in place (deep walk).
 */
function normalizeSchemaForOpenAI(schema: Record<string, unknown>): void {
  if (schema['type'] === 'object' && schema['properties'] !== undefined) {
    const props = schema['properties'] as Record<string, unknown>
    schema['additionalProperties'] = false
    schema['required'] = Object.keys(props)
    for (const value of Object.values(props)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        normalizeSchemaForOpenAI(value as Record<string, unknown>)
      }
    }
  }

  // Walk array items
  if (
    schema['items'] !== undefined &&
    typeof schema['items'] === 'object' &&
    schema['items'] !== null
  ) {
    normalizeSchemaForOpenAI(schema['items'] as Record<string, unknown>)
  }

  // Walk anyOf / oneOf branches
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const branch = schema[key]
    if (Array.isArray(branch)) {
      for (const item of branch) {
        if (typeof item === 'object' && item !== null) {
          normalizeSchemaForOpenAI(item as Record<string, unknown>)
        }
      }
    }
  }
}

/** Build Codex TurnOptions from BatonJS SdkQueryOptions. */
function buildTurnOptions(options: SdkQueryOptions): Record<string, unknown> {
  const turnOpts: Record<string, unknown> = {}
  if (options.abortController !== undefined) {
    turnOpts['signal'] = options.abortController.signal
  }
  if (options.outputFormat !== undefined) {
    // Deep-clone before mutating to avoid polluting the caller's schema
    const cloned = JSON.parse(JSON.stringify(options.outputFormat.schema)) as Record<
      string,
      unknown
    >
    normalizeSchemaForOpenAI(cloned)
    turnOpts['outputSchema'] = cloned
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

// ── Cost estimation ───────────────────────────────────────────────────

/**
 * Per-million-token pricing for known OpenAI model families used by Codex.
 *
 * Ordered from most-specific prefix to least-specific so that
 * `resolvePricing` matches `gpt-4o-mini` before `gpt-4o`.
 *
 * Sources: OpenAI pricing page (June 2026).
 * These values will need periodic updates as OpenAI adjusts pricing.
 */
const MODEL_PRICING: readonly {
  readonly prefix: string
  readonly input: number
  readonly cachedInput: number
  readonly output: number
}[] = [
  // o4-mini / codex-mini family
  { prefix: 'o4-mini', input: 1.1, cachedInput: 0.275, output: 4.4 },
  { prefix: 'codex-mini', input: 1.1, cachedInput: 0.275, output: 4.4 },
  // GPT-4o family (longer prefix first!)
  { prefix: 'gpt-4o-mini', input: 0.15, cachedInput: 0.075, output: 0.6 },
  { prefix: 'gpt-4o', input: 2.5, cachedInput: 1.25, output: 10.0 },
]

/** Fallback pricing when the model name is unrecognised — uses o4-mini rates. */
const DEFAULT_PRICING = {
  input: 1.1,
  cachedInput: 0.275,
  output: 4.4,
} as const

/** Resolve per-million-token pricing for the given model name. */
function resolvePricing(model: string | undefined): {
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
 * Estimate USD cost from Codex token usage.
 *
 * `output_tokens` already includes reasoning tokens, so we don't add
 * `reasoning_output_tokens` on top.
 */
function estimateCost(usage: CodexRunResult['usage'], model: string | undefined): number {
  if (usage === null) return 0
  const pricing = resolvePricing(model)
  return (
    (usage.input_tokens * pricing.input +
      usage.cached_input_tokens * pricing.cachedInput +
      usage.output_tokens * pricing.output) /
    1_000_000
  )
}

/** Normalize a successful Codex turn into an SdkResultMessage. */
function toSdkResultMessage(
  result: CodexRunResult,
  hasSchema: boolean,
  model: string | undefined,
): SdkResultMessage {
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
    total_cost_usd: estimateCost(result.usage, model),
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
 * - Estimates `total_cost_usd` from token usage using known OpenAI model pricing.
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
            total_cost_usd: 0, // turn threw — no usage data available
            errors: [message],
          }
          yield errorMsg as unknown as Record<string, unknown>
          return
        }

        yield toSdkResultMessage(result, hasSchema, options.model) as unknown as Record<
          string,
          unknown
        >
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
