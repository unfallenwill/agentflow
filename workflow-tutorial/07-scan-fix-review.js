export const meta = {
  name: 'scan-fix-review',
  description: '扫描代码问题，对抗验证，pipeline 修复+测试+复查，生成报告',
  phases: [
    { title: 'Scan' },
    { title: 'Normalize' },
    { title: 'Verify' },
    { title: 'Fix' },
    { title: 'Report' },
  ],
}

// ── Schemas ──

var FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          description: { type: 'string' },
        },
        required: ['title', 'file', 'severity', 'description'],
      },
    },
  },
  required: ['findings'],
}

var VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    isReal: { type: 'boolean', description: '该发现是否真实存在' },
    confidence: {
      type: 'string',
      enum: ['high', 'medium', 'low'],
      description: '判断置信度',
    },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          lineStart: { type: 'number' },
          lineEnd: { type: 'number' },
          explanation: { type: 'string' },
        },
        required: ['file', 'lineStart', 'lineEnd', 'explanation'],
      },
      description: '支持该判断的代码证据',
    },
    counterEvidence: {
      type: 'array',
      items: { type: 'string' },
      description: '反驳该发现的证据',
    },
    reason: { type: 'string', description: '最终判断理由' },
  },
  required: ['isReal', 'confidence', 'evidence', 'counterEvidence', 'reason'],
}

var TEST_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    passed: { type: 'boolean' },
    details: { type: 'string' },
  },
  required: ['passed', 'details'],
}

var REREVIEW_SCHEMA = {
  type: 'object',
  properties: {
    quality: { type: 'string', enum: ['good', 'acceptable', 'needs-work'] },
    issues: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['quality', 'issues'],
}

// ── Phase 1: Scan — 多角度并行扫描 ──

var SCAN_ANGLES = [
  { key: 'correctness', prompt: '从正确性角度找 bug：逻辑错误、边界条件、返回值未检查、off-by-one' },
  { key: 'error-handling', prompt: '从错误处理角度找 bug：异常吞没、资源泄漏（信号量/连接未释放）、finally 缺失' },
  { key: 'concurrency', prompt: '从并发安全角度找 bug：竞态条件、死锁、Promise 静默失败' },
  { key: 'api-contract', prompt: '从 API 契约角度找 bug：输入验证缺失、输出与类型声明不一致、边界行为未定义' },
  { key: 'lifecycle', prompt: '从状态生命周期角度找 bug：对象初始化顺序、状态泄漏、多次 dispose/reset' },
]

phase('Scan')
var scanResults = await parallel(
  SCAN_ANGLES.map(function (angle) {
    return function () {
      return agent(angle.prompt, {
        label: 'scan:' + angle.key,
        phase: 'Scan',
        schema: FINDINGS_SCHEMA,
      })
    }
  })
)

var allRaw = scanResults
  .filter(Boolean)
  .flatMap(function (r) { return r.findings })

log('扫描完成，共发现 ' + allRaw.length + ' 个原始问题')

if (allRaw.length === 0) {
  phase('Report')
  return { summary: '无问题发现' }
}

// ── Phase 2: Normalize — 去重合并 ──

phase('Normalize')
var normalized = await agent(
  '将以下代码问题列表去重合并。合并标题或描述相似的条目（保留信息最完整的版本），' +
  '统一 file 路径格式，补充缺失的字段。\n\n' +
  '原始列表:\n' + JSON.stringify(allRaw, null, 2),
  { label: 'normalize', phase: 'Normalize', schema: FINDINGS_SCHEMA }
)

var findings = normalized ? normalized.findings : allRaw
log('归一化后 ' + findings.length + ' 个唯一问题')

if (findings.length === 0) {
  phase('Report')
  return { summary: '无问题发现' }
}

// ── Phase 3: Verify — 对抗验证（3 人投票，≥2 人无法反驳才保留） ──

phase('Verify')
var confirmed = []

for (var fi = 0; fi < findings.length; fi++) {
  var finding = findings[fi]
  var votes = await parallel(
    Array.from({ length: 3 }, function () {
      return function () {
        return agent(
          '你是代码审查验证者。你的任务不是附和发现，而是尽力反驳它。\n\n' +
          '步骤:\n' +
          '1. 打开该发现对应的文件和行号，阅读足够的上下文\n' +
          '2. 查找相关函数、调用链、接口定义和测试\n' +
          '3. 判断该问题是否在真实执行路径中成立\n' +
          '4. 如果能被现有逻辑、校验、异常处理、类型约束、调用前置条件反驳，判定 isReal=false\n' +
          '5. 如果无法反驳且有明确代码证据，判定 isReal=true\n' +
          '6. 不确定时默认 isReal=false\n' +
          '7. 必须给出 evidence 或 counterEvidence\n\n' +
          '注意:\n' +
          '- 不要相信原始 finding 的描述，独立验证\n' +
          '- 必须基于代码证据，不要根据常识判断\n\n' +
          '标题: ' + finding.title + '\n' +
          '文件: ' + finding.file + '\n' +
          '严重程度: ' + finding.severity + '\n' +
          '描述: ' + finding.description,
          { phase: 'Verify', schema: VERDICT_SCHEMA }
        )
      }
    })
  )

  var notRefuted = votes
    .filter(Boolean)
    .filter(function (v) { return v.isReal })
    .length

  if (notRefuted >= 2) {
    confirmed.push(finding)
  }
}

log('验证结果: ' + confirmed.length + '/' + findings.length + ' 个确认')

if (confirmed.length === 0) {
  phase('Report')
  return { summary: '所有发现为假阳性', total: findings.length }
}

// ── Phase 4: Fix — pipeline: 修复 → 测试 → 复查 ──
// 每个 issue 独立流经三个 stage，无需等齐

phase('Fix')
var fixResults = await pipeline(
  confirmed,
  // stage 1: 修复问题
  function (issue, original, idx) {
    return agent(
      '修复以下代码问题。直接修改文件，修改后列出变更摘要。\n\n' +
      '问题: ' + issue.title + '\n' +
      '文件: ' + issue.file + '\n' +
      '描述: ' + issue.description,
      { label: 'fix:' + idx, phase: 'Fix' }
    )
  },
  // stage 2: 测试修复
  function (fixSummary, original, idx) {
    return agent(
      '测试刚才的修复是否正确。运行相关测试，检查:\n' +
      '1. 原问题是否已解决\n' +
      '2. 是否引入回归\n\n' +
      '原问题: ' + original.title + '\n' +
      '修复内容: ' + fixSummary,
      { label: 'test:' + idx, phase: 'Fix', schema: TEST_RESULT_SCHEMA }
    )
  },
  // stage 3: 复查质量
  function (testResult, original, idx) {
    return agent(
      '二次审查修复质量。检查:\n' +
      '1. 修复是否完整解决了原始问题\n' +
      '2. 代码风格是否一致\n\n' +
      '原问题: ' + original.title + '\n' +
      '文件: ' + original.file + '\n' +
      '测试结果: ' + JSON.stringify(testResult),
      { label: 're-review:' + idx, phase: 'Fix', schema: REREVIEW_SCHEMA }
    )
  }
)

var goodFixes = fixResults.filter(Boolean).filter(function (r) {
  return r.quality === 'good' || r.quality === 'acceptable'
})
var needsWork = fixResults.filter(Boolean).filter(function (r) {
  return r.quality === 'needs-work'
})
log('修复完成: ' + goodFixes.length + ' 达标 / ' + needsWork.length + ' 需返工')

// ── Phase 5: Report ──

phase('Report')
var report = await agent(
  '生成最终代码审查与修复报告:\n\n' +
  '## 扫描\n' +
  '- 维度: ' + SCAN_ANGLES.map(function (a) { return a.key }).join(', ') + '\n' +
  '- 原始发现: ' + allRaw.length + '\n' +
  '- 去重后: ' + findings.length + '\n' +
  '- 对抗验证确认: ' + confirmed.length + '\n\n' +
  '## 修复\n' +
  '- 达标: ' + goodFixes.length + '\n' +
  '- 需返工: ' + needsWork.length + '\n\n' +
  '## 需返工的项\n' +
  JSON.stringify(needsWork, null, 2) + '\n\n' +
  '请给出总结和后续建议。',
  { phase: 'Report' }
)

return {
  stats: {
    raw: allRaw.length,
    normalized: findings.length,
    confirmed: confirmed.length,
    good: goodFixes.length,
    needsWork: needsWork.length,
  },
  report: report,
}
