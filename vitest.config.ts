import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/cli.ts', 'src/types.ts'],
      thresholds: {
        // Core modules (result, concurrency, pipeline, events, budget, agent)
        perFile: true,
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
        '**/src/utils/result.ts': {
          statements: 90,
          branches: 90,
          functions: 90,
          lines: 90,
        },
        '**/src/utils/semaphore.ts': {
          statements: 90,
          branches: 90,
          functions: 90,
          lines: 90,
        },
        '**/src/utils/parallel.ts': {
          statements: 90,
          branches: 90,
          functions: 90,
          lines: 90,
        },
        '**/src/utils/pipeline.ts': {
          statements: 90,
          branches: 90,
          functions: 90,
          lines: 90,
        },
        '**/src/core/events.ts': {
          statements: 90,
          branches: 90,
          functions: 90,
          lines: 90,
        },
        '**/src/core/budget.ts': {
          statements: 90,
          branches: 90,
          functions: 90,
          lines: 90,
        },
      },
    },
  },
})
