import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ConsolaInstance } from 'consola'
import { createEventBridge } from '../src/cli/bridge.js'
import type { EngineEvent } from '../src/types.js'

/** Create a mock consola instance that captures calls */
function mockConsola(): ConsolaInstance & { calls: Array<{ method: string; args: unknown[] }> } {
  const calls: Array<{ method: string; args: unknown[] }> = []

  const handler =
    (method: string) =>
    (...args: unknown[]) =>
      calls.push({ method, args })

  return {
    level: 3,
    calls,
    silent: handler('silent'),
    fatal: handler('fatal'),
    error: handler('error'),
    warn: handler('warn'),
    log: handler('log'),
    info: handler('info'),
    success: handler('success'),
    fail: handler('fail'),
    ready: handler('ready'),
    start: handler('start'),
    box: handler('box'),
    debug: handler('debug'),
    trace: handler('trace'),
    verbose: handler('verbose'),
    // Required by ConsolaInstance but unused in tests
    options: {} as never,
    _lastLog: undefined,
    _mockFn: undefined,
    Consola: undefined as never,
    LogLevels: {} as never,
    LogTypes: {} as never,
    consola: undefined as never,
    createConsola: undefined as never,
    default: undefined as never,
  } as unknown as ConsolaInstance & { calls: Array<{ method: string; args: unknown[] }> }
}

describe('createEventBridge', () => {
  let logger: ReturnType<typeof mockConsola>

  beforeEach(() => {
    logger = mockConsola()
  })

  it('handles workflow_start and workflow_end lifecycle', () => {
    const bridge = createEventBridge(logger)

    bridge({ kind: 'workflow_start', meta: { name: 'test-workflow' } } as EngineEvent)
    bridge({
      kind: 'workflow_end',
      success: true,
      totalCost: 0.05,
      duration_ms: 3000,
    } as EngineEvent)

    // Should log the summary after workflow_end
    const infoCalls = logger.calls.filter((c) => c.method === 'info')
    expect(infoCalls.length).toBeGreaterThanOrEqual(1)
    expect(infoCalls[0]?.args[0]).toContain('0.05')
  })

  it('handles agent_start and agent_end', () => {
    const bridge = createEventBridge(logger)

    bridge({ kind: 'workflow_start', meta: { name: 'test' } } as EngineEvent)
    bridge({ kind: 'agent_start', label: 'my-agent' } as EngineEvent)
    bridge({
      kind: 'agent_end',
      label: 'my-agent',
      cost: 0.03,
      duration_ms: 2000,
    } as EngineEvent)
    bridge({
      kind: 'workflow_end',
      success: true,
      totalCost: 0.03,
      duration_ms: 2000,
    } as EngineEvent)

    // No warnings or errors expected
    const warnCalls = logger.calls.filter((c) => c.method === 'warn')
    expect(warnCalls).toHaveLength(0)
  })

  it('handles agent_start with sdk params', () => {
    const bridge = createEventBridge(logger)

    bridge({ kind: 'workflow_start', meta: { name: 'test' } } as EngineEvent)
    bridge({
      kind: 'agent_start',
      label: 'reviewer',
      sdk: { model: 'claude-sonnet-4', effort: 'high', permissionMode: 'bypassPermissions' },
    } as EngineEvent)
    bridge({
      kind: 'agent_end',
      label: 'reviewer',
      cost: 0.03,
      duration_ms: 2000,
    } as EngineEvent)
    bridge({
      kind: 'workflow_end',
      success: true,
      totalCost: 0.03,
      duration_ms: 2000,
    } as EngineEvent)

    // Should not throw — sdk params are handled gracefully
    const errorCalls = logger.calls.filter((c) => c.method === 'error')
    expect(errorCalls).toHaveLength(0)
  })

  it('handles agent_error via consola.warn when no pending task matches', () => {
    const bridge = createEventBridge(logger)

    bridge({ kind: 'agent_error', label: 'orphan', error: 'something failed' } as EngineEvent)

    const warnCalls = logger.calls.filter((c) => c.method === 'warn')
    expect(warnCalls).toHaveLength(1)
    expect(warnCalls[0]?.args[0]).toContain('something failed')
  })

  it('handles log events via consola.log', () => {
    const bridge = createEventBridge(logger)

    bridge({ kind: 'log', message: 'hello world' } as EngineEvent)

    const logCalls = logger.calls.filter((c) => c.method === 'log')
    expect(logCalls).toHaveLength(1)
    expect(logCalls[0]?.args[0]).toContain('hello world')
  })

  it('handles pipeline_error via consola.warn', () => {
    const bridge = createEventBridge(logger)

    bridge({ kind: 'pipeline_error', error: 'stage failed', index: 2, stage: 1 } as EngineEvent)

    const warnCalls = logger.calls.filter((c) => c.method === 'warn')
    expect(warnCalls).toHaveLength(1)
    expect(warnCalls[0]?.args[0]).toContain('pipeline error at item 2')
    expect(warnCalls[0]?.args[0]).toContain('stage 1')
  })

  it('handles parallel_error via consola.warn', () => {
    const bridge = createEventBridge(logger)

    bridge({ kind: 'parallel_error', error: 'thunk failed', index: 0 } as EngineEvent)

    const warnCalls = logger.calls.filter((c) => c.method === 'warn')
    expect(warnCalls).toHaveLength(1)
    expect(warnCalls[0]?.args[0]).toContain('parallel error at thunk 0')
  })

  it('handles workflow_error by rejecting root task', () => {
    const bridge = createEventBridge(logger)

    bridge({ kind: 'workflow_start', meta: null } as EngineEvent)
    bridge({ kind: 'workflow_error', error: 'script crashed' } as EngineEvent)

    // No crash — the error is handled gracefully
    const fatalCalls = logger.calls.filter((c) => c.method === 'fatal')
    expect(fatalCalls).toHaveLength(0)
  })

  it('tracks budget updates', () => {
    const bridge = createEventBridge(logger)

    bridge({ kind: 'budget_update', spent: 0.05, remaining: 0.95 } as EngineEvent)

    // Budget is tracked internally, no direct output until workflow_end
    // Just verify no errors
    const errorCalls = logger.calls.filter((c) => c.method === 'error')
    expect(errorCalls).toHaveLength(0)
  })

  it('handles phase events without error', () => {
    const bridge = createEventBridge(logger)

    bridge({ kind: 'workflow_start', meta: null } as EngineEvent)
    bridge({ kind: 'phase', title: 'Research' } as EngineEvent)
    bridge({ kind: 'phase', title: 'Draft' } as EngineEvent)
    bridge({
      kind: 'workflow_end',
      success: true,
      totalCost: 0,
      duration_ms: 100,
    } as EngineEvent)

    const errorCalls = logger.calls.filter((c) => c.method === 'error')
    expect(errorCalls).toHaveLength(0)
  })
})
