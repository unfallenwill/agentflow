import type { EngineEventBus } from './events.js'
import type { BudgetHandle } from '../types.js'

/**
 * Tracks cumulative spending across all agent calls.
 * Enforces budget by returning false from `record()` when exceeded.
 */
export class BudgetTracker {
  private _spent = 0

  constructor(
    private readonly total: number | null,
    private readonly bus: EngineEventBus,
  ) {}

  /** Record cost from a completed agent call. Returns false if budget exceeded. */
  record(costUsd: number): boolean {
    this._spent += costUsd
    this.emitUpdate()
    return this.total === null || this._spent <= this.total
  }

  /** Atomically check and reserve budget. Returns false if would exceed. */
  tryAcquire(estimatedCost: number): boolean {
    if (this.total === null) return true
    if (this._spent + estimatedCost > this.total) return false
    this._spent += estimatedCost
    this.emitUpdate()
    return true
  }

  /** Adjust reserved budget to actual cost after SDK call completes. */
  adjust(reservedCost: number, actualCost: number): void {
    this._spent += actualCost - reservedCost
    this._spent = Math.max(0, this._spent)
    this.emitUpdate()
  }

  /** Emit a budget_update event with current state. */
  private emitUpdate(): void {
    this.bus.emit({
      kind: 'budget_update',
      spent: this._spent,
      remaining: this.remaining(),
    })
  }

  /** Check if cumulative spending has exceeded the budget. */
  isExceeded(): boolean {
    return this.total !== null && this._spent > this.total
  }

  /** Total spent so far in USD. */
  spent(): number {
    return this._spent
  }

  /** Remaining budget, or null if unlimited. */
  remaining(): number | null {
    return this.total === null ? null : Math.max(0, this.total - this._spent)
  }

  /** Create the frozen handle object exposed to scripts. */
  toHandle(): BudgetHandle {
    return Object.freeze({
      total: this.total,
      spent: () => this._spent,
      remaining: () => this.remaining(),
    })
  }
}
