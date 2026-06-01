import { describe, it, expect } from 'vitest'
import { Semaphore } from '../src/utils/semaphore.js'
import { parallelExecute } from '../src/utils/parallel.js'

describe('Semaphore', () => {
  it('allows up to max concurrent acquires', async () => {
    const sem = new Semaphore(3)
    const r1 = await sem.acquire()
    const r2 = await sem.acquire()
    const r3 = await sem.acquire()
    // All 3 acquired without blocking
    expect(true).toBe(true)
    r1()
    r2()
    r3()
  })

  it('blocks when max is reached', async () => {
    const sem = new Semaphore(2)
    const r1 = await sem.acquire()
    const r2 = await sem.acquire()

    let acquired = false
    const p = sem.acquire().then((release) => {
      acquired = true
      release()
    })

    // Give microtasks a chance to run
    await new Promise((r) => setTimeout(r, 10))
    expect(acquired).toBe(false)

    r1()
    await p
    expect(acquired).toBe(true)

    r2()
  })
})

describe('parallelExecute', () => {
  it('executes all thunks and returns results', async () => {
    const results = await parallelExecute([
      () => Promise.resolve(1),
      () => Promise.resolve(2),
      () => Promise.resolve(3),
    ])
    expect(results).toEqual([1, 2, 3])
  })

  it('returns null for rejected thunks', async () => {
    const results = await parallelExecute([
      () => Promise.resolve('ok'),
      () => Promise.reject(new Error('fail')),
      () => Promise.resolve('also ok'),
    ])
    expect(results).toEqual(['ok', null, 'also ok'])
  })

  it('handles empty array', async () => {
    const results = await parallelExecute([])
    expect(results).toEqual([])
  })
})
