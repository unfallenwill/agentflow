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

  describe('tryAcquire', () => {
    it('reserves budget and increments spent', () => {
      const bus = new EngineEventBus()
      const budget = new BudgetTracker(10, bus)
      expect(budget.tryAcquire(5)).toBe(true)
      expect(budget.spent()).toBeCloseTo(5)
    })

    it('rejects when would exceed budget', () => {
      const bus = new EngineEventBus()
      const budget = new BudgetTracker(10, bus)
      expect(budget.tryAcquire(8)).toBe(true)
      expect(budget.tryAcquire(5)).toBe(false)
      expect(budget.spent()).toBeCloseTo(8) // second call did not increment
    })

    it('always succeeds when unlimited', () => {
      const bus = new EngineEventBus()
      const budget = new BudgetTracker(null, bus)
      expect(budget.tryAcquire(999)).toBe(true)
    })

    it('emits budget_update on success', () => {
      const bus = new EngineEventBus()
      const events: number[] = []
      bus.on((e) => {
        if (e.kind === 'budget_update') events.push(e.spent)
      })
      const budget = new BudgetTracker(10, bus)
      budget.tryAcquire(3)
      expect(events).toHaveLength(1)
      expect(events[0]).toBeCloseTo(3)
    })

    it('does not emit budget_update on failure', () => {
      const bus = new EngineEventBus()
      const events: number[] = []
      bus.on((e) => {
        if (e.kind === 'budget_update') events.push(e.spent)
      })
      const budget = new BudgetTracker(1, bus)
      budget.tryAcquire(5)
      expect(events).toHaveLength(0)
    })
  })

  describe('adjust', () => {
    it('corrects reservation upward', () => {
      const bus = new EngineEventBus()
      const budget = new BudgetTracker(10, bus)
      budget.tryAcquire(5)
      budget.adjust(5, 7)
      expect(budget.spent()).toBeCloseTo(7)
    })

    it('corrects reservation downward', () => {
      const bus = new EngineEventBus()
      const budget = new BudgetTracker(10, bus)
      budget.tryAcquire(5)
      budget.adjust(5, 3)
      expect(budget.spent()).toBeCloseTo(3)
    })

    it('clamps spent to zero', () => {
      const bus = new EngineEventBus()
      const budget = new BudgetTracker(10, bus)
      budget.tryAcquire(5)
      budget.adjust(5, -1)
      expect(budget.spent()).toBe(0)
    })

    it('emits budget_update', () => {
      const bus = new EngineEventBus()
      const events: number[] = []
      bus.on((e) => {
        if (e.kind === 'budget_update') events.push(e.spent)
      })
      const budget = new BudgetTracker(10, bus)
      budget.tryAcquire(5)
      budget.adjust(5, 3)
      // tryAcquire emits 5, adjust emits 3
      expect(events).toHaveLength(2)
      expect(events[1]).toBeCloseTo(3)
    })
  })

  describe('isExceeded', () => {
    it('returns false when under budget', () => {
      const bus = new EngineEventBus()
      const budget = new BudgetTracker(10, bus)
      budget.record(5)
      expect(budget.isExceeded()).toBe(false)
    })

    it('returns true when over budget', () => {
      const bus = new EngineEventBus()
      const budget = new BudgetTracker(5, bus)
      budget.record(10)
      expect(budget.isExceeded()).toBe(true)
    })

    it('returns false when unlimited', () => {
      const bus = new EngineEventBus()
      const budget = new BudgetTracker(null, bus)
      budget.record(999)
      expect(budget.isExceeded()).toBe(false)
    })
  })
})
