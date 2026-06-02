import type { SdkProvider, SdkQueryHandle } from '../sdk-types.js'

/**
 * Create an SdkProvider backed by @tencent-ai/agent-sdk.
 * Uses dynamic import() so only the chosen SDK needs to be installed.
 */
export async function createCodebuddyAdapter(): Promise<SdkProvider> {
  const sdk = await import('@tencent-ai/agent-sdk')
  return {
    query: (params) =>
      sdk.query({
        prompt: params.prompt,
        options: params.options as NonNullable<Parameters<typeof sdk.query>[0]['options']>,
      }) as SdkQueryHandle,
  }
}
