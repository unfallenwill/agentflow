import { Engine } from '../src/index.js';

const engine = new Engine({
  scriptPath: './.agentflow/workflows/all-features-demo.js',
  cwd: process.cwd(),
});

engine.on((event) => {
  switch (event.kind) {
    case 'workflow_start':
      console.log(`\n🚀 Workflow: ${event.meta?.name ?? 'unnamed'}`);
      break;
    case 'phase':
      console.log(`📍 ${event.title}`);
      break;
    case 'log':
      console.log(`  💬 ${event.message}`);
      break;
    case 'agent_start':
      console.log(`  🤖 → ${event.label ?? 'agent'}`);
      break;
    case 'agent_end':
      console.log(`  ✅ ← ${event.label ?? 'agent'} ($${event.cost.toFixed(4)})`);
      break;
    case 'agent_error':
      console.error(`  ❌ ← ${event.label ?? 'agent'}: ${event.error}`);
      break;
    case 'workflow_end':
      console.log(`\n🏁 ${event.success ? '✅' : '❌'} | $${event.totalCost.toFixed(4)} | ${(event.duration_ms / 1000).toFixed(1)}s`);
      break;
    case 'workflow_error':
      console.error(`💥 ${event.error}`);
      break;
  }
});

const result = await engine.run();

if (!result.ok) {
  console.error('\n💥 Engine error:', result.error.message);
  console.error('Stack:', result.error.stack?.split('\n').slice(0, 5).join('\n'));
  process.exit(1);
}
