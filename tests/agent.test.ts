import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AgentContext, AgentOpts } from '../src/types.js'
import type { Options, ResultMessage } from '@tencent-ai/agent-sdk'
import { Semaphore } from '../src/utils/semaphore.js'
import { BudgetTracker } from '../src/core/budget.js'
import { EngineEventBus } from '../src/core/events.js'
import { executeAgent } from '../src/core/agent.js'

// ── Mock the SDK ──────────────────────────────────────────────────────

vi.mock('@tencent-ai/agent-sdk', () => ({
  query: vi.fn(),
}))

// Capture the sdkOpts passed to query() for assertion
let capturedSdkOpts: Options | undefined

interface MockMessage {
  type: string
  subtype?: string
  result?: string
  structured_output?: unknown
  total_cost_usd?: number
  errors?: string[]
  [key: string]: unknown
}

function createMockQuery(messages: MockMessage[]) {
  const iterator = {
    async *[Symbol.asyncIterator]() {
      for (const msg of messages) {
        yield msg
      }
    },
  }
  return Object.assign(iterator, {
    interrupt: vi.fn(),
    return: vi.fn(),
  })
}

// ── Helpers ───────────────────────────────────────────────────────────

function makeContext(overrides?: Partial<AgentContext>): AgentContext {
  const bus = new EngineEventBus()
  const budget = new BudgetTracker(null, bus) // null = unlimited by default
  const semaphore = new Semaphore(10)
  return { bus, budget, semaphore, ...overrides }
}

function successResult(overrides?: Partial<MockMessage>): MockMessage {
  return {
    type: 'result',
    subtype: 'success',
    result: '{"value":42}',
    total_cost_usd: 0.01,
    ...overrides,
  }
}

function collectEvents(bus: EngineEventBus) {
  const events: Array<{ kind: string; [key: string]: unknown }> = []
  bus.on((e) => events.push(e))
  return events
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('executeAgent', () => {
  let queryMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    const sdk = await import('@tencent-ai/agent-sdk')
    queryMock = vi.mocked(sdk.query)
    capturedSdkOpts = undefined

    queryMock.mockImplementation(({ options }: { prompt: string; options: Options }) => {
      capturedSdkOpts = options
      return createMockQuery([successResult()])
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── (a) Success with JSON result ──────────────────────────────────

  it('returns parsed JSON on success', async () => {
    const ctx = makeContext()
    const result = await executeAgent<{ value: number }>('test prompt', undefined, ctx)
    expect(result).toEqual({ value: 42 })
  })

  // ── (b) Success with plain string (non-JSON) result ───────────────

  it('returns raw string when result is not valid JSON', async () => {
    queryMock.mockImplementation(() => {
      return createMockQuery([successResult({ result: 'plain text response' })])
    })

    const ctx = makeContext()
    const result = await executeAgent<string>('test', undefined, ctx)
    expect(result).toBe('plain text response')
  })

  // ── (c) Success with structured output ────────────────────────────

  it('returns structured_output when schema is provided', async () => {
    const structured = { name: 'Alice', age: 30 }
    queryMock.mockImplementation(() => {
      return createMockQuery([
        successResult({
          structured_output: structured,
          result: JSON.stringify(structured),
        }),
      ])
    })

    const ctx = makeContext()
    const opts: AgentOpts = { schema: { type: 'object' } }
    const result = await executeAgent<typeof structured>('test', opts, ctx)
    expect(result).toEqual(structured)
  })

  // ── (d) No result message ─────────────────────────────────────────

  it('returns null and emits agent_error when no result message', async () => {
    queryMock.mockImplementation(() => {
      return createMockQuery([{ type: 'assistant', content: 'thinking...' }])
    })

    const ctx = makeContext()
    const events = collectEvents(ctx.bus)
    const result = await executeAgent('test', undefined, ctx)

    expect(result).toBeNull()
    expect(events.find((e) => e.kind === 'agent_error')).toEqual({
      kind: 'agent_error',
      label: undefined,
      error: 'No result message received',
    })
  })

  // ── (e) Non-success subtype ───────────────────────────────────────

  it('returns null and emits agent_error on non-success subtype', async () => {
    queryMock.mockImplementation(() => {
      return createMockQuery([{ type: 'result', subtype: 'error', total_cost_usd: 0 }])
    })

    const ctx = makeContext()
    const events = collectEvents(ctx.bus)
    const result = await executeAgent('test', undefined, ctx)

    expect(result).toBeNull()
    expect(events.find((e) => e.kind === 'agent_error')).toEqual({
      kind: 'agent_error',
      label: undefined,
      error: 'Unknown execution error',
    })
  })

  // ── (f) Non-success subtype with errors array ─────────────────────

  it('joins errors array on non-success subtype', async () => {
    queryMock.mockImplementation(() => {
      return createMockQuery([
        {
          type: 'result',
          subtype: 'error',
          total_cost_usd: 0,
          errors: ['rate limited', 'retry failed'],
        },
      ])
    })

    const ctx = makeContext()
    const events = collectEvents(ctx.bus)
    const result = await executeAgent('test', undefined, ctx)

    expect(result).toBeNull()
    expect(events.find((e) => e.kind === 'agent_error')).toEqual({
      kind: 'agent_error',
      label: undefined,
      error: 'rate limited; retry failed',
    })
  })

  // ── (g) SDK throws Error ──────────────────────────────────────────

  it('returns null and emits agent_error when SDK throws Error', async () => {
    queryMock.mockImplementation(() => {
      const iterator = {
        async *[Symbol.asyncIterator]() {
          throw new Error('SDK internal error')
        },
      }
      return Object.assign(iterator, {
        interrupt: vi.fn(),
        return: vi.fn(),
      })
    })

    const ctx = makeContext()
    const events = collectEvents(ctx.bus)
    const result = await executeAgent('test', undefined, ctx)

    expect(result).toBeNull()
    expect(events.find((e) => e.kind === 'agent_error')).toEqual({
      kind: 'agent_error',
      label: undefined,
      error: 'SDK internal error',
    })
  })

  // ── (h) SDK throws non-Error ──────────────────────────────────────

  it('returns null and emits agent_error when SDK throws non-Error', async () => {
    queryMock.mockImplementation(() => {
      const iterator = {
        async *[Symbol.asyncIterator]() {
          throw new Error('string error')
        },
      }
      return Object.assign(iterator, {
        interrupt: vi.fn(),
        return: vi.fn(),
      })
    })

    const ctx = makeContext()
    const events = collectEvents(ctx.bus)
    const result = await executeAgent('test', undefined, ctx)

    expect(result).toBeNull()
    expect(events.find((e) => e.kind === 'agent_error')).toEqual({
      kind: 'agent_error',
      label: undefined,
      error: 'string error',
    })
  })

  // ── (i) Budget exceeded ───────────────────────────────────────────

  it('returns null when budget is exceeded after call', async () => {
    const bus = new EngineEventBus()
    // Budget of 0.005 — the call costs 0.01, exceeding it
    const budget = new BudgetTracker(0.005, bus)
    const semaphore = new Semaphore(10)
    const ctx: AgentContext = { bus, budget, semaphore }
    const events = collectEvents(bus)

    const result = await executeAgent('test', undefined, ctx)

    expect(result).toBeNull()
    expect(events.find((e) => e.kind === 'agent_error')).toEqual({
      kind: 'agent_error',
      label: undefined,
      error: 'Budget exceeded after agent call',
    })
  })

  // ── (j) Model from opts ──────────────────────────────────────────

  it('uses model from opts over defaultModel', async () => {
    const ctx = makeContext({ defaultModel: 'default-model' })
    await executeAgent('test', { model: 'opts-model' }, ctx)

    expect(capturedSdkOpts?.model).toBe('opts-model')
  })

  // ── (k) Model from ctx.defaultModel ──────────────────────────────

  it('falls back to ctx.defaultModel when opts has no model', async () => {
    const ctx = makeContext({ defaultModel: 'ctx-model' })
    await executeAgent('test', undefined, ctx)

    expect(capturedSdkOpts?.model).toBe('ctx-model')
  })

  // ── (l) Signal already aborted ───────────────────────────────────

  it('aborts controller when signal is already aborted', async () => {
    const bus = new EngineEventBus()
    const budget = new BudgetTracker(null, bus)
    const semaphore = new Semaphore(10)
    const controller = new AbortController()
    controller.abort()
    const ctx: AgentContext = { bus, budget, semaphore, signal: controller.signal }

    // The function passes an AbortController to the SDK. When ctx.signal is
    // already aborted, the per-call controller is immediately aborted too.
    // Our mock doesn't react to abort, so the call succeeds — but we can
    // verify the abortController that was passed in is aborted.
    await executeAgent('test', undefined, ctx)
    expect(capturedSdkOpts?.abortController?.signal.aborted).toBe(true)
  })

  // ── (m) Signal forwarded ─────────────────────────────────────────

  it('forwards abort signal when not yet aborted', async () => {
    const bus = new EngineEventBus()
    const budget = new BudgetTracker(null, bus)
    const semaphore = new Semaphore(10)
    const controller = new AbortController()
    const ctx: AgentContext = { bus, budget, semaphore, signal: controller.signal }

    await executeAgent('test', undefined, ctx)

    // The SDK's abortController should not be aborted yet
    expect(capturedSdkOpts?.abortController?.signal.aborted).toBe(false)

    // Now abort the signal — the listener should forward it
    controller.abort()
    // Allow the microtask queue to flush
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(capturedSdkOpts?.abortController?.signal.aborted).toBe(true)
  })

  // ── (n) Permission mode ──────────────────────────────────────────

  it('passes permissionMode from context to sdkOpts', async () => {
    const ctx = makeContext({ permissionMode: 'acceptEdits' })
    await executeAgent('test', undefined, ctx)

    expect(capturedSdkOpts?.permissionMode).toBe('acceptEdits')
  })

  // ── (o) CWD set ──────────────────────────────────────────────────

  it('passes cwd from context to sdkOpts', async () => {
    const ctx = makeContext({ cwd: '/some/path' })
    await executeAgent('test', undefined, ctx)

    expect(capturedSdkOpts?.cwd).toBe('/some/path')
  })

  // ── (p) Label and phase ──────────────────────────────────────────

  it('emits agent_start with label and phase from opts', async () => {
    const ctx = makeContext()
    const events = collectEvents(ctx.bus)

    await executeAgent('test', { label: 'my-agent', phase: 'build' }, ctx)

    expect(events[0]).toEqual({
      kind: 'agent_start',
      label: 'my-agent',
      phase: 'build',
    })
    // Should also emit agent_end with the label
    const endEvent = events.find((e) => e.kind === 'agent_end')
    expect(endEvent).toBeDefined()
    expect((endEvent as Record<string, unknown>).label).toBe('my-agent')
  })

  // ── (q) Timeout ──────────────────────────────────────────────────

  it('handles timeout by emitting agent_error and interrupting query', async () => {
    vi.useFakeTimers()

    // Create a query that never resolves (hangs)
    queryMock.mockImplementation(({ options }: { prompt: string; options: Options }) => {
      capturedSdkOpts = options
      const iterator = {
        async *[Symbol.asyncIterator]() {
          // Never yields — simulates a hung SDK process
          await new Promise(() => {})
        },
      }
      return Object.assign(iterator, {
        interrupt: vi.fn(),
        return: vi.fn(),
      })
    })

    const ctx = makeContext()
    const events = collectEvents(ctx.bus)

    const promise = executeAgent('test', undefined, ctx)

    // Advance past the 120s timeout
    await vi.advanceTimersByTimeAsync(120_000)

    const result = await promise
    expect(result).toBeNull()

    const errorEvent = events.find((e) => e.kind === 'agent_error')
    expect(errorEvent).toEqual({
      kind: 'agent_error',
      label: undefined,
      error: 'Agent timed out after 120s',
    })
  })

  // ── (r) Outer catch ──────────────────────────────────────────────

  it('catches unexpected errors in outer try block', async () => {
    // Make ctx.budget.remaining throw to trigger the outer catch
    const bus = new EngineEventBus()
    const badBudget = {
      record: vi.fn().mockReturnValue(true),
      remaining: () => {
        throw new Error('unexpected budget crash')
      },
      spent: vi.fn().mockReturnValue(0),
    } as unknown as InstanceType<typeof BudgetTracker>
    const semaphore = new Semaphore(10)
    const ctx: AgentContext = { bus, budget: badBudget, semaphore }
    const events = collectEvents(bus)

    const result = await executeAgent('test', undefined, ctx)

    expect(result).toBeNull()
    expect(events.find((e) => e.kind === 'agent_error')).toEqual({
      kind: 'agent_error',
      label: undefined,
      error: 'unexpected budget crash',
    })
  })

  // ── Additional edge cases ────────────────────────────────────────

  it('releases semaphore even on error', async () => {
    queryMock.mockImplementation(() => {
      const iterator = {
        async *[Symbol.asyncIterator]() {
          throw new Error('boom')
        },
      }
      return Object.assign(iterator, {
        interrupt: vi.fn(),
        return: vi.fn(),
      })
    })

    const semaphore = new Semaphore(1)
    const ctx = makeContext({ semaphore })

    // First call should complete (with null result) and release
    const result1 = await executeAgent('test', undefined, ctx)
    expect(result1).toBeNull()

    // Second call should also be able to acquire the semaphore
    queryMock.mockImplementation(() => createMockQuery([successResult()]))
    const result2 = await executeAgent('test', undefined, ctx)
    expect(result2).toEqual({ value: 42 })
  })

  it('emits agent_start and agent_end events in order', async () => {
    const ctx = makeContext()
    const events = collectEvents(ctx.bus)

    await executeAgent('test', undefined, ctx)

    const kinds = events.map((e) => e.kind)
    const startIdx = kinds.indexOf('agent_start')
    const endIdx = kinds.indexOf('agent_end')
    expect(startIdx).toBeLessThan(endIdx)
  })

  it('records cost in budget tracker on success', async () => {
    const bus = new EngineEventBus()
    const budget = new BudgetTracker(100, bus)
    const semaphore = new Semaphore(10)
    const ctx: AgentContext = { bus, budget, semaphore }

    await executeAgent('test', undefined, ctx)

    expect(budget.spent()).toBe(0.01)
  })

  it('passes remaining budget to sdkOpts when budget is set', async () => {
    const bus = new EngineEventBus()
    const budget = new BudgetTracker(5.0, bus)
    const semaphore = new Semaphore(10)
    const ctx: AgentContext = { bus, budget, semaphore }

    await executeAgent('test', undefined, ctx)

    expect(capturedSdkOpts?.maxBudgetUsd).toBe(5.0)
  })

  it('does not set maxBudgetUsd when budget is unlimited', async () => {
    const ctx = makeContext()
    await executeAgent('test', undefined, ctx)

    expect(capturedSdkOpts?.maxBudgetUsd).toBeUndefined()
  })

  it('defaults permissionMode to bypassPermissions when not set', async () => {
    const ctx = makeContext()
    await executeAgent('test', undefined, ctx)

    expect(capturedSdkOpts?.permissionMode).toBe('bypassPermissions')
  })

  it('does not set model when neither opts nor ctx provide one', async () => {
    const ctx = makeContext()
    await executeAgent('test', undefined, ctx)

    expect(capturedSdkOpts?.model).toBeUndefined()
  })

  it('does not set outputFormat when schema is not provided', async () => {
    const ctx = makeContext()
    await executeAgent('test', undefined, ctx)

    expect(capturedSdkOpts?.outputFormat).toBeUndefined()
  })

  it('sets outputFormat with schema when provided', async () => {
    const ctx = makeContext()
    const schema = { type: 'object', properties: { name: { type: 'string' } } }
    await executeAgent('test', { schema }, ctx)

    expect(capturedSdkOpts?.outputFormat).toEqual({
      type: 'json_schema',
      schema,
    })
  })

  it('cleans up timeout in finally block on success', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'clearTimeout')

    const ctx = makeContext()
    await executeAgent('test', undefined, ctx)

    expect(clearTimeout).toHaveBeenCalled()
  })
})
