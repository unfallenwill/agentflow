/** Supported SDK backend names */
export type SdkName = 'anthropic' | 'codebuddy' | 'codex'

/**
 * Options passed to the SDK query function.
 * Structurally identical across all supported SDKs.
 */
/** Unified reasoning effort levels across all SDK backends. */
export type EffortLevel = 'medium' | 'high' | 'xhigh'

export interface SdkQueryOptions {
  /** Permission mode — each SDK accepts a specific string union; we pass through. */
  permissionMode?: string
  abortController?: AbortController
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> }
  model?: string
  cwd?: string
  maxBudgetUsd?: number
  /** Reasoning effort level — mapped to each SDK's native effort parameter. */
  effort?: EffortLevel
}

/**
 * Handle returned by SDK query() — an async iterable with cleanup methods.
 * All SDKs return this shape from their query() function.
 */
export interface SdkQueryHandle extends AsyncIterable<Record<string, unknown>> {
  interrupt(): void
  return(): void
}

/**
 * Normalized result message from any supported SDK.
 * Discriminated on `subtype`: 'success' vs error variants.
 */
export type SdkResultMessage =
  | {
      type: 'result'
      subtype: 'success'
      total_cost_usd: number
      result: string
      structured_output?: unknown
      errors?: undefined
    }
  | {
      type: 'result'
      subtype: string
      total_cost_usd: number
      result?: undefined
      structured_output?: undefined
      errors: string[]
    }

/** Contract for an SDK backend */
export interface SdkProvider {
  query(params: { prompt: string; options: SdkQueryOptions }): SdkQueryHandle
}
