import type { EngineEvent, EngineEventHandler } from './types.js';

/**
 * Synchronous, type-safe event bus.
 *
 * - Synchronous dispatch: events are always emitted in order, never lost.
 * - `on()` returns an unsubscribe function for cleanup.
 */
export class EngineEventBus {
  private readonly listeners: EngineEventHandler[] = [];

  /** Subscribe to all events. Returns an unsubscribe function. */
  on(handler: EngineEventHandler): () => void {
    this.listeners.push(handler);
    return () => {
      const idx = this.listeners.indexOf(handler);
      if (idx !== -1) this.listeners.splice(idx, 1);
    };
  }

  /** Emit an event to all subscribers (synchronous). */
  emit(event: EngineEvent): void {
    for (const handler of this.listeners) {
      handler(event);
    }
  }
}
