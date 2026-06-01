// ═══════════════════════════════════════════════════════════════
// 高级 Workflow 演示：多模式架构深度审计
// ═══════════════════════════════════════════════════════════════
//
// 本演示将依次展示以下高级模式：
//
// 🔴 模式1: Multi-modal Sweep（多模态扫描）
//    → 并行启动多个 agent，每个从不同"视角"搜索问题
//    → 高级之处：一个 agent 可能漏掉的问题，另一个能发现
//
// 🟡 模式2: Adversarial Verification（对抗式验证）
//    → 每个发现都经过 3 个独立"质疑者"投票
//    → 高级之处：过滤掉"看起来对但其实不对"的发现
//
// 🟢 模式3: Loop-until-dry（收敛循环）
//    → 持续搜索，直到连续 2 轮没有新发现
//    → 高级之处：不确定总量时的自适应终止
//
// 🔵 模式4: Completeness Critic（完整性批评家）
//    → 最终阶段问"还漏了什么？"
//    → 高级之处：元认知——让 AI 审视自己的盲点
//
// 🟣 模式5: pipeline vs parallel（流式 vs 屏障）
//    → pipeline：item A 完成验证后立即进入下一阶段，不等 B
//    → parallel：必须等所有 item 齐备才能继续
//    → 高级之处：精准控制执行拓扑，最小化等待时间
//
// ═══════════════════════════════════════════════════════════════

export const meta = {
  name: 'advanced-workflow-demo',
  description:
    'Advanced workflow patterns demo: multi-modal sweep, adversarial verify, loop-until-dry, completeness critic',
  phases: [
    { title: 'Phase 1: Multi-modal Sweep', detail: '3 agents scan from different angles in parallel' },
    { title: 'Phase 2: Adversarial Verify', detail: 'Each finding voted by 3 independent skeptics' },
    { title: 'Phase 3: Loop-until-dry', detail: 'Iterate until no new findings' },
    { title: 'Phase 4: Completeness Critic', detail: 'Meta-review: what did we miss?' },
    { title: 'Phase 5: Synthesis', detail: 'Final scored report' },
  ],
}

// ── Schemas ──────────────────────────────────────────────────
const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique ID like ARCH-001' },
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          file: { type: 'string' },
          line: { type: 'number' },
          description: { type: 'string' },
          evidence: { type: 'string', description: 'Code snippet or pattern that supports this finding' },
        },
        required: ['id', 'title', 'severity', 'file', 'line', 'description'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    isReal: { type: 'boolean', description: 'Is this finding genuinely valid?' },
    confidence: { type: 'number', description: '0-1 confidence' },
    reason: { type: 'string', description: 'Why you think it is or isnt real' },
    severity_adjustment: {
      type: 'string',
      enum: ['same', 'upgrade', 'downgrade'],
      description: 'Should severity be changed?',
    },
  },
  required: ['isReal', 'confidence', 'reason'],
}

const CRITIC_SCHEMA = {
  type: 'object',
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          area: { type: 'string', description: 'What area was under-examined' },
          why_important: { type: 'string' },
          suggested_approach: { type: 'string' },
        },
        required: ['area', 'why_important'],
      },
    },
    coverage_score: { type: 'number', description: '0-100, how complete was the audit' },
  },
  required: ['gaps', 'coverage_score'],
}

// ── Phase 1: Multi-modal Sweep ───────────────────────────────
//
// 🔴 高级之处：三个 agent 同时启动，每个用不同的"审视镜片"看同一个代码库
//    - Lens 1: 依赖方向违规（api 层是否绕过 service 直接调 crud?）
//    - Lens 2: 数据一致性风险（软删除、乐观锁是否一致使用?）
//    - Lens 3: 异步安全（是否有同步阻塞调用混入异步代码?）
//
// 单个 agent 做全面审查容易"注意力稀释"，而专门化 agent 能更深入地发现问题。

phase('Phase 1: Multi-modal Sweep')
log('🔴 启动 3 个专门化 agent，从不同视角并行扫描代码库...')

const DIMENSIONS = [
  {
    key: 'dependency',
    prompt: `You are a dependency-direction auditor for a FastAPI layered architecture.
The rule is: api -> services -> crud -> models. API must NOT import from crud or models directly.
Search the codebase under app/api/ and app/services/ for violations:
1. Check imports in api layer files - do any import directly from crud or models?
2. Check if services import from api layer (reverse dependency)
3. Check if crud layer imports from schemas (which is forbidden)
Report findings with exact file paths and line numbers.`,
  },
  {
    key: 'data-consistency',
    prompt: `You are a data-consistency auditor for a FastAPI + SQLAlchemy project.
The project uses soft-delete (deleted=0 for active records) and optimistic locking (version field).
Search app/crud/ and app/services/ for:
1. Queries that forget to filter deleted=0
2. Update operations that don't check the version field for optimistic locking
3. Missing audit fields (created_at, updated_at) in new models
Report findings with exact file paths and line numbers.`,
  },
  {
    key: 'async-safety',
    prompt: `You are an async-safety auditor for a FastAPI async project.
All DB operations should be async. Search app/services/ and app/api/ for:
1. Synchronous blocking calls (time.sleep, requests.get/post instead of aiohttp)
2. Missing await keywords on async functions
3. Synchronous DB session usage (SyncSession instead of AsyncSession)
4. CPU-bound operations that should use run_in_executor
Report findings with exact file paths and line numbers.`,
  },
]

// parallel() = 屏障同步：三个 agent 都完成后才继续
// 这里必须用 parallel，因为下一阶段需要把三个视角的结果合并去重
const sweepResults = await parallel(
  DIMENSIONS.map((d) => () =>
    agent(d.prompt, { label: `sweep:${d.key}`, phase: 'Phase 1: Multi-modal Sweep', schema: FINDING_SCHEMA })
  )
)

const allFindings = sweepResults.filter(Boolean).flatMap((r) => r.findings)
log(`Phase 1 完成：3 个 agent 共发现 ${allFindings.length} 个潜在问题`)

// ── Phase 2: Adversarial Verification via pipeline ────────────
//
// 🟡 高级之处：每个发现被 3 个独立"质疑者"审视
//    - 质疑者被明确指示"尽量推翻这个发现"
//    - 只有 ≥2/3 质疑者认为"确实存在"才保留
//
// 使用 pipeline() 而非 parallel()：
//    - 每个 finding 独立流过 verify 阶段
//    - finding A 完成验证后立即被处理，不等 finding B
//    - 最大化吞吐，最小化 wall-clock 时间

phase('Phase 2: Adversarial Verify')
log('🟡 启动对抗式验证：每个发现由 3 个独立质疑者投票...')

const verified = await pipeline(
  allFindings.slice(0, 15), // 限制前15个发现以控制演示时长
  (finding) =>
    parallel([
      () =>
        agent(
          `You are a SKEPTIC. Try to REFUTE this finding. Look at the actual code in ${finding.file} around line ${finding.line}.
      Finding: "${finding.title}" - ${finding.description}
      Evidence: ${finding.evidence || 'not provided'}
      Check the actual file. Is this finding real? Default to refuted=true if you cannot verify.
      Be harsh. Only confirm if you can see clear evidence.`,
          { label: `verify:${finding.id}:s1`, phase: 'Phase 2: Adversarial Verify', schema: VERDICT_SCHEMA }
        ),
      () =>
        agent(
          `You are a CODE REVIEWER evaluating this architectural finding independently.
      File: ${finding.file}, Line: ${finding.line}
      Finding: "${finding.title}" - ${finding.description}
      Read the actual code. Is the claimed problem genuinely present? Is the severity accurate?
      Be critical. False positives waste developer time.`,
          { label: `verify:${finding.id}:s2`, phase: 'Phase 2: Adversarial Verify', schema: VERDICT_SCHEMA }
        ),
      () =>
        agent(
          `You are a SENIOR ARCHITECT reviewing a finding about ${finding.file}.
      Finding: "${finding.title}" - ${finding.description}
      Examine the code carefully. Consider: might this pattern be intentional? Is the context different than assumed?
      Only confirm if you are confident this is a real issue, not a false positive.`,
          { label: `verify:${finding.id}:s3`, phase: 'Phase 2: Adversarial Verify', schema: VERDICT_SCHEMA }
        ),
    ]),
  (votes, finding) => {
    const validVotes = votes.filter(Boolean)
    const confirmCount = validVotes.filter((v) => v.isReal).length
    return {
      ...finding,
      confirmed: confirmCount >= 2,
      vote_ratio: `${confirmCount}/3`,
      avg_confidence: validVotes.length
        ? (validVotes.reduce((s, v) => s + v.confidence, 0) / validVotes.length).toFixed(2)
        : 0,
      voter_reasons: validVotes.map((v) => v.reason),
    }
  }
)

const confirmed = verified.filter((f) => f && f.confirmed)
const rejected = verified.filter((f) => f && !f.confirmed)
log(`Phase 2 完成：${confirmed.length} 个发现被确认，${rejected.length} 个被质疑者推翻`)

// ── Phase 3: Loop-until-dry ──────────────────────────────────
//
// 🟢 高级之处：不知道总共有多少问题时，while 循环无法设定固定次数
//    → loop-until-dry 模式：持续搜索，直到连续 dryRounds 轮没有新发现
//    → 自适应终止：问题少时快速结束，问题多时深入挖掘

phase('Phase 3: Loop-until-dry')
log('🟢 启动收敛循环：持续搜索新问题直到没有新发现...')

const seenKeys = new Set(confirmed.map((f) => f.id))
let dryRounds = 0
let round = 0

while (dryRounds < 2) {
  round++
  log(`  Loop round ${round}：搜索尚未发现的新问题...`)

  const moreFindings = await agent(
    `You are continuing an architecture audit. We already found these issues:
    ${[...seenKeys].join(', ')}

    Look for NEW issues in the codebase that are NOT in the list above.
    Focus on areas we haven't checked yet:
    - app/libs/ (external integrations)
    - app/core/ (configuration and security)
    - app/middleware/ (request/response handling)
    - Error handling patterns across the app

    Each finding MUST have a unique ID starting with ARCH-. Do NOT repeat existing findings.`,
    { label: `loop:round-${round}`, phase: 'Phase 3: Loop-until-dry', schema: FINDING_SCHEMA }
  )

  if (!moreFindings) break

  const fresh = moreFindings.findings.filter((f) => !seenKeys.has(f.id))
  if (fresh.length === 0) {
    dryRounds++
    log(`  Round ${round}: 没有新发现 (dry=${dryRounds}/2)`)
  } else {
    dryRounds = 0
    fresh.forEach((f) => seenKeys.add(f.id))
    confirmed.push(...fresh)
    log(`  Round ${round}: 发现 ${fresh.length} 个新问题！`)
  }
}

log(`Phase 3 完成：循环 ${round} 轮，共确认 ${confirmed.length} 个问题`)

// ── Phase 4: Completeness Critic ─────────────────────────────
//
// 🔵 高级之处：让一个"元审查者"审视整个过程
//    → 不是再找一遍 bug，而是反思"什么类型的检查被遗漏了"
//    → 这种自我批判能力是简单 pipeline 做不到的

phase('Phase 4: Completeness Critic')
log('🔵 启动完整性批评家：审视我们的盲点...')

const critic = await agent(
  `You are a COMPLETENESS CRITIC. An architecture audit was just performed on a FastAPI + SQLAlchemy project.

  The audit covered:
  - Dependency direction violations (api->services->crud->models)
  - Data consistency (soft delete, optimistic locking, audit fields)
  - Async safety (blocking calls, missing awaits)
  - Additional findings from iterative search

  The project is at /home/caosen/GitHub/applebox-service/

  Your job: What did we MISS? Consider:
  1. Security patterns (auth, input validation, SQL injection)
  2. Performance patterns (N+1 queries, missing indexes, caching)
  3. Error handling patterns (exception hierarchy, error propagation)
  4. Configuration patterns (env vars, secrets management)
  5. Testing gaps (test coverage, integration test patterns)

  Rate overall coverage 0-100 and list the most important gaps.`,
  { label: 'completeness-critic', phase: 'Phase 4: Completeness Critic', schema: CRITIC_SCHEMA }
)

log(`Phase 4 完成：覆盖率评分 ${critic?.coverage_score || '?'}/100`)
if (critic?.gaps?.length) {
  critic.gaps.forEach((g) => log(`  ⚠ 盲区: ${g.area} — ${g.why_important}`))
}

// ── Phase 5: Synthesis ───────────────────────────────────────
//
// 🟣 高级之处：最终综合不是简单拼接，而是结构化输出
//    → 按严重程度分组、附带投票细节和完整性评估

phase('Phase 5: Synthesis')
log('🟣 生成最终报告...')

const critical = confirmed.filter((f) => f.severity === 'critical')
const high = confirmed.filter((f) => f.severity === 'high')
const medium = confirmed.filter((f) => f.severity === 'medium')
const low = confirmed.filter((f) => f.severity === 'low')

log(`
═══════════════════════════════════════════════════════════════
  高级 Workflow 演示 - 最终报告
═══════════════════════════════════════════════════════════════

📊 统计：
  Phase 1 (多模态扫描): ${allFindings.length} 个潜在问题
  Phase 2 (对抗式验证): ${confirmed.length} 确认 / ${rejected.length} 推翻
  Phase 3 (收敛循环): ${round} 轮迭代
  Phase 4 (完整性评分): ${critic?.coverage_score || '?'}/100

🔴 Critical (${critical.length}):
${critical.map((f) => `  [${f.id}] ${f.title} (${f.file}:${f.line})`).join('\n')}

🟠 High (${high.length}):
${high.map((f) => `  [${f.id}] ${f.title} (${f.file}:${f.line})`).join('\n')}

🟡 Medium (${medium.length}):
${medium.map((f) => `  [${f.id}] ${f.title} (${f.file}:${f.line})`).join('\n')}

🟢 Low (${low.length}):
${low.map((f) => `  [${f.id}] ${f.title} (${f.file}:${f.line})`).join('\n')}

🔍 盲区提示:
${critic?.gaps?.map((g) => `  - ${g.area}: ${g.why_important}`).join('\n') || '  无'}

═══════════════════════════════════════════════════════════════
`)

return {
  summary: {
    total_findings: confirmed.length,
    critical: critical.length,
    high: high.length,
    medium: medium.length,
    low: low.length,
    rejected_false_positives: rejected.length,
    loop_rounds: round,
    coverage_score: critic?.coverage_score,
    gaps_identified: critic?.gaps?.length || 0,
  },
  findings: confirmed,
  gaps: critic?.gaps || [],
}
