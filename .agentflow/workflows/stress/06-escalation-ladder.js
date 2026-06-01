// ═══════════════════════════════════════════════════════════════
// 极限测试 06: 升级阶梯
// ═══════════════════════════════════════════════════════════════
// 测试点: 利用 model 选项实现三级验证升级——便宜模型先筛一遍，
//         有问题的才交给贵的模型详细看。
//
// 模式: Escalation Ladder。逐级提升模型和投入：
//         Tier 1: haiku × N (广撒网，快速过滤)
//         Tier 2: sonnet × M (只处理 Tier 1 标记为可疑的)
//         Tier 3: opus × 1 (只处理 Tier 2 不确定的)
//
// 关键: 成本控制策略。大部分文件被 haiku 放行，只有少数
//       进入 sonnet，极少数到 opus。总成本远低于全程用 opus。
// ═══════════════════════════════════════════════════════════════

export const meta = {
  name: 'stress-06-escalation-ladder',
  description: 'Stress test: 3-tier model escalation ladder (haiku → sonnet → opus)',
  phases: [
    { title: 'Tier 1: Haiku Screen', detail: 'Fast broad sweep with cheapest model' },
    { title: 'Tier 2: Sonnet Analyze', detail: 'Deeper look at flagged items' },
    { title: 'Tier 3: Opus Verdict', detail: 'Final call on uncertain items' },
  ],
}

const FILES_SCHEMA = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' } },
  },
  required: ['files'],
}

const SCREEN_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['clean', 'suspicious', 'dangerous'] },
    quick_reason: { type: 'string' },
  },
  required: ['verdict'],
}

const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['safe', 'needs_expert', 'critical'] },
    details: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['verdict', 'details', 'confidence'],
}

const EXPERT_SCHEMA = {
  type: 'object',
  properties: {
    final_verdict: { type: 'string', enum: ['confirmed_issue', 'false_positive'] },
    explanation: { type: 'string' },
    fix: { type: 'string' },
  },
  required: ['final_verdict', 'explanation'],
}

// ── 获取文件列表 ───────────────────────────────────────────────
const fileList = await agent(
  `List all Python files in /home/caosen/GitHub/applebox-service/app/services/ (just filenames, no path).`,
  { label: 'list-files', phase: 'Tier 1: Haiku Screen', model: 'haiku', schema: FILES_SCHEMA }
)

const files = fileList?.files?.slice(0, 12) || []
log(`📂 扫描 ${files.length} 个文件`)

// ── Tier 1: Haiku 广撒网 ───────────────────────────────────────
phase('Tier 1: Haiku Screen')
log(`🟢 Tier 1: ${files.length} 个 haiku agent 快速筛选...`)

const tier1Results = await parallel(
  files.map((file) => () =>
    agent(
      `Quick security screen of ${file} in /home/caosen/GitHub/applebox-service/app/services/.
       Is this file clean, suspicious, or dangerous? One word verdict + one sentence reason.
       Err on the side of flagging (suspicious) if unsure.`,
      { label: `t1:${file}`, phase: 'Tier 1: Haiku Screen', model: 'haiku', schema: SCREEN_SCHEMA }
    )
  )
)

const suspicious = tier1Results
  .filter(Boolean)
  .map((r, i) => ({ file: files[i], ...r }))
  .filter((r) => r.verdict !== 'clean')

log(`🟢 Tier 1 结果: ${files.length - suspicious.length} clean, ${suspicious.length} flagged`)

// ── Tier 2: Sonnet 深入分析 ────────────────────────────────────
phase('Tier 2: Sonnet Analyze')

if (suspicious.length === 0) {
  log('🟢 所有文件通过 Tier 1，无需升级')
} else {
  log(`🟡 Tier 2: ${suspicious.length} 个 sonnet agent 分析标记文件...`)

  const tier2Results = await parallel(
    suspicious.map((item) => () =>
      agent(
        `Detailed analysis of ${item.file} in /home/caosen/GitHub/applebox-service/app/services/.
         Tier 1 flagged it as "${item.verdict}": ${item.quick_reason || 'unknown'}
         Read the actual code. Is it safe, needs expert review, or critical? Be specific.`,
        { label: `t2:${item.file}`, phase: 'Tier 2: Sonnet Analyze', model: 'sonnet', schema: ANALYSIS_SCHEMA }
      )
    )
  )

  const needsExpert = tier2Results
    .filter(Boolean)
    .map((r, i) => ({ ...suspicious[i], ...r }))
    .filter((r) => r.verdict === 'needs_expert' || r.verdict === 'critical')

  log(`🟡 Tier 2 结果: ${suspicious.length - needsExpert.length} resolved, ${needsExpert.length} need expert`)

  // ── Tier 3: Opus 最终裁决 ─────────────────────────────────────
  phase('Tier 3: Opus Verdict')

  if (needsExpert.length === 0) {
    log('🟡 所有标记在 Tier 2 已解决，无需专家')
  } else {
    log(`🔴 Tier 3: ${needsExpert.length} 个 opus agent 做最终裁决...`)

    const tier3Results = await parallel(
      needsExpert.map((item) => () =>
        agent(
          `Expert review of ${item.file} in /home/caosen/GitHub/applebox-service/app/services/.
           Tier 2 analysis: "${item.details}" (confidence: ${item.confidence})
           Read the code carefully. Is this a confirmed issue or false positive?
           If confirmed, propose a specific fix.`,
          { label: `t3:${item.file}`, phase: 'Tier 3: Opus Verdict', model: 'opus', schema: EXPERT_SCHEMA }
        )
      )
    )

    const confirmed = tier3Results.filter(Boolean).filter((r) => r.final_verdict === 'confirmed_issue')
    log(`🔴 Tier 3 结果: ${confirmed.length} 个确认问题, ${tier3Results.filter(Boolean).length - confirmed.length} 个误报`)
    confirmed.forEach((c) => log(`  ⚠️ ${c.explanation}`))
  }
}

return { tier1_total: files.length, tier1_flagged: suspicious.length }
