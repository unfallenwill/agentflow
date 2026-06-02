#!/usr/bin/env node
import { cac } from 'cac'
import { Engine } from './index.js'
import type { EngineOptions, SdkName } from './index.js'

/** Write a message to stderr synchronously and exit with code 1. */
function fatal(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

const cli = cac('batonjs')

cli
  .command('[script]', 'Run a workflow script')
  .option('--args <json>', 'Pass arguments to the script as the `args` global')
  .option('--budget <usd>', 'Set max budget in USD (default: unlimited)')
  .option('--concurrency <n>', 'Max concurrent agents (default: 2)')
  .option('--cwd <dir>', 'Working directory for agents (default: .)')
  .option('--model <model>', 'Default model for agents')
  .option('--sdk <name>', "SDK backend: 'anthropic' (default), 'codebuddy', or 'codex'")
  .option('--timeout <minutes>', 'Agent call timeout in minutes (default: 5)')
  .option(
    '--effort <level>',
    "Reasoning effort: 'medium', 'high', or 'xhigh' (default: SDK-specific)",
  )
  .example('batonjs ./workflows/demo.js')
  .example('batonjs --sdk codebuddy ./workflows/demo.js')
  .example('batonjs --args \'{"target": "src/"}\' ./workflows/demo.js')
  .example('batonjs --budget 5.0 --concurrency 5 ./workflows/demo.js')
  .example('batonjs --timeout 5 ./workflows/demo.js')
  .example('batonjs --sdk codex --effort high ./workflows/demo.js')
  .action((script: string | undefined, options: Record<string, unknown>) => {
    if (script === undefined) {
      cli.outputHelp()
      process.exit(1)
    }

    // --args: parse JSON
    let workflowArgs: unknown
    if (options['args'] !== undefined) {
      const raw = String(options['args'])
      try {
        workflowArgs = JSON.parse(raw)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        fatal(`Invalid JSON for --args: ${raw}\nParse error: ${msg}`)
      }
    }

    // --budget: validate number
    let maxBudgetUsd: number | undefined
    if (options['budget'] !== undefined) {
      maxBudgetUsd = parseFloat(String(options['budget']))
      if (Number.isNaN(maxBudgetUsd)) {
        fatal(`--budget requires a number, got: ${String(options['budget'])}`)
      }
      if (maxBudgetUsd <= 0) {
        fatal(`--budget must be a positive number, got: ${maxBudgetUsd}`)
      }
    }

    // --concurrency: validate integer
    let maxConcurrency: number | undefined
    if (options['concurrency'] !== undefined) {
      maxConcurrency = parseInt(String(options['concurrency']), 10)
      if (Number.isNaN(maxConcurrency)) {
        fatal(`--concurrency requires an integer, got: ${String(options['concurrency'])}`)
      }
    }

    // --sdk: validate name
    let sdk: SdkName | undefined
    if (options['sdk'] !== undefined) {
      const sdkName = String(options['sdk'])
      if (sdkName !== 'anthropic' && sdkName !== 'codebuddy' && sdkName !== 'codex') {
        fatal(`--sdk must be 'anthropic', 'codebuddy', or 'codex', got: ${sdkName}`)
      }
      sdk = sdkName
    }

    // --effort: validate level
    let effort: 'medium' | 'high' | 'xhigh' | undefined
    if (options['effort'] !== undefined) {
      const effortLevel = String(options['effort'])
      if (effortLevel !== 'medium' && effortLevel !== 'high' && effortLevel !== 'xhigh') {
        fatal(`--effort must be 'medium', 'high', or 'xhigh', got: ${effortLevel}`)
      }
      effort = effortLevel
    }

    const engineOpts: EngineOptions = {
      scriptPath: script,
      cwd: typeof options['cwd'] === 'string' ? options['cwd'] : process.cwd(),
    }
    if (workflowArgs !== undefined) engineOpts.args = workflowArgs
    if (maxBudgetUsd !== undefined) engineOpts.maxBudgetUsd = maxBudgetUsd
    if (maxConcurrency !== undefined) engineOpts.maxConcurrency = maxConcurrency
    if (options['model'] !== undefined) engineOpts.defaultModel = String(options['model'])
    if (sdk !== undefined) engineOpts.sdk = sdk
    if (effort !== undefined) engineOpts.effort = effort
    if (options['timeout'] !== undefined) {
      const minutes = parseFloat(String(options['timeout']))
      if (Number.isNaN(minutes) || minutes <= 0) {
        fatal(`--timeout requires a positive number (minutes), got: ${String(options['timeout'])}`)
      }
      engineOpts.agentTimeoutMs = Math.round(minutes * 60_000)
    }

    const engine = new Engine(engineOpts)

    engine.on((event) => {
      switch (event.kind) {
        case 'workflow_start':
          console.log(`\n🚀 ${event.meta?.name ?? script}`)
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

    engine.run().then((result) => {
      if (result.ok) {
        console.log('\n📦', JSON.stringify(result.value.result, null, 2))
      } else {
        fatal(`\n💥 ${result.error.message}`)
      }
    })
  })

cli.help()
cli.parse()
