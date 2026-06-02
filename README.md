# AgentFlow

A lightweight workflow engine that orchestrates AI agents via pluggable SDK backends. Define multi-phase workflows as plain scripts with built-in parallel execution, streaming pipelines, budget tracking, and structured output.

**SDK backends:** [Anthropic Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) (default) · [CodeBuddy Agent SDK](https://www.npmjs.com/package/@tencent-ai/agent-sdk)

## Features

- **Dual SDK backend** — Anthropic Claude or CodeBuddy, selectable at runtime via `--sdk`
- **CLI** — `agentflow [options] <script>` with budget, concurrency, model, and SDK flags
- **Script-based workflows** — Write workflows as `.js` or `.ts` with top-level `await`
- **Structured output** — JSON Schema → validated output via AJV
- **Parallel execution** — `parallel()` with semaphore-based concurrency control
- **Streaming pipeline** — `pipeline()` where items flow through stages independently
- **Nested workflows** — `workflow()` for one level of child workflow composition
- **Budget tracking** — Real-time cost accumulation with USD limits
- **Retry with backoff** — Exponential backoff with jitter for transient errors (429, network)
- **Syntax diagnostics** — Pre-validation with precise file/line/column error reporting
- **Event system** — 11 typed event kinds for CLI/UI integration
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

Run it from the command line:

```bash
agentflow ./workflow.js
agentflow --sdk codebuddy --budget 5.0 ./workflow.js
agentflow ./workflow.js --args '{"target": "src/"}'
```

Or use the programmatic API:

```ts
import { Engine } from 'agentflow'

const engine = new Engine({
  scriptPath: './workflow.js',
  cwd: process.cwd(),
  maxConcurrency: 10,
  maxBudgetUsd: 2.0,
  sdk: 'anthropic',   // or 'codebuddy'
})

const unsub = engine.on(event => {
  if (event.kind === 'log') console.log(event.message)
  if (event.kind === 'phase') console.log(`→ ${event.title}`)
})

const result = await engine.run()
unsub()

if (result.ok) {
  console.log('Result:', result.value.result)
  console.log('Cost: $' + result.value.totalCostUsd.toFixed(4))
  console.log('Duration:', result.value.durationMs + 'ms')
}
```

## CLI

```
agentflow [options] [script]

Options:
  --args <json>       Pass arguments as the `args` global
  --budget <usd>      Max budget in USD (default: unlimited)
  --concurrency <n>   Max concurrent agents (default: 10)
  --cwd <dir>         Working directory (default: .)
  --model <model>     Default model for agents
  --sdk <name>        SDK backend: 'anthropic' (default) or 'codebuddy'
  -h, --help          Show help
```

Options and script path can appear in any order.

## Script API

The engine injects these globals into your workflow script:

| Global | Signature | Description |
|--------|-----------|-------------|
| `agent()` | `(prompt, opts?) → Promise<T \| null>` | Run an AI agent via the configured SDK |
| `parallel()` | `(thunks[]) → Promise<unknown[]>` | Run thunks concurrently with semaphore |
| `pipeline()` | `(items[], ...stages) → Promise<unknown[]>` | Stream items through stages independently |
| `workflow()` | `(ref, args?) → Promise<unknown>` | Execute a nested sub-workflow (one level) |
| `phase()` | `(title) → void` | Mark current execution phase |
| `log()` | `(message) → void` | Emit a log event |
| `budget` | `{ total, spent(), remaining() }` | Budget tracking handle |
| `args` | `unknown` | Custom arguments from `--args` or `EngineOptions.args` |

### `agent()` Options

```ts
interface AgentOpts {
  label?: string                      // Display label for events
  phase?: string                      // Phase assignment
  schema?: Record<string, unknown>    // JSON Schema for structured output
  model?: string                      // Override default model
  maxRetries?: number                 // Retry attempts for transient errors (default: 2)
}
```

### `workflow()` Usage

```js
// Run a nested workflow, sharing budget/semaphore/sdk
const result = await workflow('./child-workflow.js', { target: 'src/' })

// Or reference by path object
const result = await workflow({ scriptPath: './child.js' })
```

## Architecture

```
src/
  index.ts                # Public exports
  types.ts                # All public type definitions
  cli.ts                  # CLI entry point (cac)
  core/
    engine.ts             # Engine orchestrator: loading, globals, execution, nested workflows
    agent.ts              # Agent adapter: timeout, retry/backoff, schema validation
    sdk.ts                # SDK abstraction: dynamic import, SdkProvider interface
    budget.ts             # Cost tracker with pessimistic reservation
    events.ts             # Typed synchronous event bus
    context.ts            # Internal AgentContext interface
  utils/
    parallel.ts           # Barrier-style concurrent execution
    pipeline.ts           # Streaming multi-stage pipeline
    semaphore.ts          # Counting semaphore with one-shot release guard
    result.ts             # Result<T, E> discriminated union
    extract-meta.ts       # Safe meta export extraction (brace-depth + JSON5)
```

## Error Handling

The engine uses a three-tier model:

1. **Soft failure** — `agent()` returns `null` on error. Filter with `.filter(Boolean)`.
2. **Result pattern** — `engine.run()` returns `Result<EngineResult, Error>` (no throw for control flow).
3. **Pipeline drops** — A stage that throws drops the item to `null`.

Syntax errors in workflow scripts are caught before execution with precise diagnostics:

```
💥 SyntaxError: Unexpected identifier 'as'
  ┌─ workflow.js:169
  │ 7. Use of `as unknown as` type assertions — are they hiding real issues?
  │  ^^
```

## Development

```bash
npm run dev      # Run with tsx
npm run build    # Build with tsdown (Rolldown)
npm run check    # Type-check, lint, format check, and dependency audit
npm test         # Run tests with Vitest
```

## License

ISC
