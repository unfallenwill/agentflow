// ═══════════════════════════════════════════════════════════════
// 极限测试 04: 质量收敛循环
// ═══════════════════════════════════════════════════════════════
// 测试点: 不用 dry counter 也不用 budget，而是用"质量分数"作为
//         循环终止条件。每轮生成代码 → 评分 → 不够好则改进。
//
// 模式: Loop-until-quality。质量是主观的——让 agent 自评分数，
//       只有 ≥ 85 分才停止。同时设 dry 和 budget 上限防死循环。
//
// 关键: 三重退出条件——质量达标 / 连续无改进 / 预算耗尽，取最先满足的。
// ═══════════════════════════════════════════════════════════════

export const meta = {
  name: 'stress-04-quality-converge',
  description: 'Stress test: self-improving loop that converges on a quality score threshold',
  phases: [
    { title: 'Iterate', detail: 'Generate → score → improve loop' },
    { title: 'Final', detail: 'Output best result' },
  ],
}

const QUALITY_THRESHOLD = args?.threshold || 85
const MAX_ROUNDS = 10

const CODE_SCHEMA = {
  type: 'object',
  properties: {
    code: { type: 'string' },
    explanation: { type: 'string' },
  },
  required: ['code', 'explanation'],
}

const SCORE_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'number', description: '0-100 quality score' },
    issues: { type: 'array', items: { type: 'string' } },
    improvements: { type: 'array', items: { type: 'string' } },
  },
  required: ['score', 'issues'],
}

phase('Iterate')

let currentCode = null
let bestScore = 0
let bestCode = null
let dryStreak = 0
let roundNum = 0
const history = []

log(`🎯 目标: 质量分数 ≥ ${QUALITY_THRESHOLD}，最多 ${MAX_ROUNDS} 轮`)

while (roundNum < MAX_ROUNDS) {
  // 三重退出守卫
  if (budget.total && budget.remaining() < 50000) {
    log('⏹ 预算接近耗尽，停止迭代')
    break
  }

  roundNum++

  // 生成 / 改进代码
  const prompt = currentCode
    ? `Improve this code based on the review feedback. Current score: ${bestScore}/100.
       Issues to fix: ${history[history.length - 1]?.issues?.join('; ') || 'none'}
       Improvements suggested: ${history[history.length - 1]?.improvements?.join('; ') || 'none'}

       Current code:
       ${currentCode}

       Rewrite the code to address ALL issues. Target score: ${QUALITY_THRESHOLD}+.`
    : `Write a Python utility function for /home/caosen/GitHub/applebox-service/app/utils/.
       The function should: safely parse and validate pagination parameters from a FastAPI request.
       Include proper type hints, error handling, and docstring.
       Project uses Pydantic v2, FastAPI, async patterns.`

  currentCode = await agent(prompt, {
    label: `generate:r${roundNum}`,
    phase: 'Iterate',
    schema: CODE_SCHEMA,
  })

  if (!currentCode) break

  // 质量评分（独立 agent）
  const score = await agent(
    `Score this code 0-100 for production readiness:
     ${currentCode.code}

     Criteria: correctness, type safety, error handling, docstring quality, edge cases, style.
     List specific issues and suggested improvements.`,
    { label: `score:r${roundNum}`, phase: 'Iterate', model: 'haiku', schema: SCORE_SCHEMA }
  )

  const s = score?.score || 0
  history.push({ round: roundNum, score: s, issues: score?.issues, improvements: score?.improvements })
  log(`  轮次 ${roundNum}: 分数 ${s}/100 (目标 ${QUALITY_THRESHOLD})`)

  if (s > bestScore) {
    bestScore = s
    bestCode = currentCode
    dryStreak = 0
  } else {
    dryStreak++
  }

  // 退出条件 1: 质量达标
  if (bestScore >= QUALITY_THRESHOLD) {
    log(`✅ 质量达标！${bestScore} ≥ ${QUALITY_THRESHOLD}`)
    break
  }

  // 退出条件 2: 连续 3 轮无改进
  if (dryStreak >= 3) {
    log(`⏹ 连续 ${dryStreak} 轮无改进，停止迭代`)
    break
  }
}

phase('Final')

log(`
📊 质量收敛报告:
   ${history.map((h) => `Round ${h.round}: ${h.score}/100`).join('\n   ')}
   最佳分数: ${bestScore}/100
   迭代轮次: ${roundNum}
`)

return { best_score: bestScore, rounds: roundNum, history }
