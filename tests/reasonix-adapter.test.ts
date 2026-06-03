import { describe, it, expect, afterAll } from 'vitest'
import {
  buildArgs,
  cleanOutput,
  extractJson,
  parseMetrics,
  resolvePricing,
  estimateCostFromTokens,
} from '../src/core/adapters/reasonix.js'
import type { RunMetrics } from '../src/core/adapters/reasonix.js'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ── buildArgs ──────────────────────────────────────────────────────────

describe('buildArgs', () => {
  const metricsPath = '/tmp/metrics.json'

  it('includes run subcommand, --metrics, and prompt', () => {
    const args = buildArgs('hello', {}, metricsPath)
    expect(args).toEqual(['run', '--metrics', metricsPath, 'hello'])
  })

  it('includes --model when model is set', () => {
    const args = buildArgs('hello', { model: 'deepseek-v4-flash' }, metricsPath)
    expect(args).toEqual(['run', '--metrics', metricsPath, '--model', 'deepseek-v4-flash', 'hello'])
  })

  it('omits --model when model is undefined', () => {
    const args = buildArgs('task', {}, metricsPath)
    expect(args).not.toContain('--model')
  })
})

// ── resolvePricing ─────────────────────────────────────────────────────

describe('resolvePricing', () => {
  it('matches deepseek-v4-flash', () => {
    const p = resolvePricing('deepseek-v4-flash')
    expect(p.input).toBe(0.1)
    expect(p.output).toBe(0.4)
  })

  it('matches deepseek-v4-pro', () => {
    const p = resolvePricing('deepseek-v4-pro')
    expect(p.input).toBe(2.0)
    expect(p.output).toBe(8.0)
  })

  it('matches mimo-v2.5-pro', () => {
    const p = resolvePricing('mimo-v2.5-pro')
    expect(p.input).toBe(2.0)
  })

  it('returns default for unknown model', () => {
    const p = resolvePricing('unknown-model')
    expect(p).toEqual({ input: 0.27, cachedInput: 0.07, output: 1.1 })
  })

  it('returns default for undefined model', () => {
    const p = resolvePricing(undefined)
    expect(p).toEqual({ input: 0.27, cachedInput: 0.07, output: 1.1 })
  })
})

// ── estimateCostFromTokens ─────────────────────────────────────────────

describe('estimateCostFromTokens', () => {
  it('returns metrics.cost when provided', () => {
    const metrics: RunMetrics = { cost: 0.005, prompt_tokens: 1000, completion_tokens: 500 }
    expect(estimateCostFromTokens(metrics, 'deepseek-v4-flash')).toBe(0.005)
  })

  it('calculates from token counts when cost is 0', () => {
    const metrics: RunMetrics = {
      cost: 0,
      prompt_tokens: 1_000_000,
      completion_tokens: 1_000_000,
      cache_hit_tokens: 500_000,
    }
    const cost = estimateCostFromTokens(metrics, 'deepseek-v4-flash')
    expect(cost).toBeCloseTo(0.4625, 4)
  })

  it('returns 0 when no token data', () => {
    const metrics: RunMetrics = {}
    expect(estimateCostFromTokens(metrics, 'deepseek-v4-flash')).toBe(0)
  })

  it('uses default pricing when model is undefined', () => {
    const metrics: RunMetrics = {
      prompt_tokens: 1_000_000,
      completion_tokens: 0,
    }
    const cost = estimateCostFromTokens(metrics, undefined)
    expect(cost).toBeCloseTo(0.27, 4)
  })
})

// ── parseMetrics ───────────────────────────────────────────────────────

describe('parseMetrics', () => {
  const testDir = join(tmpdir(), `batonjs-reasonix-test-${Date.now()}`)

  mkdirSync(testDir, { recursive: true })

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('parses valid metrics JSON', () => {
    const path = join(testDir, 'metrics.json')
    writeFileSync(
      path,
      JSON.stringify({
        model: 'deepseek-v4-flash',
        steps: 3,
        cost: 0.01,
        prompt_tokens: 5000,
        completion_tokens: 2000,
        cache_hit_tokens: 1000,
        cache_miss_tokens: 4000,
      }),
    )
    const result = parseMetrics(path)
    expect(result.model).toBe('deepseek-v4-flash')
    expect(result.cost).toBe(0.01)
    expect(result.prompt_tokens).toBe(5000)
  })

  it('returns empty object for missing file', () => {
    const result = parseMetrics('/nonexistent/metrics.json')
    expect(result).toEqual({})
  })

  it('returns empty object for invalid JSON', () => {
    const path = join(testDir, 'bad.json')
    writeFileSync(path, 'not json')
    const result = parseMetrics(path)
    expect(result).toEqual({})
  })
})

// ── cleanOutput ────────────────────────────────────────────────────────

describe('cleanOutput', () => {
  it('strips ANSI escape codes', () => {
    const raw = '\u001b[2m  ▎ thinking\u001b[0m\nHello, World!'
    expect(cleanOutput(raw)).toBe('▎ thinking\nHello, World!')
  })

  it('strips trailing token stats line', () => {
    const raw =
      'Hello!\n  · 11067 tok · in 11028 (11008 cached / 20 new) · out 39 (19 reasoning) · ¥0.0003'
    expect(cleanOutput(raw)).toBe('Hello!')
  })

  it('strips token stats from ANSI content', () => {
    const raw =
      '\u001b[2m  ▎ thinking\u001b[0m\nSome text\n  · 11067 tok · in 11028 (11008 cached / 20 new) · out 39 (19 reasoning) · ¥0.0003'
    expect(cleanOutput(raw)).toBe('▎ thinking\nSome text')
  })

  it('returns clean text unchanged', () => {
    expect(cleanOutput('Just plain text')).toBe('Just plain text')
  })

  it('handles empty string', () => {
    expect(cleanOutput('')).toBe('')
  })

  it('strips token stats with USD currency', () => {
    const raw = 'Result text\n  · 500 tok · in 400 (300 cached / 100 new) · out 100 · $0.0020'
    expect(cleanOutput(raw)).toBe('Result text')
  })
})

// ── extractJson ────────────────────────────────────────────────────────

describe('extractJson', () => {
  it('returns the text as-is when it is already valid JSON', () => {
    const json = '{"ideas":[{"name":"foo","description":"bar"}]}'
    expect(extractJson(json)).toBe(json)
  })

  it('extracts JSON after thinking/reasoning text', () => {
    const raw =
      'Let me think about this...\nSome reasoning here.\n{"ideas":[{"name":"CodePilot","description":"AI pair programmer"}]}'
    const result = extractJson(raw)
    expect(result).not.toBeNull()
    expect(JSON.parse(result!)).toEqual({
      ideas: [{ name: 'CodePilot', description: 'AI pair programmer' }],
    })
  })

  it('extracts JSON from markdown-fenced output', () => {
    const raw = '```json\n{"ideas":[]}\n```'
    expect(extractJson(raw)).toBe('{"ideas":[]}')
  })

  it('finds the first valid JSON object when multiple exist', () => {
    const raw = 'prefix {"a":1} middle {"b":2} suffix'
    const result = extractJson(raw)
    expect(result).toBe('{"a":1}')
  })

  it('returns null when no JSON found', () => {
    expect(extractJson('just plain text no json')).toBeNull()
  })

  it('handles JSON array', () => {
    const raw = 'Some text\n[1, 2, 3]'
    const result = extractJson(raw)
    expect(result).toBe('[1, 2, 3]')
  })

  it('handles deeply nested JSON after reasoning', () => {
    const raw =
      '▎ thinking\nThe user wants ideas for...\n{"ideas":[{"name":"A","description":"desc A"},{"name":"B","description":"desc B"}]}'
    const result = extractJson(raw)
    expect(result).not.toBeNull()
    const parsed = JSON.parse(result!)
    expect(parsed.ideas).toHaveLength(2)
  })
})
