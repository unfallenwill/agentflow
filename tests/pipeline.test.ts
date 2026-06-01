import { describe, it, expect } from 'vitest'
import { pipelineExecute } from '../src/utils/pipeline.js'

describe('pipeline', () => {
  it('passes each item through all stages', async () => {
    const results = await pipelineExecute([1, 2, 3], [async (n) => n * 2, async (n) => n + 1])
    expect(results).toEqual([3, 5, 7])
  })

  it('items flow independently (no barrier)', async () => {
    const order: string[] = []
    await pipelineExecute(
      ['a', 'b'],
      [
        async (item) => {
          order.push(`s1-${item}`)
          return item
        },
        async (item) => {
          order.push(`s2-${item}`)
          return item
        },
      ],
    )
    // All stage-1 calls happen before any stage-2 (Promise.all per item)
    expect(order).toEqual(['s1-a', 's1-b', 's2-a', 's2-b'])
  })

  it('drops item to null when stage throws', async () => {
    const results = await pipelineExecute(
      [1, 2, 3],
      [
        async (n) => {
          if (n === 2) throw new Error('fail')
          return n
        },
      ],
    )
    expect(results).toEqual([1, null, 3])
  })

  it('drops item to null when stage returns null', async () => {
    const results = await pipelineExecute(
      ['a', 'b', 'c'],
      [async (item) => (item === 'b' ? null : item)],
    )
    expect(results).toEqual(['a', null, 'c'])
  })

  it('stage receives original item and index', async () => {
    const results = await pipelineExecute(
      ['x', 'y'],
      [
        async (prev, original, index) => ({ prev, original, index }),
        async (prev, original, index) => ({ ...prev, index }),
      ],
    )
    expect(results).toEqual([
      { index: 0, original: 'x', prev: 'x' },
      { index: 1, original: 'y', prev: 'y' },
    ])
  })

  it('handles empty array', async () => {
    const results = await pipelineExecute([], [])
    expect(results).toEqual([])
  })
})
