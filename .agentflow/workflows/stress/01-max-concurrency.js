// ═══════════════════════════════════════════════════════════════
// 极限测试 01: 最大并发压力
// ═══════════════════════════════════════════════════════════════
// 测试点: 当 parallel() 接收超过引擎并发上限（min(16, cpu-2)）的
//         thunk 时，引擎是否会正确排队、逐批执行、最终全部完成。
//
// 模式: 纯 parallel 扇出，零 pipeline。一次发射 20 个 agent，
//       引擎上限约 10-16 并发，多余的自动排队。
// ═══════════════════════════════════════════════════════════════

export const meta = {
  name: 'stress-01-max-concurrency',
  description: 'Stress test: launch 20 parallel agents to probe concurrency limits',
  phases: [
    { title: 'Fan-out', detail: 'Launch 20 agents simultaneously' },
    { title: 'Collect', detail: 'Gather and summarize' },
  ],
}

phase('Fan-out')

const AGENT_COUNT = 20
log(`🚀 同时发射 ${AGENT_COUNT} 个 agent（引擎会排队处理）...`)

const results = await parallel(
  Array.from({ length: AGENT_COUNT }, (_, i) => () =>
    agent(
      `You are agent #${i + 1} of ${AGENT_COUNT}.
       Quickly answer: what is ${i + 1} * ${i + 1}? Just return the number.
       Also name one file from app/services/ of this project at /home/caosen/GitHub/applebox-service/.`,
      {
        label: `concurrent:${i + 1}`,
        phase: 'Fan-out',
        model: 'haiku',
        schema: {
          type: 'object',
          properties: {
            agent_id: { type: 'number' },
            square: { type: 'number' },
            file_found: { type: 'string' },
          },
          required: ['agent_id', 'square', 'file_found'],
        },
      }
    )
  )
)

phase('Collect')

const succeeded = results.filter(Boolean)
const failed = results.filter((r) => r === null)
log(`✅ ${succeeded.length} 成功, ❌ ${failed.length} 失败（用户跳过或出错）`)

// 验证数学正确性
const mathErrors = succeeded.filter((r) => r.square !== r.agent_id * r.agent_id)
if (mathErrors.length > 0) {
  log(`⚠️ ${mathErrors.length} 个 agent 算错了平方！`)
} else {
  log(`🎯 全部 ${succeeded.length} 个 agent 的数学计算正确`)
}

return {
  total_launched: AGENT_COUNT,
  succeeded: succeeded.length,
  failed: failed.length,
  math_correct: mathErrors.length === 0,
}
