import { Engine } from '../src/index.js';

const engine = new Engine({
  scriptPath: './test/demo.js',
  cwd: process.cwd(),
});

engine.on((event) => {
  switch (event.kind) {
    case 'workflow_start':
      console.log(`\n🚀 Workflow started: ${event.meta?.name ?? 'unnamed'}`);
      break;
    case 'phase':
      console.log(`📍 Phase: ${event.title}`);
      break;
    case 'log':
      console.log(`  💬 ${event.message}`);
      break;
    case 'agent_start':
      console.log(`  🤖 Agent starting... ${event.label ?? ''}`);
      break;
    case 'agent_end':
      console.log(`  ✅ Agent done ($${event.cost.toFixed(4)}, ${(event.duration_ms / 1000).toFixed(1)}s)`);
      break;
    case 'agent_error':
      console.error(`  ❌ Agent error: ${event.error}`);
      break;
    case 'budget_update':
      console.log(`  💰 Budget: $${event.spent.toFixed(4)} spent`);
      break;
    case 'workflow_end':
      console.log(`\n🏁 Workflow ${event.success ? 'succeeded' : 'failed'} | Cost: $${event.totalCost.toFixed(4)} | Time: ${(event.duration_ms / 1000).toFixed(1)}s`);
      break;
    case 'workflow_error':
      console.error(`\n💥 Workflow error: ${event.error}`);
      break;
  }
});

const result = await engine.run();

if (result.ok) {
  console.log('\n📦 Result:', JSON.stringify(result.value.result, null, 2));
} else {
  console.error('\n💥 Error:', result.error.message);
  process.exit(1);
}
