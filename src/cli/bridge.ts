import { Listr } from 'listr2'
import type { ConsolaInstance } from 'consola'
import type { EngineEvent, EngineEventHandler } from '../types.js'

/** Tracks a pending promise-based task for an agent call */
interface PendingTask {
  /** Resolve the task as succeeded */
  resolve: () => void
  /** Reject the task as failed */
  reject: (error: Error) => void
}

/**
 * Create an event bridge that translates EngineEvent stream into a listr2 task tree.
 *
 * - workflow_start → create root Listr with budget bottom bar
 * - phase → create subtask group
 * - agent_start → create spinner subtask
 * - agent_end → resolve subtask with cost/duration
 * - agent_error → reject subtask
 * - log → set task output
 * - budget_update → update bottom bar
 * - workflow_end → complete root task
 * - pipeline_error / parallel_error → consola.warn
 */
export function createEventBridge(logger: ConsolaInstance): EngineEventHandler {
  // Root Listr instance — created on workflow_start
  let rootListr: Listr<never, 'default', 'silent'> | undefined
  let rootResolve: (() => void) | undefined
  let rootReject: ((error: Error) => void) | undefined

  // Pending agent tasks keyed by label (or index for unlabeled)
  const pendingTasks = new Map<string, PendingTask>()
  let agentCounter = 0

  // Budget state for bottom bar
  let budgetText = ''

  return function bridge(event: EngineEvent): void {
    switch (event.kind) {
      // ── Workflow lifecycle ──────────────────────────────────────────
      case 'workflow_start': {
        const name = event.meta?.name ?? 'workflow'
        rootListr = new Listr<never, 'default', 'silent'>([], {
          concurrent: false,
        })

        // Create a single root promise task that we control externally
        rootListr.add({
          title: name,
          task: () =>
            new Promise<void>((resolve, reject) => {
              rootResolve = resolve
              rootReject = reject
            }),
        })
        // Fire and forget — the promise controls completion
        rootListr.run().catch(() => {
          // Errors are handled via event stream
        })
        break
      }

      case 'workflow_end': {
        budgetText = `$${event.totalCost.toFixed(4)} | ${(event.duration_ms / 1000).toFixed(1)}s`
        if (rootResolve) {
          rootResolve()
          rootResolve = undefined
          rootReject = undefined
        }
        // Print summary line after listr2 completes
        const icon = event.success ? '✅' : '❌'
        logger.info(`\n${icon} ${budgetText}`)
        break
      }

      case 'workflow_error': {
        // workflow_error is surfaced via engine.run() result — just reject root
        if (rootReject) {
          rootReject(new Error(event.error))
          rootResolve = undefined
          rootReject = undefined
        }
        break
      }

      // ── Phase grouping ──────────────────────────────────────────────
      case 'phase': {
        // Phases are informational — no task grouping needed
        break
      }

      // ── Agent tasks ─────────────────────────────────────────────────
      case 'agent_start': {
        const key = event.label ?? `agent-${agentCounter++}`
        const title = event.label ?? 'agent'

        // Build subtitle from SDK params
        const parts: string[] = []
        if (event.sdk?.model) parts.push(event.sdk.model)
        if (event.sdk?.effort) parts.push(`effort: ${event.sdk.effort}`)
        const subtitle = parts.length > 0 ? ` (${parts.join(', ')})` : ''

        let taskResolve: () => void
        let taskReject: (error: Error) => void
        const taskPromise = new Promise<void>((resolve, reject) => {
          taskResolve = resolve
          taskReject = reject
        })

        pendingTasks.set(key, {
          resolve: () => taskResolve(),
          reject: (err: Error) => taskReject(err),
        })

        if (rootListr) {
          rootListr.add({
            title: `→ ${title}${subtitle}`,
            task: () => taskPromise,
          })
        }
        break
      }

      case 'agent_end': {
        const key = event.label ?? `agent-${agentCounter - 1}`
        const pending = pendingTasks.get(key)
        if (pending) {
          pending.resolve()
          pendingTasks.delete(key)
        }
        break
      }

      case 'agent_error': {
        const key = event.label ?? `agent-${agentCounter - 1}`
        const pending = pendingTasks.get(key)
        if (pending) {
          pending.reject(new Error(event.error))
          pendingTasks.delete(key)
        } else {
          logger.warn(`agent error: ${event.error}`)
        }
        break
      }

      // ── Budget ──────────────────────────────────────────────────────
      case 'budget_update': {
        budgetText = `$${event.spent.toFixed(4)} spent`
        if (event.remaining !== null) {
          budgetText += ` | $${event.remaining.toFixed(4)} remaining`
        }
        break
      }

      // ── Log messages ────────────────────────────────────────────────
      case 'log': {
        logger.log(`  ${event.message}`)
        break
      }

      // ── Error events ────────────────────────────────────────────────
      case 'pipeline_error': {
        logger.warn(
          `pipeline error at item ${event.index}${event.stage !== undefined ? ` stage ${event.stage}` : ''}: ${event.error}`,
        )
        break
      }

      case 'parallel_error': {
        logger.warn(`parallel error at thunk ${event.index}: ${event.error}`)
        break
      }

      default: {
        const _exhaustive: never = event
        void _exhaustive
        break
      }
    }
  }
}
