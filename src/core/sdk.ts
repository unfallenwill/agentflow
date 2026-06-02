/** Supported SDK backend names */
export type SdkName = 'anthropic' | 'codebuddy'

/**
 * Options passed to the SDK query function.
 * Structurally identical across both supported SDKs.
 */
export interface SdkQueryOptions {
  /** Permission mode — each SDK accepts a specific string union; we pass through. */
  permissionMode?: string
  abortController?: AbortController
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> }
  model?: string
  cwd?: string
  maxBudgetUsd?: number
}

/**
 * Handle returned by SDK query() — an async iterable with cleanup methods.
 * Both SDKs return this shape from their query() function.
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

/**
 * Create an SdkProvider for the given SDK name.
 * Uses dynamic import() so only the chosen SDK needs to be installed.
 * Wraps the SDK's native query in a lambda to normalize the signature.
 */
export async function createSdkProvider(name: SdkName): Promise<SdkProvider> {
  switch (name) {
    case 'anthropic': {
      const sdk = await import('@anthropic-ai/claude-agent-sdk')
      return {
        query: (params) =>
          sdk.query({
            prompt: params.prompt,
            options: params.options as NonNullable<Parameters<typeof sdk.query>[0]['options']>,
          }) as SdkQueryHandle,
      }
    }
    case 'codebuddy': {
      const sdk = await import('@tencent-ai/agent-sdk')
      return {
        query: (params) =>
          sdk.query({
            prompt: params.prompt,
            options: params.options as NonNullable<Parameters<typeof sdk.query>[0]['options']>,
          }) as SdkQueryHandle,
      }
    }
    default: {
      const _exhaustive: never = name
      throw new Error(`Unknown SDK: ${String(_exhaustive)}`)
    }
  }
}
