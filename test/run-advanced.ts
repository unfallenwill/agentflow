import { Engine } from '../src/index.js';

const engine = new Engine({
  scriptPath: './.agentflow/workflows/advanced-workflow-demo.js',
  cwd: process.cwd(),
});

engine.on((event) => {
  switch (event.kind) {
    case 'workflow_start':
      console.log(`\n🚀 Workflow: ${event.meta?.name ?? 'unnamed'}`);
      if (event.meta?.phases) {
        for (const p of event.meta.phases) {
          console.log(`   📌 ${p.title} — ${p.detail ?? ''}`);
        }
      }
      break;
    case 'phase':
      console.log(`\n📍 ── ${event.title} ──`);
      break;
    case 'log':
      console.log(`  💬 ${event.message}`);
      break;
    case 'agent_start':
      console.log(`  🤖 → ${event.label ?? 'agent'}`);
      break;
    case 'agent_end':
      console.log(`  ✅ ← ${event.label ?? 'agent'} ($${event.cost.toFixed(4)}, ${(event.duration_ms / 1000).toFixed(1)}s)`);
      break;
    case 'agent_error':
      console.error(`  ❌ ← ${event.label ?? 'agent'}: ${event.error}`);
      break;
    case 'budget_update':
      console.log(`  💰 $${event.spent.toFixed(4)} spent, ${event.remaining === null ? '∞' : '$' + event.remaining.toFixed(4)} remaining`);
      break;
    case 'workflow_end':
      console.log(`\n🏁 ${event.success ? '✅ Succeeded' : '❌ Failed'} | Cost: $${event.totalCost.toFixed(4)} | Time: ${(event.duration_ms / 1000).toFixed(1)}s`);
      break;
    case 'workflow_error':
      console.error(`\n💥 Error: ${event.error}`);
      break;
  }
});

const result = await engine.run();

if (result.ok) {
  console.log('\n📦 Return value keys:', Object.keys(result.value.result as Record<string, unknown>));
} else {
  console.error('\n💥 Engine error:', result.error.message);
  process.exit(1);
}
