// ═══════════════════════════════════════════════════════════════
// 极限测试 02: 8 级深度 Pipeline
// ═══════════════════════════════════════════════════════════════
// 测试点: pipeline() 的极限深度。8 个 stage 级联，每个 stage 对数据
//         做不同变换。验证数据是否能正确流过所有阶段。
//
// 模式: 纯 pipeline，零 parallel。模拟一条数据处理流水线：
//       文件列表 → 读取 → 分析 → 过滤 → 排序 → 分组 → 打分 → 输出
//
// 关键: 每个 item 独立流转，item A 可能在 stage 5 而 item B 还在 stage 2。
// ═══════════════════════════════════════════════════════════════

export const meta = {
  name: 'stress-02-deep-pipeline',
  description: 'Stress test: 8-stage deep pipeline with data transformations at each stage',
  phases: [
    { title: 'Seed', detail: 'Generate starting file list' },
    { title: 'Pipeline', detail: '8-stage cascade' },
    { title: 'Output', detail: 'Final results' },
  ],
}

phase('Seed')
log('🌱 生成种子数据...')

// 用 args 或默认值决定扫描多少文件
const FILE_COUNT = args?.fileCount || 10

const SEED_SCHEMA = {
  type: 'object',
  properties: {
    files: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          purpose: { type: 'string' },
        },
        required: ['path', 'purpose'],
      },
    },
  },
  required: ['files'],
}

const seed = await agent(
  `List exactly ${FILE_COUNT} Python files from /home/caosen/GitHub/applebox-service/app/services/.
   For each file, briefly state its purpose (2-5 words).`,
  { label: 'seed-files', phase: 'Seed', model: 'haiku', schema: SEED_SCHEMA }
)

const files = seed?.files || []
log(`🌱 获得 ${files.length} 个文件作为 pipeline 输入`)

phase('Pipeline')
log('🏭 启动 8 级深度 pipeline...')

const THOUGHT_SCHEMA = {
  type: 'object',
  properties: {
    result: { type: 'string' },
    score: { type: 'number' },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['result', 'score'],
}

const processed = await pipeline(
  files,
  // Stage 1: Classify file type
  (file) =>
    agent(`Classify this file's type in one word (service/util/handler/model/middleware): ${file.path}`, {
      label: `s1-classify:${file.path.split('/').pop()}`,
      phase: 'Pipeline',
      model: 'haiku',
      schema: { type: 'object', properties: { type: { type: 'string' } }, required: ['type'] },
    }),

  // Stage 2: Assess complexity (uses originalItem from pipeline callback)
  (classification, file) =>
    agent(
      `Rate complexity 1-10 for a ${classification?.type || 'unknown'} file that "${file.purpose}". Reply with just a number and one reason.`,
      { label: `s2-complexity:${file.path.split('/').pop()}`, phase: 'Pipeline', model: 'haiku', schema: THOUGHT_SCHEMA }
    ),

  // Stage 3: Security assessment
  (complexity, _classification, file) =>
    agent(
      `Quick security check: a ${file.purpose} service file with complexity ${complexity?.score || 5}. Any obvious risks? One sentence.`,
      { label: `s3-security:${file.path.split('/').pop()}`, phase: 'Pipeline', model: 'haiku', schema: THOUGHT_SCHEMA }
    ),

  // Stage 4: Async safety
  (security) =>
    agent(
      `Given this security note: "${security?.result || 'unknown'}". Is async handling a concern? One sentence.`,
      { label: 's4-async', phase: 'Pipeline', model: 'haiku', schema: THOUGHT_SCHEMA }
    ),

  // Stage 5: Test coverage estimate
  (asyncSafety) =>
    agent(
      `Given async concern: "${asyncSafety?.result || 'none'}". Estimate test coverage needed: low/medium/high. Reply with level and reason.`,
      { label: 's5-testing', phase: 'Pipeline', model: 'haiku', schema: THOUGHT_SCHEMA }
    ),

  // Stage 6: Priority scoring
  (testNeed, _async, _security, _complexity, _classification, file) =>
    agent(
      `Priority score 0-100 for reviewing "${file.path}" (${file.purpose}). Consider all previous analysis.`,
      { label: `s6-priority:${file.path.split('/').pop()}`, phase: 'Pipeline', model: 'haiku', schema: THOUGHT_SCHEMA }
    ),

  // Stage 7: Action recommendation
  (priority) =>
    agent(
      `Given priority ${priority?.score || 50}: recommend one action (review/refactor/test/ignore). Just the action and reason.`,
      { label: 's7-action', phase: 'Pipeline', model: 'haiku', schema: THOUGHT_SCHEMA }
    ),

  // Stage 8: Final synthesis (uses index from pipeline callback)
  (action, _priority, _testNeed, _async, _security, _complexity, _classification, file, index) => ({
    index: index + 1,
    path: file.path,
    purpose: file.purpose,
    action: action?.result || 'unknown',
    priority: action?.score || 0,
  })
)

phase('Output')

const sorted = processed.filter(Boolean).sort((a, b) => (b.priority || 0) - (a.priority || 0))
log(`📊 ${sorted.length} 个文件流过全部 8 级 pipeline`)
sorted.slice(0, 5).forEach((item) => {
  log(`  #${item.index} ${item.path} → ${item.action} (优先级 ${item.priority})`)
})

return { total: sorted.length, top_priority: sorted[0]?.path }
