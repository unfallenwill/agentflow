// ═══════════════════════════════════════════════════════════════
// 极限测试 07: 预算轮盘赌
// ═══════════════════════════════════════════════════════════════
// 测试点: 纯粹用 budget.spent() 和 budget.remaining() 控制
//         agent 生成。不预知数量，每次只生成一个 agent，
//         检查剩余预算决定是否继续。
//
// 模式: Single-agent loop-until-budget。每次只派一个 agent，
//       事后检查 budget.remaining()，决定继续还是停止。
//
// 关键: 测试 budget 对象的实时性和准确性。每个 agent 完成后
//       spent() 应该立即反映新消耗。
// ═══════════════════════════════════════════════════════════════

export const meta = {
  name: 'stress-07-budget-roulette',
  description: 'Stress test: single-agent loop controlled purely by budget remaining',
  phases: [
    { title: 'Spin', detail: 'One agent at a time until budget runs out' },
    { title: 'Tally', detail: 'Count how many fit in budget' },
  ],
}

const DISCOVERY_SCHEMA = {
  type: 'object',
  properties: {
    discovery: { type: 'string' },
    importance: { type: 'number' },
    file: { type: 'string' },
  },
  required: ['discovery', 'importance'],
}

phase('Spin')

const discoveries = []
let round = 0
const MIN_BUDGET_RESERVE = 30000 // 留 30k token 给后续操作

log(`🎰 预算轮盘赌开始。总预算: ${budget.total || '∞'}, 保留: ${MIN_BUDGET_RESERVE}`)

while (true) {
  // 检查预算
  if (budget.total && budget.remaining() < MIN_BUDGET_RESERVE) {
    log(`🎰 预算不足 (剩余 ${Math.round(budget.remaining() / 1000)}k < ${MIN_BUDGET_RESERVE / 1000}k)，停止`)
    break
  }

  // 安全上限（无预算时防止无限循环）
  if (!budget.total && round >= 8) {
    log('🎰 无预算限制，达到 8 轮安全上限')
    break
  }

  round++

  // 记录消耗前后的 budget
  const beforeSpent = budget.spent()
  const beforeRemaining = budget.remaining()

  const result = await agent(
    `Discover one interesting architectural pattern or anti-pattern in round ${round}.
     Project: /home/caosen/GitHub/applebox-service/
     Focus on a different area each time: ${['app/core/', 'app/services/', 'app/api/', 'app/crud/', 'app/libs/', 'app/models/', 'app/middleware/', 'app/utils/'][round - 1] || 'anywhere'}
     Previous discoveries: ${discoveries.map((d) => d.discovery?.slice(0, 30)).join('; ') || 'none'}
     Find something NEW.`,
    { label: `spin:${round}`, phase: 'Spin', schema: DISCOVERY_SCHEMA }
  )

  if (!result) {
    log(`  Round ${round}: agent 被跳过，停止`)
    break
  }

  const afterSpent = budget.spent()
  const cost = afterSpent - beforeSpent

  discoveries.push(result)
  log(`  Round ${round}: "${result.discovery?.slice(0, 40)}..." | 消耗 ${Math.round(cost / 1000)}k tokens | 剩余 ${Math.round(budget.remaining() / 1000)}k`)
}

phase('Tally')

log(`
🎰 轮盘赌结算:
   总轮次: ${round}
   发现数: ${discoveries.length}
   预算消耗: ${budget.spent()} / ${budget.total || '∞'}
   剩余: ${Math.round(budget.remaining() / 1000)}k
`)

discoveries.forEach((d, i) => log(`  ${i + 1}. [${d.importance}/10] ${d.discovery}`))

return { rounds: round, discoveries, total_spent: budget.spent() }
