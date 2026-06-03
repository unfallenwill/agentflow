#!/usr/bin/env node
import { cac } from 'cac'
import { consola } from 'consola'
import { Engine } from './index.js'
import type { EngineOptions, SdkName } from './index.js'

const cli = cac('batonjs')

cli
  .command('[script]', 'Run a workflow script')
  .option('--args <json>', 'Pass arguments to the script as the `args` global')
  .option('--budget <usd>', 'Set max budget in USD (default: unlimited)')
  .option('--concurrency <n>', 'Max concurrent agents (default: 2)')
  .option('--cwd <dir>', 'Working directory for agents (default: .)')
  .option('--sdk <name>', "SDK backend: 'anthropic' (default), 'codebuddy', or 'codex'")
  .option('--timeout <minutes>', 'Agent call timeout in minutes (default: 5)')
  .option(
    '--effort <level>',
    "Reasoning effort: 'medium', 'high', or 'xhigh' (default: SDK-specific)",
  )
  .option('--verbose', 'Show debug-level output (agent internals)')
  .option('--quiet', 'Suppress progress output (only errors)')
  .example('batonjs ./workflows/demo.js')
  .example('batonjs --sdk codebuddy ./workflows/demo.js')
  .example('batonjs --args \'{"target": "src/"}\' ./workflows/demo.js')
  .example('batonjs --budget 5.0 --concurrency 5 ./workflows/demo.js')
  .example('batonjs --timeout 5 ./workflows/demo.js')
  .example('batonjs --sdk codex --effort high ./workflows/demo.js')
  .example('batonjs --verbose ./workflows/demo.js')
  .action((script: string | undefined, options: Record<string, unknown>) => {
    if (script === undefined) {
      cli.outputHelp()
      process.exit(1)
    }

    // Configure consola log level
    if (options['verbose']) {
      consola.level = 4 // debug
    } else if (options['quiet']) {
      consola.level = -Infinity // silent
    } else {
      consola.level = 3 // info (default)
    }

    // --args: parse JSON
    let workflowArgs: unknown
    if (options['args'] !== undefined) {
      const raw = String(options['args'])
      try {
        workflowArgs = JSON.parse(raw)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        consola.fatal(`Invalid JSON for --args: ${raw}\nParse error: ${msg}`)
        process.exit(1)
      }
    }

    // --budget: validate number
    let maxBudgetUsd: number | undefined
    if (options['budget'] !== undefined) {
      maxBudgetUsd = parseFloat(String(options['budget']))
      if (Number.isNaN(maxBudgetUsd)) {
        consola.fatal(`--budget requires a number, got: ${String(options['budget'])}`)
        process.exit(1)
      }
      if (maxBudgetUsd <= 0) {
        consola.fatal(`--budget must be a positive number, got: ${maxBudgetUsd}`)
        process.exit(1)
      }
    }

    // --concurrency: validate integer
    let maxConcurrency: number | undefined
    if (options['concurrency'] !== undefined) {
      maxConcurrency = parseInt(String(options['concurrency']), 10)
      if (Number.isNaN(maxConcurrency)) {
        consola.fatal(`--concurrency requires an integer, got: ${String(options['concurrency'])}`)
        process.exit(1)
      }
    }

    // --sdk: validate name
    let sdk: SdkName | undefined
    if (options['sdk'] !== undefined) {
      const sdkName = String(options['sdk'])
      if (sdkName !== 'anthropic' && sdkName !== 'codebuddy' && sdkName !== 'codex') {
        consola.fatal(`--sdk must be 'anthropic', 'codebuddy', or 'codex', got: ${sdkName}`)
        process.exit(1)
      }
      sdk = sdkName
    }

    // --effort: validate level
    let effort: 'medium' | 'high' | 'xhigh' | undefined
    if (options['effort'] !== undefined) {
      const effortLevel = String(options['effort'])
      if (effortLevel !== 'medium' && effortLevel !== 'high' && effortLevel !== 'xhigh') {
        consola.fatal(`--effort must be 'medium', 'high', or 'xhigh', got: ${effortLevel}`)
        process.exit(1)
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
    if (sdk !== undefined) engineOpts.sdk = sdk
    if (effort !== undefined) engineOpts.effort = effort
    if (options['timeout'] !== undefined) {
      const minutes = parseFloat(String(options['timeout']))
      if (Number.isNaN(minutes) || minutes <= 0) {
        consola.fatal(
          `--timeout requires a positive number (minutes), got: ${String(options['timeout'])}`,
        )
        process.exit(1)
      }
      engineOpts.agentTimeoutMs = Math.round(minutes * 60_000)
    }

    const engine = new Engine(engineOpts)

    engine.on((event) => {
      switch (event.kind) {
        case 'workflow_start':
          consola.start(event.meta?.name ?? script)
          break
        case 'phase':
          consola.info(`📍 ${event.title}`)
          break
        case 'log':
          consola.log(event.message)
          break
        case 'agent_start': {
          const parts: string[] = []
          if (event.sdk?.model) parts.push(`model: ${event.sdk.model}`)
          if (event.sdk?.effort) parts.push(`effort: ${event.sdk.effort}`)
          if (event.sdk?.permissionMode && event.sdk.permissionMode !== 'bypassPermissions') {
            parts.push(`permission: ${event.sdk.permissionMode}`)
          }
          const label = event.label ? ` "${event.label}"` : ''
          if (parts.length > 0) {
            consola.info(`agent${label} — ${parts.join(', ')}`)
          }
          break
        }
        case 'agent_end':
          consola.success(
            `${event.label ?? 'agent'} ($${event.cost.toFixed(4)}, ${(event.duration_ms / 1000).toFixed(1)}s)`,
          )
          break
        case 'agent_error':
          consola.fail(`${event.label ?? 'agent'}: ${event.error.slice(0, 100)}`)
          break
        case 'budget_update':
          consola.log(`💰 $${event.spent.toFixed(4)} spent`)
          break
        case 'workflow_end':
          consola.log(
            `${event.success ? '✅' : '❌'} $${event.totalCost.toFixed(4)} | ${(event.duration_ms / 1000).toFixed(1)}s`,
          )
          break
        case 'workflow_error':
          // Error is surfaced via run() result.
          break
        case 'pipeline_error':
          consola.warn(
            `pipeline error at item ${event.index}${event.stage !== undefined ? ` stage ${event.stage}` : ''}: ${event.error}`,
          )
          break
        case 'parallel_error':
          consola.warn(`parallel error at thunk ${event.index}: ${event.error}`)
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
        consola.success('Workflow completed')
        consola.log(JSON.stringify(result.value.result, null, 2))
      } else {
        consola.fatal(result.error.message)
        process.exit(1)
      }
    })
  })

cli.help()
cli.parse()
