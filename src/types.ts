import type { SdkName } from './core/sdk.js'
import type { EffortLevel } from './core/sdk-types.js'
import type { Result } from './utils/result.js'

// ── Script-facing types (globals injected into workflow scripts) ─────

/** Options for the `agent()` global */
export interface AgentOpts {
  label?: string
  phase?: string
  /** JSON Schema → passed to SDK outputFormat for structured output */
  schema?: Record<string, unknown>
  model?: string
  /** Max retry attempts for transient errors (429, network). Default: 2 */
  maxRetries?: number
  /** Reasoning effort level: 'medium' | 'high' | 'xhigh' */
  effort?: EffortLevel
}

/** The `budget` object exposed as a script global */
export interface BudgetHandle {
  total: number | null
  spent(): number
  remaining(): number | null
}

/** Discriminated union of all engine events */
export type EngineEvent =
  | { kind: 'workflow_start'; meta: ScriptMeta | null }
  | { kind: 'workflow_end'; success: boolean; totalCost: number; duration_ms: number }
  | { kind: 'workflow_error'; error: string }
  | { kind: 'phase'; title: string }
  | { kind: 'log'; message: string }
  | { kind: 'agent_start'; label?: string | undefined; phase?: string | undefined }
  | { kind: 'agent_end'; label?: string | undefined; cost: number; duration_ms: number }
  | { kind: 'agent_error'; label?: string | undefined; error: string }
  | { kind: 'budget_update'; spent: number; remaining: number | null }
  | { kind: 'pipeline_error'; error: string; index: number; stage?: number }
  | { kind: 'parallel_error'; error: string; index: number }

export type EngineEventHandler = (event: EngineEvent) => void

// ── Script meta export ────────────────────────────────────────────────

/** Shape of a script's `export const meta = { ... }` */
export interface ScriptMeta {
  name: string
  description?: string
  phases?: Array<{ title: string; detail?: string }>
  [key: string]: unknown
}

// ── Engine configuration ──────────────────────────────────────────────

type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'plan'
  | 'delegate'
  | 'dontAsk'
  | 'fullAccess'

export interface EngineOptions {
  /** Path to the workflow script file */
  scriptPath: string
  /** Arguments forwarded into the script as the `args` global */
  args?: unknown
  /** Maximum budget in USD; null or undefined means unlimited */
  maxBudgetUsd?: number
  /** Maximum concurrent agent calls (default: 2) */
  maxConcurrency?: number
  /** Working directory for agent sessions */
  cwd?: string
  /** Default model if not specified in agent() opts */
  defaultModel?: string
  /** Permission mode for all agent queries */
  permissionMode?: PermissionMode
  /** SDK backend to use. Default: 'anthropic' */
  sdk?: SdkName
  /** Timeout in ms for every agent call in this workflow (default: 300000). Must be a positive integer. */
  agentTimeoutMs?: number
  /** Default reasoning effort level for all agents */
  effort?: EffortLevel
  /** AbortSignal to cancel the entire workflow */
  signal?: AbortSignal
}

// ── Engine output ─────────────────────────────────────────────────────

export interface EngineResult {
  success: true
  result: unknown
  totalCostUsd: number
  durationMs: number
  meta: ScriptMeta | null
}

// ── Script globals contract ───────────────────────────────────────────

/** First argument to workflow(): script path ref or saved name */
export type WorkflowRef = string | { scriptPath: string }

export interface ScriptGlobals {
  agent: <T = unknown>(prompt: string, opts?: AgentOpts) => Promise<T | null>
  parallel: (thunks: Array<() => Promise<unknown>>) => Promise<unknown[]>
  pipeline: (
    items: unknown[],
    ...stages: Array<(prev: unknown, original: unknown, index: number) => Promise<unknown>>
  ) => Promise<unknown[]>
  phase: (title: string) => void
  log: (message: string) => void
  budget: BudgetHandle
  args: unknown
  /** Execute a nested sub-workflow. Only one level of nesting is allowed. */
  workflow: (ref: WorkflowRef, childArgs?: unknown) => Promise<unknown>
}

// ── Engine run return type ────────────────────────────────────────────

export type EngineRunResult = Result<EngineResult, Error>
