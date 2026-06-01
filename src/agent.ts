import { query } from '@tencent-ai/agent-sdk';
import type { Options, ResultMessage } from '@tencent-ai/agent-sdk';
import type { AgentContext, AgentOpts } from './types.js';

/**
 * Execute a single agent call via the SDK.
 *
 * - Acquires a semaphore slot for the duration of the call.
 * - Passes `schema` as SDK `outputFormat` for structured output.
 * - Tracks spending via BudgetTracker.
 * - Returns `null` on any failure (soft failure pattern).
 */
export async function executeAgent<T = unknown>(
  prompt: string,
  opts: AgentOpts | undefined,
  ctx: AgentContext,
): Promise<T | null> {
  const label = opts?.label;
  const phase = opts?.phase;

  ctx.bus.emit({ kind: 'agent_start', label, phase });

  const release = await ctx.semaphore.acquire();
  const startTime = Date.now();

  try {
    // Build SDK options
    const sdkOpts: Options = {
      permissionMode: ctx.permissionMode ?? 'bypassPermissions',
    };

    if (opts?.schema !== undefined) {
      sdkOpts.outputFormat = { type: 'json_schema', schema: opts.schema };
    }

    if (opts?.model !== undefined) {
      sdkOpts.model = opts.model;
    } else if (ctx.defaultModel !== undefined) {
      sdkOpts.model = ctx.defaultModel;
    }

    if (ctx.cwd !== undefined) {
      sdkOpts.cwd = ctx.cwd;
    }

    // Forward remaining budget to SDK
    const remaining = ctx.budget.remaining();
    if (remaining !== null) {
      sdkOpts.maxBudgetUsd = remaining;
    }

    // Forward abort signal
    if (ctx.signal !== undefined) {
      const controller = new AbortController();
      sdkOpts.abortController = controller;

      if (ctx.signal.aborted) {
        controller.abort();
      } else {
        const onAbort = () => controller.abort();
        ctx.signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    // Execute query and extract the ResultMessage
    const q = query({ prompt, options: sdkOpts });

    let resultMsg: ResultMessage | null = null;
    for await (const message of q) {
      if (message.type === 'result') {
        resultMsg = message as ResultMessage;
      }
    }

    if (resultMsg === null) {
      ctx.bus.emit({ kind: 'agent_error', label, error: 'No result message received' });
      return null;
    }

    // Error subtypes
    if (resultMsg.subtype !== 'success') {
      const errPayload = resultMsg as unknown as { errors?: string[] };
      const errors = errPayload.errors ?? ['Unknown execution error'];
      ctx.bus.emit({
        kind: 'agent_error',
        label,
        error: errors.join('; '),
      });
      return null;
    }

    // Record cost
    const costUsd = resultMsg.total_cost_usd;
    const withinBudget = ctx.budget.record(costUsd);

    const duration = Date.now() - startTime;
    ctx.bus.emit({ kind: 'agent_end', label, cost: costUsd, duration_ms: duration });

    if (!withinBudget) {
      ctx.bus.emit({ kind: 'agent_error', label, error: 'Budget exceeded after agent call' });
      return null;
    }

    // Extract result: prefer structured_output when schema was provided
    if (opts?.schema !== undefined && resultMsg.structured_output !== undefined) {
      return resultMsg.structured_output as T;
    }

    // Fall back: try JSON parse, otherwise return raw string
    try {
      return JSON.parse(resultMsg.result) as T;
    } catch {
      return resultMsg.result as T;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.bus.emit({ kind: 'agent_error', label, error: message });
    return null;
  } finally {
    release();
  }
}

