/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // === Global Rules ===

    {
      name: 'no-circular',
      comment: 'No circular dependencies',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      comment: 'No orphan modules (unreachable from index.ts)',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: 'cli\\.ts$',
      },
      to: {},
    },
    {
      name: 'no-test-in-prod',
      severity: 'error',
      comment: 'Production code must not import test code',
      from: { pathNot: '^tests/' },
      to: { path: '^tests/' },
    },
    {
      name: 'no-dev-deps-in-src',
      severity: 'error',
      comment:
        'Production code must not use devDependencies (bundled deps are OK — tsdown inlines them at build time)',
      from: { path: '^src/' },
      to: {
        dependencyTypes: ['npm-dev'],
        pathNot: ['sucrase', 'json5'],
      },
    },

    // === Layer Rules ===
    //
    // Architecture:
    //   src/
    //     cli.ts          → orchestration layer (imports core/)
    //     core/           → orchestration (imports utils/)
    //     utils/          → foundation (no upward imports)

    {
      name: 'utils-no-upward-imports',
      severity: 'error',
      comment:
        'utils/ is foundational — must not import from core/ or cli.ts',
      from: { path: '^src/utils/' },
      to: {
        path: ['^src/core/', '^src/cli\\.ts$'],
      },
    },

    {
      name: 'utils-no-internal-cross-imports',
      severity: 'warn',
      comment:
        'utils/ modules should be independent — cross-imports suggest coupling that may belong in core/',
      from: { path: '^src/utils/' },
      to: {
        path: '^src/utils/',
        pathNot: '^src/utils/result\\.ts$',
      },
    },

    {
      name: 'core-only-from-utils',
      severity: 'error',
      comment:
        'core/ should only import from utils/ and other core/ modules',
      from: { path: '^src/core/' },
      to: {
        path: '^src/',
        pathNot: ['^src/core/', '^src/utils/', '^src/types\\.ts$'],
      },
    },

    {
      name: 'cli-only-from-core',
      severity: 'error',
      comment:
        'cli.ts should only import from core/ and types',
      from: { path: '^src/cli\\.ts$' },
      to: {
        path: '^src/',
        pathNot: ['^src/core/', '^src/index\\.ts$', '^src/types\\.ts$'],
      },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    combinedDependencies: false,
    doNotFollow: {
      path: 'node_modules',
    },
    moduleSystems: ['es6'],
  },
}
