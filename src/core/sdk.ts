// Re-export all SDK types from the type-only module (no circular deps)
export type {
  EffortLevel,
  SdkName,
  SdkQueryOptions,
  SdkQueryHandle,
  SdkResultMessage,
  SdkProvider,
} from './sdk-types.js'

import type { SdkName, SdkProvider } from './sdk-types.js'

/**
 * Create an SdkProvider for the given SDK name.
 * Uses dynamic import() so only the chosen SDK needs to be installed.
 * Each adapter module encapsulates its own SDK-specific mapping logic.
 */
export async function createSdkProvider(name: SdkName): Promise<SdkProvider> {
  switch (name) {
    case 'anthropic': {
      const { createAnthropicAdapter } = await import('./adapters/anthropic.js')
      return createAnthropicAdapter()
    }
    case 'codebuddy': {
      const { createCodebuddyAdapter } = await import('./adapters/codebuddy.js')
      return createCodebuddyAdapter()
    }
    case 'codex': {
      const { createCodexAdapter } = await import('./adapters/codex.js')
      return createCodexAdapter()
    }
    default: {
      const _exhaustive: never = name
      throw new Error(`Unknown SDK: ${String(_exhaustive)}`)
    }
  }
}
