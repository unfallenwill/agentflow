import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { transform as sucraseTransform } from 'sucrase'
import type {
  AgentOpts,
  EngineEventHandler,
  EngineOptions,
  EngineRunResult,
  ScriptGlobals,
  ScriptMeta,
  WorkflowRef,
} from '../types.js'
import type { Result } from '../utils/result.js'
import { ok, err } from '../utils/result.js'
import { EngineEventBus } from './events.js'
import { BudgetTracker } from './budget.js'
import { Semaphore } from '../utils/semaphore.js'
import { parallelExecute } from '../utils/parallel.js'
import { pipelineExecute } from '../utils/pipeline.js'
import { extractMeta } from '../utils/extract-meta.js'
import { executeAgent } from './agent.js'
import { createSdkProvider } from './sdk.js'
import type { SdkProvider } from './sdk.js'

/** @internal Brand symbol for SharedState discrimination */
const _sharedBrand: unique symbol = Symbol('agentflow:shared-state')

/** Internal shared state passed from parent to child engine */
interface SharedState {
  [_sharedBrand]: typeof _sharedBrand
  bus: EngineEventBus
  budget: BudgetTracker
  semaphore: Semaphore
  depth: number
  sdk: SdkProvider
}

// AsyncFunction constructor for executing script bodies
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...params: unknown[]) => Promise<unknown>

/**
 * AgentFlow workflow engine.
 *
 * Loads a workflow script, injects globals (agent, parallel, pipeline,
 * phase, log, budget, args, workflow), and executes it.
 *
 * @example
 * const engine = new Engine({ scriptPath: './workflows/demo.js' });
 * engine.on(event => { if (event.kind === 'log') console.log(event.message); });
 * const result = await engine.run();
 */
export class Engine {
  private readonly opts: EngineOptions
  private readonly bus: EngineEventBus
  private readonly budget: BudgetTracker
  private readonly semaphore: Semaphore
  private readonly depth: number
  /** Shared state from parent (child engines only) */
  private readonly shared: SharedState | undefined

  constructor(opts: EngineOptions)
  /** @internal Create a child engine sharing parent state */
  constructor(opts: EngineOptions, shared: SharedState)
  constructor(opts: EngineOptions, shared?: SharedState) {
    this.opts = opts

    if (shared !== undefined && _sharedBrand in shared) {
      // Child engine: share bus, budget, semaphore, sdk from parent
      this.bus = shared.bus
      this.budget = shared.budget
      this.semaphore = shared.semaphore
      this.depth = shared.depth
      this.shared = shared
    } else {
      // Root engine: create fresh state
      this.bus = new EngineEventBus()
      this.budget = new BudgetTracker(opts.maxBudgetUsd ?? null, this.bus)
      this.semaphore = new Semaphore(opts.maxConcurrency ?? 10)
      this.depth = 0
      this.shared = undefined
    }
  }

  /** Subscribe to engine events. Returns an unsubscribe function. */
  on(handler: EngineEventHandler): () => void {
    return this.bus.on(handler)
  }

  /** Run the workflow script. */
  async run(): Promise<EngineRunResult> {
    const startTime = Date.now()

    // 0. Resolve SDK provider
    const sdk: SdkProvider =
      this.shared !== undefined
        ? this.shared.sdk
        : await createSdkProvider(this.opts.sdk ?? 'anthropic')

    // 1. Load and parse script
    const loaded = await this.loadScript(this.opts.scriptPath)
    if (!loaded.ok) {
      return err(loaded.error)
    }

    const { meta, body } = loaded.value
    this.bus.emit({ kind: 'workflow_start', meta })

    // 2. Build script globals
    const globals = this.createGlobals(sdk)

    // 3. Execute script body as an async function
    const execResult = await this.executeBody(body, globals)

    const duration = Date.now() - startTime
    const totalCost = this.budget.spent()

    if (!execResult.ok) {
      this.bus.emit({ kind: 'workflow_error', error: execResult.error.message })
      this.bus.emit({ kind: 'workflow_end', success: false, totalCost, duration_ms: duration })
      return err(execResult.error)
    }

    this.bus.emit({ kind: 'workflow_end', success: true, totalCost, duration_ms: duration })

    return ok({
      success: true,
      result: execResult.value,
      totalCostUsd: totalCost,
      durationMs: duration,
      meta,
    })
  }

  // ── Internals ──────────────────────────────────────────────────────

  private createGlobals(sdk: SdkProvider): ScriptGlobals {
    return {
      agent: <T = unknown>(prompt: string, opts?: AgentOpts) =>
        executeAgent<T>(prompt, opts, {
          semaphore: this.semaphore,
          budget: this.budget,
          bus: this.bus,
          sdk,
          cwd: this.opts.cwd,
          defaultModel: this.opts.defaultModel,
          permissionMode: this.opts.permissionMode,
          signal: this.opts.signal,
        }),

      parallel: (thunks: Array<() => Promise<unknown>>) =>
        parallelExecute(thunks, {
          onError: (error, index) => {
            const message = error instanceof Error ? error.message : String(error)
            this.bus.emit({ kind: 'parallel_error', error: message, index })
          },
        }),

      pipeline: (
        items: unknown[],
        ...stages: Array<(prev: unknown, original: unknown, index: number) => Promise<unknown>>
      ) =>
        pipelineExecute(items, stages, {
          onError: (error, index, stage) => {
            const message = error instanceof Error ? error.message : String(error)
            this.bus.emit({ kind: 'pipeline_error', error: message, index, stage })
          },
        }),

      phase: (title: string) => {
        this.bus.emit({ kind: 'phase', title })
      },

      log: (message: string) => {
        this.bus.emit({ kind: 'log', message })
      },

      budget: this.budget.toHandle(),
      args: this.opts.args ?? {},

      // ── Nested workflow ─────────────────────────────────────────────
      // Creates a child Engine sharing bus, budget, semaphore, sdk.
      // Only one level of nesting allowed (depth 0 → 1).
      workflow: (ref: WorkflowRef, childArgs?: unknown) =>
        this.executeChildWorkflow(ref, childArgs, sdk),
    }
  }

  /**
   * Execute a nested child workflow.
   * Shares the parent's bus, budget, semaphore, sdk, signal.
   * Throws if nesting depth exceeds 1.
   */
  private async executeChildWorkflow(
    ref: WorkflowRef,
    childArgs: unknown | undefined,
    sdk: SdkProvider,
  ): Promise<unknown> {
    if (this.depth >= 1) {
      throw new Error('workflow() nesting limit exceeded: only one level of nesting is allowed')
    }

    const scriptPath = typeof ref === 'string' ? ref : ref.scriptPath

    const childOpts: EngineOptions = { scriptPath, args: childArgs }
    if (this.opts.cwd !== undefined) childOpts.cwd = this.opts.cwd
    if (this.opts.defaultModel !== undefined) childOpts.defaultModel = this.opts.defaultModel
    if (this.opts.permissionMode !== undefined) childOpts.permissionMode = this.opts.permissionMode
    if (this.opts.signal !== undefined) childOpts.signal = this.opts.signal

    const childEngine = new Engine(childOpts, {
      [_sharedBrand]: _sharedBrand,
      bus: this.bus,
      budget: this.budget,
      semaphore: this.semaphore,
      depth: this.depth + 1,
      sdk,
    })

    const result = await childEngine.run()

    if (!result.ok) {
      throw new Error(`Child workflow "${scriptPath}" failed: ${result.error.message}`, {
        cause: result.error,
      })
    }

    return result.value.result
  }

  /**
   * Load a workflow script: extract meta export, transpile TS if needed.
   */
  private async loadScript(
    scriptPath: string,
  ): Promise<Result<{ meta: ScriptMeta | null; body: string }, Error>> {
    const absPath = resolve(scriptPath)
    let source: string
    try {
      source = await readFile(absPath, 'utf-8')
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)))
    }

    // Transpile TypeScript → JS if needed
    const isTS = extname(absPath) === '.ts'
    if (isTS) {
      try {
        const transformed = sucraseTransform(source, {
          transforms: ['typescript'],
        })
        source = transformed.code
      } catch (e) {
        return err(
          e instanceof Error ? e : new Error(`TypeScript transpilation failed: ${String(e)}`),
        )
      }
    }

    // Extract and parse meta export safely (brace-depth + JSON5, no eval)
    const { meta, body } = extractMeta(source)

    return ok({ meta, body })
  }

  /**
   * Execute the script body as an AsyncFunction with injected globals.
   */
  private async executeBody(body: string, globals: ScriptGlobals): Promise<Result<unknown, Error>> {
    const paramNames = [
      'agent',
      'parallel',
      'pipeline',
      'phase',
      'log',
      'budget',
      'args',
      'workflow',
    ] as const

    try {
      const fn = new AsyncFunction(...paramNames, body)
      const result = await fn(
        globals.agent,
        globals.parallel,
        globals.pipeline,
        globals.phase,
        globals.log,
        globals.budget,
        globals.args,
        globals.workflow,
      )
      return ok(result)
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)))
    }
  }
}
