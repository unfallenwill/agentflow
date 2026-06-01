/**
 * Execute thunks concurrently without a shared semaphore.
 * Barrier semantics: waits for all thunks to settle before returning.
 * A thunk that rejects resolves to `null` in the result array.
 *
 * Note: concurrency is controlled by `executeAgent()`'s semaphore,
 * not here. Double-acquiring would cause deadlocks.
 */
export async function parallelExecute(
  thunks: ReadonlyArray<() => Promise<unknown>>,
): Promise<unknown[]> {
  return Promise.all(
    thunks.map(async (thunk) => {
      try {
        return await thunk()
      } catch {
        return null
      }
    }),
  )
}
