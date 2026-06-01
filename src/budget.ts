import type { EngineEventBus } from './events.js';
import type { BudgetHandle } from './types.js';

/**
 * Tracks cumulative spending across all agent calls.
 * Enforces budget by returning false from `record()` when exceeded.
 */
export class BudgetTracker {
  private _spent = 0;

  constructor(
    private readonly total: number | null,
    private readonly bus: EngineEventBus,
  ) {}

  /** Record cost from a completed agent call. Returns false if budget exceeded. */
  record(costUsd: number): boolean {
    this._spent += costUsd;
    this.bus.emit({
      kind: 'budget_update',
      spent: this._spent,
      remaining: this.remaining(),
    });
    return this.total === null || this._spent <= this.total;
  }

  /** Total spent so far in USD. */
  spent(): number {
    return this._spent;
  }

  /** Remaining budget, or null if unlimited. */
  remaining(): number | null {
    return this.total === null ? null : Math.max(0, this.total - this._spent);
  }

  /** Create the frozen handle object exposed to scripts. */
  toHandle(): BudgetHandle {
    return Object.freeze({
      total: this.total,
      spent: () => this._spent,
      remaining: () => this.remaining(),
    });
  }
}
