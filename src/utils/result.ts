/**
 * Result type — discriminated union for predictable error handling.
 *
 * Prefer this over throw/catch for control flow.
 * Invariant violations may still throw.
 *
 * @example
 * const r = ok(42);          // { ok: true, value: 42 }
 * const e = err(new Error('boom')); // { ok: false, error: Error }
 */
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E }

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}
