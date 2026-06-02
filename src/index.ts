// BatonJS — Workflow engine powered by Agent SDKs

// Engine
export { Engine } from './core/engine.js'

// Result type
export { ok, err } from './utils/result.js'
export type { Result } from './utils/result.js'

// Types
export type {
  AgentOpts,
  BudgetHandle,
  EngineEvent,
  EngineEventHandler,
  EngineOptions,
  EngineResult,
  EngineRunResult,
  ScriptGlobals,
  ScriptMeta,
  WorkflowRef,
} from './types.js'

// SDK adapter
export { createSdkProvider } from './core/sdk.js'
export type {
  EffortLevel,
  SdkName,
  SdkProvider,
  SdkQueryOptions,
  SdkQueryHandle,
  SdkResultMessage,
} from './core/sdk.js'

// Event bus
export { EngineEventBus } from './core/events.js'

// Concurrency
export { Semaphore } from './utils/semaphore.js'

// Budget
export { BudgetTracker } from './core/budget.js'
