import { describe, it, expect } from 'vitest'
import { ok, err } from '../src/utils/result.js'

describe('result', () => {
  it('ok() returns ok variant', () => {
    const r = ok(42)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe(42)
  })

  it('err() returns err variant', () => {
    const r = err(new Error('boom'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.message).toBe('boom')
  })

  it('discriminates via ok field', () => {
    const results = [ok(1), err('fail'), ok(3)]
    const sum = results.filter((r) => r.ok).reduce((s, r) => s + r.value, 0)
    expect(sum).toBe(4)
  })
})
