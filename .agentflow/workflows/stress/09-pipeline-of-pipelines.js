// ═══════════════════════════════════════════════════════════════
// 极限测试 09: Pipeline 中的 Pipeline（嵌套并行）
// ═══════════════════════════════════════════════════════════════
// 测试点: pipeline 的每个 stage 内部又运行 parallel——
//         即"每个 item 在每个 stage 中并行派发多个子 agent"。
//
// 模式: Pipeline-of-Parallels。外层 pipeline 驱动文件流过阶段，
//         内层 parallel 让每个阶段对每个文件做多种并行分析。
//         总拓扑: 3 files × 3 stages × 2 agents = 18 agents。
//
// 关键: 验证 pipeline 和 parallel 嵌套时引擎的并发调度能力。
//         Item A 的 stage 2 和 Item B 的 stage 1 可能同时运行。
// ═══════════════════════════════════════════════════════════════

export const meta = {
  name: 'stress-09-pipeline-of-pipelines',
  description: 'Stress test: pipeline where each stage runs parallel sub-agents',
  phases: [
    { title: 'Process', detail: '3 files × 3 stages with parallel sub-agents' },
    { title: 'Summary', detail: 'Aggregate all results' },
  ],
}

const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    finding: { type: 'string' },
    score: { type: 'number' },
  },
  required: ['finding', 'score'],
}

const FILES = [
  { path: 'app/services/workbench.py', desc: 'workbench business logic' },
  { path: 'app/services/workflow.py', desc: 'workflow orchestration' },
  { path: 'app/services/script.py', desc: 'script management' },
]

phase('Process')

log('🔄 Pipeline-of-Pipelines: 3 files × 3 stages × 2 agents each')

const results = await pipeline(
  FILES,

  // Stage 1: 2 agents 并行读文件（概览 + 结构分析）
  (file) =>
    parallel([
      () =>
        agent(
          `Read ${file.path} in /home/caosen/GitHub/applebox-service/. What does this file do? Key functions?`,
          { label: `s1-overview:${file.path.split('/').pop()}`, phase: 'Process', model: 'haiku', schema: ANALYSIS_SCHEMA }
        ),
      () =>
        agent(
          `Analyze the structure of ${file.path}. How many classes? Functions? Lines of complexity?`,
          { label: `s1-structure:${file.path.split('/').pop()}`, phase: 'Process', model: 'haiku', schema: ANALYSIS_SCHEMA }
        ),
    ]).then((pair) => ({ overview: pair[0], structure: pair[1], file })),

  // Stage 2: 基于Stage 1的结果，2 agents 并行做安全和性能分析
  (s1) =>
    parallel([
      () =>
        agent(
          `Security analysis of ${s1.file.path}. Overview: ${s1.overview?.finding}. Find one security risk.`,
          { label: `s2-security:${s1.file.path.split('/').pop()}`, phase: 'Process', schema: ANALYSIS_SCHEMA }
        ),
      () =>
        agent(
          `Performance analysis of ${s1.file.path}. Structure: ${s1.structure?.finding}. Find one perf risk.`,
          { label: `s2-perf:${s1.file.path.split('/').pop()}`, phase: 'Process', schema: ANALYSIS_SCHEMA }
        ),
    ]).then((pair) => ({ ...s1, security: pair[0], performance: pair[1] })),

  // Stage 3: 综合打分（1 个 agent，利用原始 item 和 index）
  (s2, _s1, file, index) =>
    agent(
      `Synthesize all analysis for ${file.path}:
       Overview: ${s2.overview?.finding}
       Structure: ${s2.structure?.finding}
       Security: ${s2.security?.finding}
       Performance: ${s2.performance?.finding}
       Give a final priority score 0-100 for refactoring this file.`,
      { label: `s3-synth:${file.path.split('/').pop()}`, phase: 'Process', model: 'haiku', schema: ANALYSIS_SCHEMA }
    ).then((synth) => ({
      index: index + 1,
      file: file.path,
      desc: file.desc,
      final_score: synth?.score || 0,
      final_finding: synth?.finding,
    }))
)

phase('Summary')

const valid = results.filter(Boolean).sort((a, b) => (b.final_score || 0) - (a.final_score || 0))
valid.forEach((r) => log(`  #${r.index} ${r.file} (${r.desc}): 分数 ${r.final_score}`))

return { files_analyzed: valid.length, results: valid }
