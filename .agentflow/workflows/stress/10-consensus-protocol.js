// ═══════════════════════════════════════════════════════════════
// 极限测试 10: 共识协议
// ═══════════════════════════════════════════════════════════════
// 测试点: 多个独立 agent 先各自给出意见，找出分歧，然后针对
//         分歧点发起仲裁——模拟分布式系统的共识协议。
//
// 模式: Propose → Compare → Arbitrate。
//       1. N 个 agent 独立评估同一个问题
//       2. 比较结果，找出分歧点
//       3. 对每个分歧点，派仲裁 agent 做最终裁决
//
// 关键: 不是简单的投票多数决，而是先识别"在哪里有分歧"，
//       再针对性地解决分歧。处理的是"灰色地带"而非黑白问题。
// ═══════════════════════════════════════════════════════════════

export const meta = {
  name: 'stress-10-consensus-protocol',
  description: 'Stress test: propose → detect disagreements → arbitrate consensus protocol',
  phases: [
    { title: 'Propose', detail: '5 agents independently assess the same files' },
    { title: 'Detect', detail: 'Find disagreements among proposals' },
    { title: 'Arbitrate', detail: 'Resolve each disagreement with arbitration' },
  ],
}

const ASSESSMENT_SCHEMA = {
  type: 'object',
  properties: {
    reviewer_id: { type: 'string' },
    file_assessments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          risk_level: { type: 'string', enum: ['safe', 'low', 'medium', 'high', 'critical'] },
          needs_refactor: { type: 'boolean' },
          primary_concern: { type: 'string' },
        },
        required: ['file', 'risk_level', 'needs_refactor', 'primary_concern'],
      },
    },
  },
  required: ['reviewer_id', 'file_assessments'],
}

const ARBITRATION_SCHEMA = {
  type: 'object',
  properties: {
    file: { type: 'string' },
    final_risk: { type: 'string' },
    final_refactor: { type: 'boolean' },
    reasoning: { type: 'string' },
  },
  required: ['file', 'final_risk', 'final_refactor', 'reasoning'],
}

const TARGET_FILES = [
  'app/services/workbench.py',
  'app/services/workflow.py',
  'app/services/script.py',
  'app/core/security.py',
  'app/core/config.py',
]

// ── Propose: 5 个独立评审者 ────────────────────────────────────
phase('Propose')

const REVIEWER_ROLES = [
  'security-first reviewer who worries about vulnerabilities',
  'performance-focused reviewer who worries about latency',
  'maintainability advocate who worries about tech debt',
  'pragmatist who accepts reasonable trade-offs',
  'strict architect who enforces all rules uniformly',
]

log(`📝 ${REVIEWER_ROLES.length} 个独立评审者评估 ${TARGET_FILES.length} 个文件...`)

const proposals = await parallel(
  REVIEWER_ROLES.map((role, i) => () =>
    agent(
      `You are a ${role}. Assess these files in /home/caosen/GitHub/applebox-service/:
       ${TARGET_FILES.join('\n       ')}
       For each file: risk level (safe/low/medium/high/critical), needs refactor (yes/no), primary concern.
       Be opinionated according to your role.`,
      { label: `propose:reviewer-${i + 1}`, phase: 'Propose', schema: ASSESSMENT_SCHEMA }
    )
  )
)

const validProposals = proposals.filter(Boolean)
log(`📝 收到 ${validProposals.length}/${REVIEWER_ROLES.length} 份评估`)

// ── Detect: 找出分歧 ───────────────────────────────────────────
phase('Detect')

// 按文件分组，比较各评审者的意见
const disagreements = []

TARGET_FILES.forEach((file) => {
  const assessments = validProposals
    .map((p) => p.file_assessments?.find((a) => a.file === file))
    .filter(Boolean)

  if (assessments.length < 2) return

  // 检测 risk_level 分歧
  const riskLevels = assessments.map((a) => a.risk_level)
  const uniqueRisks = [...new Set(riskLevels)]

  // 检测 needs_refactor 分歧
  const refactorVotes = assessments.map((a) => a.needs_refactor)
  const refactorYes = refactorVotes.filter(Boolean).length
  const refactorNo = refactorVotes.length - refactorYes

  // 有分歧的条件：risk 超过 2 种 或 refactor 投票不 unanimous
  if (uniqueRisks.length > 2 || (refactorYes > 0 && refactorNo > 0)) {
    disagreements.push({
      file,
      risk_diversity: uniqueRisks,
      risk_details: assessments.map((a) => `${a.risk_level} (${a.primary_concern})`),
      refactor_split: `${refactorYes} yes / ${refactorNo} no`,
    })
  }
})

log(`🔍 发现 ${disagreements.length} 个分歧点:`)
disagreements.forEach((d) => {
  log(`  ${d.file}: risk=[${d.risk_diversity.join(', ')}], refactor=${d.refactor_split}`)
})

// ── Arbitrate: 仲裁分歧 ────────────────────────────────────────
phase('Arbitrate')

if (disagreements.length === 0) {
  log('✅ 所有评审者达成共识，无需仲裁')
} else {
  log(`⚖️ 启动仲裁：${disagreements.length} 个文件需要裁决...`)

  const arbitrations = await parallel(
    disagreements.map((dispute) => () =>
      agent(
        `You are an ARBITRATOR resolving a disagreement among 5 code reviewers.

         File: ${dispute.file}
         Project: /home/caosen/GitHub/applebox-service/

         Reviewers disagree:
         Risk levels: ${dispute.risk_diversity.join(', ')}
         Details: ${dispute.risk_details.join('; ')}
         Refactor votes: ${dispute.refactor_split}

         Read the actual file. Make a final, decisive ruling.
         What is the true risk level? Does it really need refactoring?`,
        { label: `arbitrate:${dispute.file.split('/').pop()}`, phase: 'Arbitrate', schema: ARBITRATION_SCHEMA }
      )
    )
  )

  const rulings = arbitrations.filter(Boolean)
  log('⚖️ 仲裁结果:')
  rulings.forEach((r) => {
    log(`  ${r.file}: 风险=${r.final_risk}, 重构=${r.final_refactor ? '是' : '否'}`)
    log(`    理由: ${r.reasoning?.slice(0, 80)}...`)
  })
}

log(`
📊 共识协议结算:
   评审者: ${validProposals.length}
   文件: ${TARGET_FILES.length}
   分歧: ${disagreements.length}
   共识率: ${((1 - disagreements.length / TARGET_FILES.length) * 100).toFixed(0)}%
`)

return {
  reviewers: validProposals.length,
  files: TARGET_FILES.length,
  disagreements: disagreements.length,
  consensus_rate: 1 - disagreements.length / TARGET_FILES.length,
}
