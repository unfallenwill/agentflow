// ═══════════════════════════════════════════════════════════════
// 极限测试 05: Map-Reduce-Map 双重屏障
// ═══════════════════════════════════════════════════════════════
// 测试点: parallel → merge → parallel 的经典 MapReduce 模式。
//         第一次 parallel 扇出搜索，merge 去重分类，
//         第二次 parallel 扇出针对每个类别深度分析。
//
// 模式: 两阶段 MapReduce。中间的 merge 是同步屏障点——
//       必须等第一次扇出全部完成才能去重，才能开始第二次扇出。
//
// 关键: 验证引擎处理 parallel → 纯计算 → parallel 交替的能力。
// ═══════════════════════════════════════════════════════════════

export const meta = {
  name: 'stress-05-map-reduce-map',
  description: 'Stress test: Map-Reduce-Map with two parallel barriers and a merge in between',
  phases: [
    { title: 'Map 1', detail: 'Fan-out: 6 agents scan different areas' },
    { title: 'Reduce', detail: 'Merge, deduplicate, classify' },
    { title: 'Map 2', detail: 'Fan-out: deep analysis per category' },
  ],
}

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          category: { type: 'string', enum: ['security', 'performance', 'maintainability', 'bug', 'style'] },
          file: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        },
        required: ['title', 'category', 'file', 'severity'],
      },
    },
  },
  required: ['findings'],
}

const DEEP_ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string' },
    total_issues: { type: 'number' },
    top_issue: { type: 'string' },
    recommendation: { type: 'string' },
  },
  required: ['category', 'total_issues', 'top_issue', 'recommendation'],
}

// ── Map 1: 扇出搜索 ───────────────────────────────────────────
phase('Map 1')

const SCAN_AREAS = [
  { area: 'app/api/', focus: 'endpoint error handling and input validation' },
  { area: 'app/services/', focus: 'business logic correctness and race conditions' },
  { area: 'app/crud/', focus: 'SQL injection and query efficiency' },
  { area: 'app/core/', focus: 'authentication and authorization flaws' },
  { area: 'app/models/', focus: 'data integrity and constraint violations' },
  { area: 'app/libs/', focus: 'external API integration error handling' },
]

log(`🗺️ Map 1: ${SCAN_AREAS.length} 个 agent 并行扫描...`)

const map1Results = await parallel(
  SCAN_AREAS.map(({ area, focus }) => () =>
    agent(
      `Scan ${area} in /home/caosen/GitHub/applebox-service/ for issues related to: ${focus}.
       Find up to 5 real issues. Be specific about file paths.`,
      { label: `map1:${area.replace(/\//g, '')}`, phase: 'Map 1', model: 'haiku', schema: FINDING_SCHEMA }
    )
  )
)

// ── Reduce: 合并去重分类 ──────────────────────────────────────
phase('Reduce')

const allFindings = map1Results.filter(Boolean).flatMap((r) => r.findings)
log(`📥 收集到 ${allFindings.length} 个原始发现`)

// 去重：同一文件同一标题视为重复
const seen = new Set()
const deduped = allFindings.filter((f) => {
  const key = `${f.file}::${f.title}`
  if (seen.has(key)) return false
  seen.add(key)
  return true
})
log(`🔄 去重后 ${deduped.length} 个唯一发现`)

// 按类别分组
const byCategory = {}
deduped.forEach((f) => {
  if (!byCategory[f.category]) byCategory[f.category] = []
  byCategory[f.category].push(f)
})

const categories = Object.keys(byCategory)
categories.forEach((cat) => log(`  📂 ${cat}: ${byCategory[cat].length} 个问题`))

// ── Map 2: 按类别深度分析 ─────────────────────────────────────
phase('Map 2')

log(`🗺️ Map 2: ${categories.length} 个 agent 对各类别深度分析...`)

const map2Results = await parallel(
  categories.map((category) => () =>
    agent(
      `Deep analysis of ${category} issues in /home/caosen/GitHub/applebox-service/.
       Issues found:
       ${byCategory[category].map((f) => `- [${f.severity}] ${f.title} in ${f.file}`).join('\n')}

       What is the root cause pattern? What is the single most impactful fix?`,
      { label: `map2:${category}`, phase: 'Map 2', schema: DEEP_ANALYSIS_SCHEMA }
    )
  )
)

const analyses = map2Results.filter(Boolean)
log(`📊 ${analyses.length} 个类别的深度分析完成`)
analyses.forEach((a) => log(`  ${a.category}: "${a.top_issue}" → ${a.recommendation}`))

return {
  map1_findings: allFindings.length,
  deduped: deduped.length,
  categories: categories.length,
  analyses,
}
