import type { EngineEvent, EngineEventHandler } from '../types.js'

/**
 * Synchronous, type-safe event bus.
 *
 * - Synchronous dispatch: events are always emitted in order, never lost.
 * - `on()` returns an unsubscribe function for cleanup.
 */
export class EngineEventBus {
  private readonly listeners: EngineEventHandler[] = []

  /** Subscribe to all events. Returns an unsubscribe function. */
  on(handler: EngineEventHandler): () => void {
    this.listeners.push(handler)
    return () => {
      const idx = this.listeners.indexOf(handler)
      if (idx !== -1) this.listeners.splice(idx, 1)
    }
  }

  /** Emit an event to all subscribers (synchronous). */
  emit(event: EngineEvent): void {
    // Snapshot the listener array before iteration so that handlers which
    // subscribe (push) or unsubscribe (splice) during dispatch cannot
    // corrupt the iterator.  New listeners added mid-dispatch will not
    // receive the current event — this matches the semantics of most
    // synchronous event buses (e.g. Node.js EventEmitter).
    const snapshot = [...this.listeners]
    for (let i = 0; i < snapshot.length; i++) {
      try {
        const handler = snapshot[i]
        if (handler !== undefined) {
          handler(event)
        }
      } catch (error: unknown) {
        console.error('[BatonJS] Event handler threw:', error)
      }
    }
  }
}
