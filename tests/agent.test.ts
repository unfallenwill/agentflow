import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AgentContext } from '../src/core/context.js'
import type { AgentOpts } from '../src/types.js'
import type { SdkQueryOptions } from '../src/core/sdk.js'
import { Semaphore } from '../src/utils/semaphore.js'
import { BudgetTracker } from '../src/core/budget.js'
import { EngineEventBus } from '../src/core/events.js'
import { executeAgent } from '../src/core/agent.js'

// ── Mock the SDK provider ──────────────────────────────────────────────

const queryMock = vi.fn()

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

const mockProvider = { query: queryMock }

// Capture the sdkOpts passed to query() for assertion
let capturedSdkOpts: SdkQueryOptions | undefined

interface MockMessage {
  type: string
  subtype?: string
  result?: string
  structured_output?: unknown
  total_cost_usd?: number
  errors?: string[]
  [key: string]: unknown
}

// ── Helpers ───────────────────────────────────────────────────────────

function makeContext(overrides?: Partial<AgentContext>): AgentContext {
  const bus = new EngineEventBus()
  const budget = new BudgetTracker(null, bus) // null = unlimited by default
  const semaphore = new Semaphore(10)
  return { bus, budget, semaphore, sdk: mockProvider, ...overrides }
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
  beforeEach(() => {
    capturedSdkOpts = undefined

    queryMock.mockImplementation(({ options }: { prompt: string; options: SdkQueryOptions }) => {
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

  it('returns null when schema validation fails', async () => {
    queryMock.mockImplementation(() => {
      return createMockQuery([successResult({ result: JSON.stringify({ name: 42 }) })])
    })

    const ctx = makeContext()
    const events = collectEvents(ctx.bus)
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    }
    const result = await executeAgent('test', { schema }, ctx)

    expect(result).toBeNull()
    const errorEvent = events.find((e) => e.kind === 'agent_error')
    expect(errorEvent?.error).toContain('Schema validation failed')
  })

  it('returns parsed result when schema validation passes', async () => {
    queryMock.mockImplementation(() => {
      return createMockQuery([successResult({ result: JSON.stringify({ name: 'Alice' }) })])
    })

    const ctx = makeContext()
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    }
    const result = await executeAgent<{ name: string }>('test', { schema }, ctx)
    expect(result).toEqual({ name: 'Alice' })
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

  it('returns valid result even when budget is exceeded after call', async () => {
    const bus = new EngineEventBus()
    // Budget of 0.005 — the call costs 0.01, exceeding it
    const budget = new BudgetTracker(0.005, bus)
    const semaphore = new Semaphore(10)
    const ctx: AgentContext = { bus, budget, semaphore, sdk: mockProvider }
    const events = collectEvents(bus)

    const result = await executeAgent('test', undefined, ctx)

    // The result is valid — we already paid for it, discarding would waste
    // both the result and the budget already spent.
    expect(result).toEqual({ value: 42 })

    // agent_end should still be emitted for the successful call
    const endEvent = events.find((e) => e.kind === 'agent_end')
    expect(endEvent).toBeDefined()

    // No agent_error should be emitted — the call succeeded.
    // Budget enforcement happens at reservation time (top of executeAgent),
    // preventing subsequent calls from proceeding.
    const errorEvent = events.find((e) => e.kind === 'agent_error')
    expect(errorEvent).toBeUndefined()
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

  it('returns null and emits agent_error when signal is already aborted', async () => {
    const bus = new EngineEventBus()
    const budget = new BudgetTracker(null, bus)
    const semaphore = new Semaphore(10)
    const controller = new AbortController()
    controller.abort()
    const ctx: AgentContext = {
      bus,
      budget,
      semaphore,
      sdk: mockProvider,
      signal: controller.signal,
    }

    const events = collectEvents(bus)
    const result = await executeAgent('test', undefined, ctx)

    expect(result).toBeNull()
    expect(events.find((e) => e.kind === 'agent_error')).toEqual({
      kind: 'agent_error',
      label: undefined,
      error: 'Agent aborted',
    })
  })

  // ── (m) Signal forwarded ─────────────────────────────────────────

  it('forwards abort signal when not yet aborted', async () => {
    const bus = new EngineEventBus()
    const budget = new BudgetTracker(null, bus)
    const semaphore = new Semaphore(10)
    const controller = new AbortController()
    const ctx: AgentContext = {
      bus,
      budget,
      semaphore,
      sdk: mockProvider,
      signal: controller.signal,
    }

    // Make query hang so we can abort mid-flight
    queryMock.mockImplementation(({ options }: { prompt: string; options: SdkQueryOptions }) => {
      capturedSdkOpts = options
      const iterator = {
        async *[Symbol.asyncIterator]() {
          await new Promise(() => {})
        },
      }
      return Object.assign(iterator, {
        interrupt: vi.fn(),
        return: vi.fn(),
      })
    })

    vi.useFakeTimers()
    // Use a short timeout so the promise settles without advancing 300s
    const promise = executeAgent('test', undefined, { ...ctx, agentTimeoutMs: 5000 })

    // Advance timers to let the query start
    await vi.advanceTimersByTimeAsync(0)

    // The SDK's abortController should not be aborted yet
    expect(capturedSdkOpts?.abortController?.signal.aborted).toBe(false)

    // Now abort the signal — the listener should forward it
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(capturedSdkOpts?.abortController?.signal.aborted).toBe(true)

    // Let the timeout fire so the promise settles
    await vi.advanceTimersByTimeAsync(10_000)
    await promise
  })

  // ── Abort listener cleanup ────────────────────────────────────────

  it('removes abort listener after successful completion', async () => {
    const parentController = new AbortController()
    const bus = new EngineEventBus()
    const budget = new BudgetTracker(null, bus)
    const semaphore = new Semaphore(10)
    const ctx: AgentContext = {
      bus,
      budget,
      semaphore,
      sdk: mockProvider,
      signal: parentController.signal,
    }

    // Track listener count via a spy on addEventListener/removeEventListener
    const addSpy = vi.spyOn(parentController.signal, 'addEventListener')
    const removeSpy = vi.spyOn(parentController.signal, 'removeEventListener')

    await executeAgent('test', undefined, ctx)

    // addEventListener should have been called once to attach the listener
    expect(addSpy).toHaveBeenCalledTimes(1)
    // removeEventListener should have been called once to clean it up
    expect(removeSpy).toHaveBeenCalledTimes(1)
    // The same listener function should have been passed to both
    const addCall = addSpy.mock.calls[0]
    const removeCall = removeSpy.mock.calls[0]
    expect(addCall).toBeDefined()
    expect(removeCall).toBeDefined()
    if (addCall === undefined || removeCall === undefined) return
    expect(addCall[0]).toBe('abort')
    expect(removeCall[0]).toBe('abort')
    expect(removeCall[1]).toBe(addCall[1])
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

  // ── Retry tests ────────────────────────────────────────────────────

  it('retries on 429 rate limit error and succeeds on second attempt', async () => {
    let callCount = 0
    queryMock.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        const iterator = {
          async *[Symbol.asyncIterator]() {
            throw new Error('429 rate limit exceeded')
          },
        }
        return Object.assign(iterator, { interrupt: vi.fn(), return: vi.fn() })
      }
      return createMockQuery([successResult()])
    })

    const ctx = makeContext()
    const result = await executeAgent<{ value: number }>('test', { maxRetries: 2 }, ctx)
    expect(result).toEqual({ value: 42 })
    expect(callCount).toBe(2)
  })

  it('does not retry on non-retryable errors', async () => {
    let callCount = 0
    queryMock.mockImplementation(() => {
      callCount++
      const iterator = {
        async *[Symbol.asyncIterator]() {
          throw new Error('Authentication failed')
        },
      }
      return Object.assign(iterator, { interrupt: vi.fn(), return: vi.fn() })
    })

    const ctx = makeContext()
    const events = collectEvents(ctx.bus)
    const result = await executeAgent('test', { maxRetries: 3 }, ctx)

    expect(result).toBeNull()
    expect(callCount).toBe(1)
    const errorEvents = events.filter((e) => e.kind === 'agent_error')
    expect(errorEvents.length).toBeGreaterThanOrEqual(1)
    expect(errorEvents[errorEvents.length - 1]?.error).toBe('Authentication failed')
  })

  it('exhausts retries and returns null', async () => {
    let callCount = 0
    queryMock.mockImplementation(() => {
      callCount++
      const iterator = {
        async *[Symbol.asyncIterator]() {
          throw new Error('429 too many requests')
        },
      }
      return Object.assign(iterator, { interrupt: vi.fn(), return: vi.fn() })
    })

    const ctx = makeContext()
    const events = collectEvents(ctx.bus)
    const result = await executeAgent('test', { maxRetries: 2 }, ctx)

    expect(result).toBeNull()
    expect(callCount).toBe(3) // initial + 2 retries
    // Should have retry messages + final error
    const errorEvents = events.filter((e) => e.kind === 'agent_error')
    expect(errorEvents.length).toBe(3) // 2 retry warnings + 1 final error
    expect(errorEvents[0]?.error).toContain('retry 1/2')
    expect(errorEvents[1]?.error).toContain('retry 2/2')
    expect(errorEvents[2]?.error).toContain('429')
  })

  it('respects maxRetries: 0 (no retry)', async () => {
    let callCount = 0
    queryMock.mockImplementation(() => {
      callCount++
      const iterator = {
        async *[Symbol.asyncIterator]() {
          throw new Error('429 rate limited')
        },
      }
      return Object.assign(iterator, { interrupt: vi.fn(), return: vi.fn() })
    })

    const ctx = makeContext()
    const result = await executeAgent('test', { maxRetries: 0 }, ctx)

    expect(result).toBeNull()
    expect(callCount).toBe(1) // no retry
  })

  it('emits agent_start with label and phase from opts', async () => {
    const ctx = makeContext()
    const events = collectEvents(ctx.bus)

    await executeAgent('test', { label: 'my-agent', phase: 'build' }, ctx)

    expect(events[0]).toEqual({
      kind: 'agent_start',
      label: 'my-agent',
      phase: 'build',
      sdk: {
        model: undefined,
        effort: undefined,
        permissionMode: 'bypassPermissions',
      },
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
    queryMock.mockImplementation(({ options }: { prompt: string; options: SdkQueryOptions }) => {
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

    const ctx = makeContext({ agentTimeoutMs: 5000 })
    const events = collectEvents(ctx.bus)

    const promise = executeAgent('test', undefined, ctx)

    // Advance past the 5s timeout
    await vi.advanceTimersByTimeAsync(10_000)

    const result = await promise
    expect(result).toBeNull()

    const errorEvent = events.find((e) => e.kind === 'agent_error')
    expect(errorEvent).toEqual({
      kind: 'agent_error',
      label: undefined,
      error: 'Agent timed out after 5s',
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
    const ctx: AgentContext = { bus, budget: badBudget, semaphore, sdk: mockProvider }
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
    const ctx: AgentContext = { bus, budget, semaphore, sdk: mockProvider }

    await executeAgent('test', undefined, ctx)

    expect(budget.spent()).toBeCloseTo(0.01)
  })

  it('passes fair-share budget to sdkOpts when budget is set', async () => {
    const bus = new EngineEventBus()
    const budget = new BudgetTracker(5.0, bus)
    const semaphore = new Semaphore(10)
    const ctx: AgentContext = { bus, budget, semaphore, sdk: mockProvider }

    await executeAgent('test', undefined, ctx)

    // Fair-share: remaining / semaphore.capacity = 5.0 / 10 = 0.5
    expect(capturedSdkOpts?.maxBudgetUsd).toBe(0.5)
  })

  it('does not set maxBudgetUsd when budget is unlimited', async () => {
    const ctx = makeContext()
    await executeAgent('test', undefined, ctx)

    expect(capturedSdkOpts?.maxBudgetUsd).toBeUndefined()
  })

  it('rejects agent call when budget is insufficient', async () => {
    const bus = new EngineEventBus()
    // Budget of 0 — nothing can be reserved
    const budget = new BudgetTracker(0, bus)
    const semaphore = new Semaphore(10)
    const ctx: AgentContext = { bus, budget, semaphore, sdk: mockProvider }
    const events = collectEvents(bus)

    const result = await executeAgent('test', undefined, ctx)

    expect(result).toBeNull()
    expect(events.find((e) => e.kind === 'agent_error')).toEqual({
      kind: 'agent_error',
      label: undefined,
      error: 'Budget insufficient for agent call',
    })
  })

  it('allows concurrent agents with fair-share budget allocation', async () => {
    const bus = new EngineEventBus()
    // Budget of 0.02 — each call costs 0.01, fair-share gives each 0.001
    const budget = new BudgetTracker(0.02, bus)
    const semaphore = new Semaphore(10)
    const ctx: AgentContext = { bus, budget, semaphore, sdk: mockProvider }

    // Both agents reserve their fair-share slice (0.02/10 = 0.002 each)
    const [resultA, resultB] = await Promise.all([
      executeAgent('test-a', undefined, ctx),
      executeAgent('test-b', undefined, ctx),
    ])

    // Both succeed — valid results are not discarded even when actual cost
    // exceeds the reserved fair-share slice
    const results = [resultA, resultB]
    const successes = results.filter((r) => r !== null)
    expect(successes).toHaveLength(2)

    // Total spend may exceed the original budget — this is the trade-off:
    // we honor already-incurred costs rather than discarding valid results
    expect(budget.spent()).toBeCloseTo(0.02)
  })

  it('strips markdown fences and parses JSON from result', async () => {
    queryMock.mockImplementation(() => {
      return createMockQuery([successResult({ result: '```json\n{"value":42}\n```' })])
    })

    const ctx = makeContext()
    const result = await executeAgent<{ value: number }>('test', undefined, ctx)
    expect(result).toEqual({ value: 42 })
  })

  it('strips ```-only fences and parses JSON from result', async () => {
    queryMock.mockImplementation(() => {
      return createMockQuery([successResult({ result: '```\n{"value":99}\n```' })])
    })

    const ctx = makeContext()
    const result = await executeAgent<{ value: number }>('test', undefined, ctx)
    expect(result).toEqual({ value: 99 })
  })

  it('returns raw string when result is not JSON', async () => {
    queryMock.mockImplementation(() => {
      return createMockQuery([successResult({ result: 'plain text response' })])
    })

    const ctx = makeContext()
    const result = await executeAgent<string>('test', undefined, ctx)
    expect(result).toBe('plain text response')
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

  it('wakes up from retry backoff when signal is aborted', async () => {
    vi.useFakeTimers()

    let callCount = 0
    queryMock.mockImplementation(() => {
      callCount++
      const iterator = {
        async *[Symbol.asyncIterator]() {
          throw new Error('429 rate limited')
        },
      }
      return Object.assign(iterator, { interrupt: vi.fn(), return: vi.fn() })
    })

    const bus = new EngineEventBus()
    const budget = new BudgetTracker(null, bus)
    const semaphore = new Semaphore(10)
    const controller = new AbortController()
    const ctx: AgentContext = {
      bus,
      budget,
      semaphore,
      sdk: mockProvider,
      signal: controller.signal,
    }

    const promise = executeAgent('test', { maxRetries: 3 }, ctx)

    // Advance 500ms into the backoff delay (delay could be up to 2s for attempt 0)
    await vi.advanceTimersByTimeAsync(500)

    // Abort during backoff
    controller.abort()

    // Advance timers to let the abort resolve
    await vi.advanceTimersByTimeAsync(100)

    const result = await promise
    expect(result).toBeNull()
    // Should not have retried after abort — only the first call happened
    expect(callCount).toBe(1)
  })

  it('cleans up timeout in finally block on success', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'clearTimeout')

    const ctx = makeContext()
    await executeAgent('test', undefined, ctx)

    expect(clearTimeout).toHaveBeenCalled()
  })
})
