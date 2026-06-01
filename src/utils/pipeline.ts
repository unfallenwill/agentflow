/**
 * Streaming pipeline: each item flows through all stages independently.
 *
 * Item A can be in stage 3 while item B is still in stage 1.
 * A stage that throws (or returns null/undefined) drops the item to null.
 *
 * @param items    Source items to process
 * @param stages   Transformation stages; each receives (prevResult, originalItem, index)
 * @returns        Array aligned with input; null where an item was dropped
 */
export async function pipelineExecute(
  items: unknown[],
  stages: Array<(prev: unknown, original: unknown, index: number) => Promise<unknown>>,
): Promise<unknown[]> {
  return Promise.all(
    items.map(async (item, index) => {
      let current: unknown = item
      for (const stage of stages) {
        try {
          current = await stage(current, item, index)
        } catch {
          return null
        }
        if (current === null || current === undefined) {
          return null
        }
      }
      return current
    }),
  )
}
