#!/usr/bin/env node
import { Engine } from './index.js'
import type { EngineOptions, SdkName } from './index.js'

const argv = process.argv.slice(2)

/** Write a message to stderr synchronously and exit with code 1. */
function fatal(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
  console.log(`
Usage: agentflow <script> [options]

Options:
  --args <json>    Pass arguments to the script as the \`args\` global
  --budget <usd>   Set max budget in USD (default: unlimited)
  --concurrency <n> Max concurrent agents (default: 10)
  --cwd <dir>      Working directory for agents (default: .)
  --model <model>  Default model for agents
  --sdk <name>     SDK backend: 'anthropic' (default) or 'codebuddy'
  --help, -h       Show this help message

Examples:
  agentflow ./workflows/demo.js
  agentflow ./workflows/demo.js --args '{"target": "src/"}'
  agentflow ./workflows/demo.js --budget 5.0 --concurrency 5
`)
  process.exit(0)
}

const scriptPath = argv[0]
let workflowArgs: unknown
let maxBudgetUsd: number | undefined
let maxConcurrency: number | undefined
let cwd: string | undefined
let defaultModel: string | undefined
let sdk: SdkName | undefined

for (let i = 1; i < argv.length; i++) {
  const flag = argv[i] as string
  const next = argv[i + 1]
  switch (flag) {
    case '--args':
      if (next === undefined) {
        fatal('--args requires a JSON value')
      }
      try {
        workflowArgs = JSON.parse(next)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        fatal(`Invalid JSON for --args: ${next}\nParse error: ${msg}`)
      }
      i++
      break
    case '--budget':
      if (next === undefined) {
        fatal('--budget requires a value')
      }
      maxBudgetUsd = parseFloat(next)
      if (Number.isNaN(maxBudgetUsd)) {
        fatal(`--budget requires a number, got: ${next}`)
      }
      i++
      break
    case '--concurrency':
      if (next === undefined) {
        fatal('--concurrency requires a value')
      }
      maxConcurrency = parseInt(next, 10)
      if (Number.isNaN(maxConcurrency)) {
        fatal(`--concurrency requires an integer, got: ${next}`)
      }
      i++
      break
    case '--cwd':
      if (next === undefined) {
        fatal('--cwd requires a path')
      }
      cwd = next
      i++
      break
    case '--model':
      if (next === undefined) {
        fatal('--model requires a value')
      }
      defaultModel = next
      i++
      break
    case '--sdk':
      if (next === undefined) {
        fatal('--sdk requires a value')
      }
      if (next !== 'anthropic' && next !== 'codebuddy') {
        fatal(`--sdk must be 'anthropic' or 'codebuddy', got: ${next}`)
      }
      sdk = next
      i++
      break
    default:
      fatal(`Unknown option: ${flag}`)
  }
}

const engineOpts: EngineOptions = {
  scriptPath: scriptPath as string,
  cwd: cwd ?? process.cwd(),
}
if (workflowArgs !== undefined) engineOpts.args = workflowArgs
if (maxBudgetUsd !== undefined) engineOpts.maxBudgetUsd = maxBudgetUsd
if (maxConcurrency !== undefined) engineOpts.maxConcurrency = maxConcurrency
if (defaultModel !== undefined) engineOpts.defaultModel = defaultModel
if (sdk !== undefined) engineOpts.sdk = sdk

const engine = new Engine(engineOpts)

engine.on((event) => {
  switch (event.kind) {
    case 'workflow_start':
      console.log(`\n🚀 ${event.meta?.name ?? scriptPath}`)
      break
    case 'phase':
      console.log(`📍 ${event.title}`)
      break
    case 'log':
      console.log(`  💬 ${event.message}`)
      break
    case 'agent_start':
      console.log(`  🤖 → ${event.label ?? 'agent'}`)
      break
    case 'agent_end':
      console.log(
        `  ✅ ← ${event.label ?? 'agent'} ($${event.cost.toFixed(4)}, ${(event.duration_ms / 1000).toFixed(1)}s)`,
      )
      break
    case 'agent_error':
      console.error(`  ❌ ← ${event.label ?? 'agent'}: ${event.error.slice(0, 100)}`)
      break
    case 'budget_update':
      console.log(`  💰 $${event.spent.toFixed(4)} spent`)
      break
    case 'workflow_end':
      console.log(
        `\n🏁 ${event.success ? '✅' : '❌'} | $${event.totalCost.toFixed(4)} | ${(event.duration_ms / 1000).toFixed(1)}s`,
      )
      break
    case 'workflow_error':
      // Error is surfaced via run() result and printed by fatal() below.
      // Event remains emitted for programmatic consumers.
      break
    case 'pipeline_error':
      console.error(
        `  ⚠️ pipeline error at item ${event.index}${event.stage !== undefined ? ` stage ${event.stage}` : ''}: ${event.error}`,
      )
      break
    case 'parallel_error':
      console.error(`  ⚠️ parallel error at thunk ${event.index}: ${event.error}`)
      break
    default: {
      const _exhaustive: never = event
      void _exhaustive
      break
    }
  }
})

const result = await engine.run()

if (result.ok) {
  console.log('\n📦', JSON.stringify(result.value.result, null, 2))
} else {
  fatal(`\n💥 ${result.error.message}`)
}
