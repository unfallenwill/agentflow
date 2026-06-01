import { describe, it, expect } from 'vitest'
import { BudgetTracker } from '../src/core/budget.js'
import { EngineEventBus } from '../src/core/events.js'

describe('BudgetTracker', () => {
  it('tracks cumulative spending', () => {
    const bus = new EngineEventBus()
    const budget = new BudgetTracker(null, bus)
    budget.record(1.5)
    budget.record(0.5)
    expect(budget.spent()).toBeCloseTo(2.0)
  })

  it('returns remaining budget', () => {
    const bus = new EngineEventBus()
    const budget = new BudgetTracker(10, bus)
    budget.record(3)
    expect(budget.remaining()).toBeCloseTo(7)
  })

  it('returns null remaining when unlimited', () => {
    const bus = new EngineEventBus()
    const budget = new BudgetTracker(null, bus)
    expect(budget.remaining()).toBeNull()
  })

  it('returns false when budget exceeded', () => {
    const bus = new EngineEventBus()
    const budget = new BudgetTracker(5, bus)
    expect(budget.record(3)).toBe(true)
    expect(budget.record(3)).toBe(false) // 6 > 5
  })

  it('emits budget_update events', () => {
    const bus = new EngineEventBus()
    const events: number[] = []
    bus.on((e) => {
      if (e.kind === 'budget_update') events.push(e.spent)
    })
    const budget = new BudgetTracker(null, bus)
    budget.record(1.0)
    budget.record(2.0)
    expect(events).toHaveLength(2)
    expect(events[0]).toBeCloseTo(1.0)
    expect(events[1]).toBeCloseTo(3.0)
  })

  it('toHandle() returns frozen handle', () => {
    const bus = new EngineEventBus()
    const budget = new BudgetTracker(10, bus)
    const handle = budget.toHandle()
    expect(handle.total).toBe(10)
    expect(handle.spent()).toBe(0)
    expect(handle.remaining()).toBe(10)
  })
})
