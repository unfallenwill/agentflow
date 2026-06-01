// ═══════════════════════════════════════════════════════════════
// 极限测试 08: 多维度覆盖强制器
// ═══════════════════════════════════════════════════════════════
// 测试点: 循环不是按 dry counter 或 budget 停止，而是按
//         "每个类别都达到最低覆盖数"才停止。
//
// 模式: Loop-until-coverage。定义 N 个维度，每个维度需要
//       至少 M 个发现。每轮结束后检查覆盖矩阵，缺什么补什么。
//
// 关键: 这不是简单的循环——prompt 根据当前覆盖缺口动态调整，
//       引导 agent 搜索尚未覆盖的维度。自适应目标导向。
// ═══════════════════════════════════════════════════════════════

export const meta = {
  name: 'stress-08-diversity-enforcer',
  description: 'Stress test: loop until every category has minimum coverage count',
  phases: [
    { title: 'Enforce', detail: 'Iterate until all dimensions covered' },
    { title: 'Report', detail: 'Coverage matrix report' },
  ],
}

const CATEGORIES = ['security', 'performance', 'correctness', 'style', 'architecture']
const MIN_PER_CATEGORY = args?.minPerCategory || 2
const MAX_ROUNDS = 12

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          category: { type: 'string' },
          file: { type: 'string' },
        },
        required: ['title', 'category', 'file'],
      },
    },
  },
  required: ['findings'],
}

phase('Enforce')

// 覆盖矩阵：category → count
const coverage = {}
CATEGORIES.forEach((c) => (coverage[c] = 0))
const allFindings = []
let round = 0

log(`🎯 目标: ${CATEGORIES.length} 个类别各至少 ${MIN_PER_CATEGORY} 个发现`)

function getUncovered() {
  return CATEGORIES.filter((c) => coverage[c] < MIN_PER_CATEGORY)
}

function isFullyCovered() {
  return getUncovered().length === 0
}

while (!isFullyCovered() && round < MAX_ROUNDS) {
  if (budget.total && budget.remaining() < 40000) break

  round++
  const gaps = getUncovered()
  log(`  Round ${round}: 缺失覆盖 ${gaps.join(', ')}`)

  // 动态调整 prompt——只搜索缺失的类别
  const result = await agent(
    `Find issues specifically in these categories: ${gaps.join(', ')}.
     Scan /home/caosen/GitHub/applebox-service/ focusing on areas that might have ${gaps.join(' or ')} issues.
     Each finding MUST have a category from: ${CATEGORIES.join(', ')}.
     We need at least ${MIN_PER_CATEGORY} per category. Currently:
     ${CATEGORIES.map((c) => `${c}: ${coverage[c]}/${MIN_PER_CATEGORY}`).join(', ')}`,
    { label: `enforce:r${round}`, phase: 'Enforce', model: 'haiku', schema: FINDING_SCHEMA }
  )

  if (!result?.findings) continue

  result.findings.forEach((f) => {
    if (CATEGORIES.includes(f.category)) {
      coverage[f.category]++
      allFindings.push(f)
    }
  })

  const status = CATEGORIES.map((c) => `${c}:${coverage[c]}/${MIN_PER_CATEGORY}`).join(' ')
  log(`  Round ${round} 后: ${status}`)
}

phase('Report')

log(`
📊 多维覆盖矩阵:
${CATEGORIES.map((c) => {
  const met = coverage[c] >= MIN_PER_CATEGORY
  return `  ${met ? '✅' : '❌'} ${c}: ${coverage[c]}/${MIN_PER_CATEGORY}`
}).join('\n')}

总计: ${allFindings.length} 个发现, ${round} 轮迭代, 完全覆盖: ${isFullyCovered()}
`)

return { coverage, total_findings: allFindings.length, rounds: round, fully_covered: isFullyCovered() }
