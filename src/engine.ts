import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  AgentOpts,
  EngineEventHandler,
  EngineOptions,
  EngineRunResult,
  ScriptGlobals,
  ScriptMeta,
} from './types.js';
import { ok, err } from './result.js';
import { EngineEventBus } from './events.js';
import { BudgetTracker } from './budget.js';
import { Semaphore, parallelExecute } from './concurrency.js';
import { pipelineExecute } from './pipeline.js';
import { executeAgent } from './agent.js';

// AsyncFunction constructor for executing script bodies
const AsyncFunction = Object.getPrototypeOf(
  async function () {},
).constructor as new (
  ...args: string[]
) => (...params: unknown[]) => Promise<unknown>;

/**
 * AgentFlow workflow engine.
 *
 * Loads a workflow script, injects globals (agent, parallel, pipeline,
 * phase, log, budget, args), and executes it.
 *
 * @example
 * const engine = new Engine({ scriptPath: './workflows/demo.js' });
 * engine.on(event => { if (event.kind === 'log') console.log(event.message); });
 * const result = await engine.run();
 */
export class Engine {
  private readonly opts: EngineOptions;
  private readonly bus: EngineEventBus;
  private readonly budget: BudgetTracker;
  private readonly semaphore: Semaphore;

  constructor(opts: EngineOptions, bus?: EngineEventBus) {
    this.opts = opts;
    this.bus = bus ?? new EngineEventBus();
    this.budget = new BudgetTracker(
      opts.maxBudgetUsd ?? null,
      this.bus,
    );
    this.semaphore = new Semaphore(opts.maxConcurrency ?? 10);
  }

  /** Subscribe to engine events. Returns an unsubscribe function. */
  on(handler: EngineEventHandler): () => void {
    return this.bus.on(handler);
  }

  /** Run the workflow script. */
  async run(): Promise<EngineRunResult> {
    const startTime = Date.now();

    // 1. Load and parse script
    const loaded = await this.loadScript(this.opts.scriptPath);
    if (!loaded.ok) {
      return err(loaded.error);
    }

    const { meta, body } = loaded.value;
    this.bus.emit({ kind: 'workflow_start', meta });

    // 2. Build script globals
    const globals = this.createGlobals();

    // 3. Execute script body as an async function
    const execResult = await this.executeBody(body, globals);

    const duration = Date.now() - startTime;
    const totalCost = this.budget.spent();

    if (!execResult.ok) {
      this.bus.emit({ kind: 'workflow_error', error: execResult.error.message });
      this.bus.emit({ kind: 'workflow_end', success: false, totalCost, duration_ms: duration });
      return err(execResult.error);
    }

    this.bus.emit({ kind: 'workflow_end', success: true, totalCost, duration_ms: duration });

    return ok({
      success: true,
      result: execResult.value,
      totalCostUsd: totalCost,
      durationMs: duration,
      meta,
    });
  }

  // ── Internals ──────────────────────────────────────────────────────

  private createGlobals(): ScriptGlobals {
    return {
      agent: <T = unknown>(prompt: string, opts?: AgentOpts) =>
        executeAgent<T>(prompt, opts, {
          semaphore: this.semaphore,
          budget: this.budget,
          bus: this.bus,
          cwd: this.opts.cwd,
          defaultModel: this.opts.defaultModel,
          permissionMode: this.opts.permissionMode,
          signal: this.opts.signal,
        }),

      parallel: (thunks: Array<() => Promise<unknown>>) =>
        parallelExecute(thunks, this.semaphore),

      pipeline: (
        items: unknown[],
        ...stages: Array<
          (prev: unknown, original: unknown, index: number) => Promise<unknown>
        >
      ) => pipelineExecute(items, stages),

      phase: (title: string) => {
        this.bus.emit({ kind: 'phase', title });
      },

      log: (message: string) => {
        this.bus.emit({ kind: 'log', message });
      },

      budget: this.budget.toHandle(),
      args: this.opts.args ?? {},
    };
  }

  /**
   * Load a workflow script: extract meta export, return the remaining body.
   */
  private async loadScript(
    scriptPath: string,
  ): Promise<
    Result<
      { meta: ScriptMeta | null; body: string },
      Error
    >
  > {
    const absPath = resolve(scriptPath);
    let source: string;
    try {
      source = await readFile(absPath, 'utf-8');
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }

    // Extract `export const meta = { ... }` — handles multi-line objects
    const metaMatch = source.match(
      /export\s+const\s+meta\s*=\s*(\{[\s\S]*?\n\})\s*;?\s*\n/,
    );

    let meta: ScriptMeta | null = null;
    let body = source;

    if (metaMatch?.[1] !== undefined) {
      try {
        meta = JSON.parse(
          // Strip trailing commas (not valid JSON but valid JS)
          metaMatch[1].replace(/,\s*([}\]])/g, '$1'),
        ) as ScriptMeta;
      } catch {
        // If JSON parse fails, try eval-free approach: skip meta
        meta = null;
      }
      // Remove the meta export line from the body
      body = source.replace(metaMatch[0], '');
    }

    return ok({ meta, body });
  }

  /**
   * Execute the script body as an AsyncFunction with injected globals.
   */
  private async executeBody(
    body: string,
    globals: ScriptGlobals,
  ): Promise<Result<unknown, Error>> {
    const paramNames = [
      'agent',
      'parallel',
      'pipeline',
      'phase',
      'log',
      'budget',
      'args',
    ] as const;

    try {
      const fn = new AsyncFunction(...paramNames, body);
      const result = await fn(
        globals.agent,
        globals.parallel,
        globals.pipeline,
        globals.phase,
        globals.log,
        globals.budget,
        globals.args,
      );
      return ok(result);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}

// Local Result type to avoid circular import
type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };
