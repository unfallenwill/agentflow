# AgentFlow

A lightweight workflow engine that orchestrates AI agents using the [CodeBuddy Agent SDK](https://www.npmjs.com/package/@tencent-ai/agent-sdk). Define multi-phase workflows as simple scripts with built-in parallel execution, pipeline processing, budget tracking, and structured output.

## Features

- **Script-based workflows** — Write workflows as plain JS with top-level `await`
- **Agent execution** — Powered by CodeBuddy Agent SDK (`query()`)
- **Structured output** — JSON Schema → `outputFormat` for type-safe results
- **Parallel execution** — `parallel()` with semaphore-based concurrency control
- **Streaming pipeline** — `pipeline()` where items flow through stages independently
- **Budget tracking** — Real-time cost accumulation across all agent calls
- **Event system** — Typed event bus for CLI/UI integration
- **Soft failure** — Agent errors return `null`; filter with `.filter(Boolean)`
- **Zero `any`** — Strict TypeScript with `exactOptionalPropertyTypes`

## Quick Start

```bash
npm install agentflow
```

Write a workflow script:

```js
// workflow.js
export const meta = {
  name: 'my-workflow',
  phases: [{ title: 'analyze' }, { title: 'summarize' }],
}

phase('analyze')
const findings = await parallel([
  () => agent('Check for security issues in the codebase', {
    schema: { type: 'object', properties: { issues: { type: 'array' } }, required: ['issues'] },
    label: 'security',
  }),
  () => agent('Check for performance bottlenecks', { label: 'perf' }),
])

phase('summarize')
const summary = await agent(
  'Summarize these findings: ' + JSON.stringify(findings.filter(Boolean)),
  { schema: SUMMARY_SCHEMA },
)

log('Done! Found ' + findings.filter(Boolean).length + ' reports')
return { summary }
```

Run it:

```ts
import { Engine } from 'agentflow'

const engine = new Engine({
  scriptPath: './workflow.js',
  cwd: process.cwd(),
  maxConcurrency: 5,
  maxBudgetUsd: 2.0,
})

engine.on(event => {
  if (event.kind === 'log') console.log(event.message)
  if (event.kind === 'phase') console.log(`→ ${event.title}`)
})

const result = await engine.run()
if (result.ok) {
  console.log('Result:', result.value.result)
}
```

## Script API

The engine injects these globals into your workflow script:

| Global | Signature | Description |
|--------|-----------|-------------|
| `agent()` | `(prompt, opts?) → Promise<T \| null>` | Run an AI agent via CodeBuddy SDK |
| `parallel()` | `(thunks[]) → Promise<unknown[]>` | Run thunks concurrently with semaphore |
| `pipeline()` | `(items[], ...stages) → Promise<unknown[]>` | Stream items through stages independently |
| `phase()` | `(title) → void` | Mark current execution phase |
| `log()` | `(message) → void` | Emit a log event |
| `budget` | `{ total, spent(), remaining() }` | Budget tracking handle |
| `args` | `unknown` | Custom arguments passed via `EngineOptions` |

### `agent()` Options

```ts
interface AgentOpts {
  label?: string              // Display label for events
  phase?: string              // Phase assignment
  schema?: Record<string, unknown>  // JSON Schema for structured output
  model?: string              // Override default model
}
```

## Architecture

```
src/
  index.ts          # Public exports
  engine.ts         # Engine orchestrator: script loading, global injection, execution
  agent.ts          # Agent adapter: wraps SDK query()
  concurrency.ts    # Semaphore + parallel()
  pipeline.ts       # Streaming pipeline
  events.ts         # Typed event bus
  budget.ts         # Cost tracker
  result.ts         # Result<T, E> discriminated union
  types.ts          # All type definitions
```

## Error Handling

The engine uses a three-tier model:

1. **Soft failure** — `agent()` returns `null` on error. Filter with `.filter(Boolean)`.
2. **Result pattern** — `engine.run()` returns `Result<EngineResult, Error>` (no throw for control flow).
3. **Pipeline drops** — A stage that throws drops the item to `null`.

## Development

```bash
npm run dev      # Run with tsx
npm run build    # Build with tsdown (Rolldown)
npm run check    # Type-check only
```

## License

ISC
