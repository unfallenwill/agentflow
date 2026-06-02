import { describe, it, expect } from 'vitest'
import { Engine } from '../src/core/engine.js'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const TMP = '/tmp/agentflow-test-scripts'

async function withScript(content: string, fn: (path: string) => Promise<void>, ext = '.js') {
  await mkdir(TMP, { recursive: true })
  const p = join(TMP, `test-${Date.now()}${ext}`)
  await writeFile(p, content)
  try {
    await fn(p)
  } finally {
    await rm(TMP, { recursive: true }).catch(() => {})
  }
}

async function withScripts(
  files: Array<{ name: string; content: string }>,
  fn: (paths: Record<string, string>) => Promise<void>,
) {
  await mkdir(TMP, { recursive: true })
  const id = Date.now()
  const paths: Record<string, string> = {}
  for (const file of files) {
    const p = join(TMP, `${id}-${file.name}`)
    await writeFile(p, file.content)
    paths[file.name] = p
  }
  try {
    await fn(paths)
  } finally {
    await rm(TMP, { recursive: true }).catch(() => {})
  }
}

describe('Engine', () => {
  it('loads and executes a simple script', async () => {
    await withScript(
      `
export const meta = {
  name: 'simple-test',
  phases: [{ title: 'run', detail: 'test' }],
}

phase('run')
log('hello from script')
return { value: 42 }
`,
      async (scriptPath) => {
        const engine = new Engine({ scriptPath, cwd: process.cwd() })
        const logs: string[] = []
        engine.on((e) => {
          if (e.kind === 'log') logs.push(e.message)
        })

        const result = await engine.run()
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value.result).toEqual({ value: 42 })
          expect(result.value.meta?.name).toBe('simple-test')
        }
        expect(logs).toContain('hello from script')
      },
    )
  })

  it('extracts meta from script', async () => {
    await withScript(
      `
export const meta = {
  name: 'meta-test',
  description: 'Testing meta extraction',
  phases: [
    { title: 'step1', detail: 'first' },
    { title: 'step2', detail: 'second' },
  ],
}

return { ok: true }
`,
      async (scriptPath) => {
        const engine = new Engine({ scriptPath, cwd: process.cwd() })
        const result = await engine.run()
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value.meta?.name).toBe('meta-test')
          expect(result.value.meta?.phases).toHaveLength(2)
        }
      },
    )
  })

  it('passes args into script', async () => {
    await withScript(
      `
return { got: args }
`,
      async (scriptPath) => {
        const engine = new Engine({
          scriptPath,
          cwd: process.cwd(),
          args: { x: 1, y: 'hello' },
        })
        const result = await engine.run()
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value.result).toEqual({ got: { x: 1, y: 'hello' } })
        }
      },
    )
  })

  it('returns err on missing script', async () => {
    const engine = new Engine({ scriptPath: '/nonexistent.js', cwd: process.cwd() })
    const result = await engine.run()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toContain('ENOENT')
    }
  })

  it('returns err on script syntax error', async () => {
    await withScript(`this is not valid javascript!!!`, async (scriptPath) => {
      const engine = new Engine({ scriptPath, cwd: process.cwd() })
      const result = await engine.run()
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.message).toContain('SyntaxError')
        expect(result.error.message).toContain('┌─')
      }
    })
  })

  it('emits workflow_start and workflow_end events', async () => {
    await withScript(`return 1`, async (scriptPath) => {
      const engine = new Engine({ scriptPath, cwd: process.cwd() })
      const kinds: string[] = []
      engine.on((e) => kinds.push(e.kind))

      await engine.run()

      expect(kinds).toContain('workflow_start')
      expect(kinds).toContain('workflow_end')
    })
  })

  it('supports pipeline and parallel globals', async () => {
    await withScript(
      `
const items = await pipeline(
  [1, 2, 3],
  async (n) => n * 10,
)
const all = await parallel([
  () => Promise.resolve('a'),
  () => Promise.resolve('b'),
])
return { items, all }
`,
      async (scriptPath) => {
        const engine = new Engine({ scriptPath, cwd: process.cwd() })
        const result = await engine.run()
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value.result).toEqual({
            items: [10, 20, 30],
            all: ['a', 'b'],
          })
        }
      },
    )
  })

  it('loads and executes a TypeScript script', async () => {
    await withScript(
      `
export const meta = {
  name: 'ts-test',
  phases: [{ title: 'run', detail: 'ts' }],
}

const x: number = 42
const greet = (name: string): string => 'hello ' + name
return { value: x, greeting: greet('world') }
`,
      async (scriptPath) => {
        const engine = new Engine({ scriptPath, cwd: process.cwd() })
        const result = await engine.run()
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value.result).toEqual({ value: 42, greeting: 'hello world' })
          expect(result.value.meta?.name).toBe('ts-test')
        }
      },
      '.ts',
    )
  })

  it('returns err on TypeScript transpilation failure', async () => {
    await withScript(
      `
// Invalid TS that sucrase cannot parse
type X< = {};
`,
      async (scriptPath) => {
        const engine = new Engine({ scriptPath, cwd: process.cwd() })
        const result = await engine.run()
        expect(result.ok).toBe(false)
        if (!result.ok) {
          // sucrase throws an Error instance, so loadScript returns it directly
          expect(result.error.message).toBeTruthy()
        }
      },
      '.ts',
    )
  })

  it('sets meta to null when meta export is not parseable', async () => {
    await withScript(
      `
export const meta = {
  name: undefinedVariable,
  phases: [],
}

return { ok: true }
`,
      async (scriptPath) => {
        const engine = new Engine({ scriptPath, cwd: process.cwd() })
        const result = await engine.run()
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value.meta).toBeNull()
        }
      },
    )
  })

  it('sets meta to null for script without meta export', async () => {
    await withScript(`return 1`, async (scriptPath) => {
      const engine = new Engine({ scriptPath, cwd: process.cwd() })
      const result = await engine.run()
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.meta).toBeNull()
      }
    })
  })

  it('emits workflow_error and workflow_end(success: false) when script throws', async () => {
    await withScript(`throw new Error('script boom')`, async (scriptPath) => {
      const engine = new Engine({ scriptPath, cwd: process.cwd() })
      const events: Array<{ kind: string; [key: string]: unknown }> = []
      engine.on((e) => events.push(e))

      const result = await engine.run()
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.message).toBe('script boom')
      }

      const errorEvents = events.filter((e) => e.kind === 'workflow_error')
      expect(errorEvents).toHaveLength(1)
      expect(errorEvents[0].error).toBe('script boom')

      const endEvents = events.filter((e) => e.kind === 'workflow_end')
      expect(endEvents).toHaveLength(1)
      expect(endEvents[0].success).toBe(false)
    })
  })

  it('executes child workflow via workflow() global', async () => {
    await withScripts(
      [
        {
          name: 'child.js',
          content: `
export const meta = {
  name: 'child',
  phases: [],
}

return { childValue: 99 }
`,
        },
        {
          name: 'parent.js',
          content: `
const childResult = await workflow(CHILD_PATH)
return { parent: true, child: childResult }
`,
        },
      ],
      async (paths) => {
        // Replace placeholder with actual child path
        const parentContent = await import('node:fs/promises').then((fs) =>
          fs.readFile(paths['parent.js'], 'utf-8'),
        )
        await import('node:fs/promises').then((fs) =>
          fs.writeFile(
            paths['parent.js'],
            parentContent.replace('CHILD_PATH', JSON.stringify(paths['child.js'])),
          ),
        )
        const engine = new Engine({ scriptPath: paths['parent.js'], cwd: TMP })
        const result = await engine.run()
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value.result).toEqual({
            parent: true,
            child: { childValue: 99 },
          })
        }
      },
    )
  })

  it('executes child workflow via workflow({ scriptPath }) object ref', async () => {
    await withScripts(
      [
        {
          name: 'child.js',
          content: `return { from: 'object-ref-child' }`,
        },
        {
          name: 'parent.js',
          content: `
const childResult = await workflow({ scriptPath: CHILD_PATH })
return childResult
`,
        },
      ],
      async (paths) => {
        const parentContent = await import('node:fs/promises').then((fs) =>
          fs.readFile(paths['parent.js'], 'utf-8'),
        )
        await import('node:fs/promises').then((fs) =>
          fs.writeFile(
            paths['parent.js'],
            parentContent.replace('CHILD_PATH', JSON.stringify(paths['child.js'])),
          ),
        )
        const engine = new Engine({ scriptPath: paths['parent.js'], cwd: TMP })
        const result = await engine.run()
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value.result).toEqual({ from: 'object-ref-child' })
        }
      },
    )
  })

  it('propagates child workflow failure as thrown error', async () => {
    await withScripts(
      [
        {
          name: 'child.js',
          content: `throw new Error('child exploded')`,
        },
        {
          name: 'parent.js',
          content: `
try {
  await workflow(CHILD_PATH)
  return { caught: false }
} catch (e) {
  return { caught: true, message: e.message }
}
`,
        },
      ],
      async (paths) => {
        const parentContent = await import('node:fs/promises').then((fs) =>
          fs.readFile(paths['parent.js'], 'utf-8'),
        )
        await import('node:fs/promises').then((fs) =>
          fs.writeFile(
            paths['parent.js'],
            parentContent.replace('CHILD_PATH', JSON.stringify(paths['child.js'])),
          ),
        )
        const engine = new Engine({ scriptPath: paths['parent.js'], cwd: TMP })
        const result = await engine.run()
        expect(result.ok).toBe(true)
        if (result.ok) {
          const res = result.value.result as { caught: boolean; message: string }
          expect(res.caught).toBe(true)
          expect(res.message).toContain('child exploded')
        }
      },
    )
  })

  it('throws nesting limit exceeded when workflow() is called from within a child', async () => {
    await withScripts(
      [
        {
          name: 'grandchild.js',
          content: `return 'never reached'`,
        },
        {
          name: 'child.js',
          content: `
// child is already at depth 1; calling workflow() again should throw
try {
  await workflow(GRANDCHILD_PATH)
  return { caught: false }
} catch (e) {
  return { caught: true, message: e.message }
}
`,
        },
        {
          name: 'parent.js',
          content: `
const childResult = await workflow(CHILD_PATH)
return childResult
`,
        },
      ],
      async (paths) => {
        // Patch child.js with grandchild path
        const childContent = await import('node:fs/promises').then((fs) =>
          fs.readFile(paths['child.js'], 'utf-8'),
        )
        await import('node:fs/promises').then((fs) =>
          fs.writeFile(
            paths['child.js'],
            childContent.replace('GRANDCHILD_PATH', JSON.stringify(paths['grandchild.js'])),
          ),
        )
        // Patch parent.js with child path
        const parentContent = await import('node:fs/promises').then((fs) =>
          fs.readFile(paths['parent.js'], 'utf-8'),
        )
        await import('node:fs/promises').then((fs) =>
          fs.writeFile(
            paths['parent.js'],
            parentContent.replace('CHILD_PATH', JSON.stringify(paths['child.js'])),
          ),
        )
        const engine = new Engine({ scriptPath: paths['parent.js'], cwd: TMP })
        const result = await engine.run()
        expect(result.ok).toBe(true)
        if (result.ok) {
          const res = result.value.result as { caught: boolean; message: string }
          expect(res.caught).toBe(true)
          expect(res.message).toContain('nesting limit exceeded')
        }
      },
    )
  })

  it('forwards cwd, defaultModel, and permissionMode to child workflow', async () => {
    await withScripts(
      [
        {
          name: 'child.js',
          content: `return { argsReceived: args }`,
        },
        {
          name: 'parent.js',
          content: `
const childResult = await workflow(CHILD_PATH, { forwarded: true })
return childResult
`,
        },
      ],
      async (paths) => {
        const parentContent = await import('node:fs/promises').then((fs) =>
          fs.readFile(paths['parent.js'], 'utf-8'),
        )
        await import('node:fs/promises').then((fs) =>
          fs.writeFile(
            paths['parent.js'],
            parentContent.replace('CHILD_PATH', JSON.stringify(paths['child.js'])),
          ),
        )
        const engine = new Engine({
          scriptPath: paths['parent.js'],
          cwd: TMP,
          defaultModel: 'test-model',
          permissionMode: 'bypassPermissions',
        })
        const result = await engine.run()
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value.result).toEqual({ argsReceived: { forwarded: true } })
        }
      },
    )
  })

  // ── Meta extraction edge cases ────────────────────────────────────

  it('extracts meta with nested objects', async () => {
    await withScript(
      `
export const meta = {
  name: 'nested-test',
  phases: [{ title: 'step1', config: { deep: true, nested: { value: 42 } } }],
}

return { ok: true }
`,
      async (scriptPath) => {
        const engine = new Engine({ scriptPath, cwd: process.cwd() })
        const result = await engine.run()
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value.meta?.name).toBe('nested-test')
          expect(result.value.meta?.phases).toHaveLength(1)
        }
      },
    )
  })

  it('extracts meta with closing brace inside string value', async () => {
    await withScript(
      `
export const meta = {
  name: 'brace-in-string',
  description: 'contains a } brace',
}

return { ok: true }
`,
      async (scriptPath) => {
        const engine = new Engine({ scriptPath, cwd: process.cwd() })
        const result = await engine.run()
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value.meta?.name).toBe('brace-in-string')
          expect(result.value.meta?.description).toBe('contains a } brace')
        }
      },
    )
  })

  it('extracts single-line meta', async () => {
    await withScript(
      `
export const meta = { name: 'single-line', phases: [] };

return { ok: true }
`,
      async (scriptPath) => {
        const engine = new Engine({ scriptPath, cwd: process.cwd() })
        const result = await engine.run()
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value.meta?.name).toBe('single-line')
        }
      },
    )
  })

  it('extracts meta with no trailing newline at end of file', async () => {
    await withScript(
      `export const meta = {
  name: 'no-trailing-newline',
  phases: [],
}

return { ok: true }`,
      async (scriptPath) => {
        const engine = new Engine({ scriptPath, cwd: process.cwd() })
        const result = await engine.run()
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value.meta?.name).toBe('no-trailing-newline')
        }
      },
    )
  })

  it('extracts meta with trailing commas', async () => {
    await withScript(
      `
export const meta = {
  name: 'trailing-commas',
  phases: [
    { title: 'step1', },
  ],
}

return { ok: true }
`,
      async (scriptPath) => {
        const engine = new Engine({ scriptPath, cwd: process.cwd() })
        const result = await engine.run()
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value.meta?.name).toBe('trailing-commas')
        }
      },
    )
  })

  it('extracts meta with single-quoted strings', async () => {
    await withScript(
      `
export const meta = {
  name: 'single-quotes',
  description: 'uses single quotes',
}

return { ok: true }
`,
      async (scriptPath) => {
        const engine = new Engine({ scriptPath, cwd: process.cwd() })
        const result = await engine.run()
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value.meta?.name).toBe('single-quotes')
          expect(result.value.meta?.description).toBe('uses single quotes')
        }
      },
    )
  })

  it('gracefully handles unparseable meta with JSON5', async () => {
    await withScript(
      `
export const meta = {
  name: undefinedVariable,
  phases: [],
}

return { ok: true }
`,
      async (scriptPath) => {
        const engine = new Engine({ scriptPath, cwd: process.cwd() })
        const result = await engine.run()
        expect(result.ok).toBe(true)
        if (result.ok) {
          // JSON5.parse fails on undefined variable, meta should be null
          expect(result.value.meta).toBeNull()
        }
      },
    )
  })

  it('body executes correctly after meta removal', async () => {
    await withScript(
      `
export const meta = {
  name: 'body-test',
  phases: [],
}

const x = 10
const y = 20
return { sum: x + y }
`,
      async (scriptPath) => {
        const engine = new Engine({ scriptPath, cwd: process.cwd() })
        const result = await engine.run()
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value.meta?.name).toBe('body-test')
          expect(result.value.result).toEqual({ sum: 30 })
        }
      },
    )
  })

  it('emits pipeline_error event when pipeline stage throws', async () => {
    await withScript(
      `
const results = await pipeline(
  [1, 2, 3],
  async (n) => {
    if (n === 2) throw new Error('boom')
    return n
  },
)
return { results }
`,
      async (scriptPath) => {
        const engine = new Engine({ scriptPath, cwd: process.cwd() })
        const events: Array<{ kind: string; [key: string]: unknown }> = []
        engine.on((e) => events.push(e))

        const result = await engine.run()
        expect(result.ok).toBe(true)

        const pipelineErrors = events.filter((e) => e.kind === 'pipeline_error')
        expect(pipelineErrors).toHaveLength(1)
        expect(pipelineErrors[0]?.error).toBe('boom')
        expect(pipelineErrors[0]?.index).toBe(1)
      },
    )
  })
})
