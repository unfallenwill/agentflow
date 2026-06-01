// ═══════════════════════════════════════════════════════════════
// 极限测试 03: 淘汰赛锦标赛
// ═══════════════════════════════════════════════════════════════
// 测试点: 多轮 parallel → reduce → parallel → reduce 的交替模式。
//         每轮并行比赛，半数淘汰，直到只剩冠军。
//
// 模式: 二叉树淘汰制。8 个设计方案 → 4 组对决 → 4 个晋级
//       → 2 组对决 → 2 个晋级 → 最终对决 → 1 个冠军。
//
// 关键: 这不是 pipeline 也不是单次 parallel，而是多轮屏障同步。
//       每轮的结果是下一轮的输入——必须等齐才能配对。
// ═══════════════════════════════════════════════════════════════

export const meta = {
  name: 'stress-03-tournament-bracket',
  description: 'Stress test: elimination tournament bracket with parallel match rounds',
  phases: [
    { title: 'Qualify', detail: 'Generate 8 competing proposals' },
    { title: 'Quarterfinals', detail: '4 parallel matches' },
    { title: 'Semifinals', detail: '2 parallel matches' },
    { title: 'Final', detail: 'Championship match' },
  ],
}

const TOPIC = args?.topic || 'Best testing strategy for this FastAPI project'

const PROPOSAL_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    approach: { type: 'string' },
    pros: { type: 'array', items: { type: 'string' } },
    cons: { type: 'array', items: { type: 'string' } },
    estimated_effort: { type: 'string' },
  },
  required: ['name', 'approach', 'pros', 'cons'],
}

const MATCH_SCHEMA = {
  type: 'object',
  properties: {
    winner: { type: 'string', description: 'Name of the winning proposal' },
    reasoning: { type: 'string' },
    score_a: { type: 'number' },
    score_b: { type: 'number' },
  },
  required: ['winner', 'reasoning', 'score_a', 'score_b'],
}

// ── Qualify: 8 个选手 ─────────────────────────────────────────
phase('Qualify')
log('🏟️ 资格赛：生成 8 个竞争方案...')

const philosophies = [
  'pragmatic minimalist', 'test pyramid purist', 'property-based maximalist',
  'integration-first advocate', 'TDD zealot', 'snapshot testing fan',
  'contract testing specialist', 'chaos engineering advocate',
]

const proposals = await parallel(
  philosophies.map((philosophy, i) => () =>
    agent(
      `You are a ${philosophy}. Propose your ideal approach for: "${TOPIC}".
       Project: FastAPI + SQLAlchemy async at /home/caosen/GitHub/applebox-service/.
       Be opinionated and specific. Your proposal competes against 7 others.`,
      { label: `qualify:${i}`, phase: 'Qualify', schema: PROPOSAL_SCHEMA }
    )
  )
)

let contestants = proposals.filter(Boolean)
log(`🏅 ${contestants.length} 个方案进入淘汰赛`)

// ── 淘汰赛引擎 ─────────────────────────────────────────────────
function runRound(contestants, roundName) {
  const pairs = []
  for (let i = 0; i < contestants.length - 1; i += 2) {
    pairs.push([contestants[i], contestants[i + 1]])
  }
  // 奇数个选手时最后一个自动晋级
  if (contestants.length % 2 === 1) {
    pairs.push([contestants[contestants.length - 1], null])
  }

  const results = parallel(
    pairs.map(([a, b], i) => () => {
      if (!b) {
        log(`  ${roundName}: ${a.name} 轮空晋级`)
        return a
      }
      return agent(
        `Judge a head-to-head match between these two proposals for "${TOPIC}":

         PROPOSAL A: ${JSON.stringify(a)}
         PROPOSAL B: ${JSON.stringify(b)}

         Score each 0-100. Pick the winner based on: effectiveness, feasibility, fit for the project.
         Be decisive—there must be a winner.`,
        { label: `${roundName.toLowerCase()}:match-${i + 1}`, phase: roundName, schema: MATCH_SCHEMA }
      ).then((verdict) => {
        const winner = verdict?.winner === b?.name ? b : a
        log(`  ${roundName}: ${a.name} vs ${b.name} → ${winner.name} 胜 (${verdict?.score_a}-${verdict?.score_b})`)
        return winner
      })
    })
  )
  return results
}

// ── Quarterfinals ──────────────────────────────────────────────
phase('Quarterfinals')
log('⚔️ 四分之一决赛...')
contestants = (await runRound(contestants, 'Quarterfinals')).filter(Boolean)
log(`晋级: ${contestants.map((c) => c.name).join(', ')}`)

// ── Semifinals ─────────────────────────────────────────────────
phase('Semifinals')
log('⚔️ 半决赛...')
contestants = (await runRound(contestants, 'Semifinals')).filter(Boolean)
log(`晋级: ${contestants.map((c) => c.name).join(', ')}`)

// ── Final ──────────────────────────────────────────────────────
phase('Final')
log('🏆 决赛！')
const finalists = await runRound(contestants, 'Final')
const champion = finalists.filter(Boolean)[0]

log(`
🥇 冠军: ${champion?.name}
   方案: ${champion?.approach}
   优点: ${champion?.pros?.join(', ')}
`)

return { champion: champion?.name, approach: champion?.approach }
