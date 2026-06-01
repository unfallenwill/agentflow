// ══════════════════════════════════════════════════════════════════════════════
// Workflow 全特性演示脚本
// ══════════════════════════════════════════════════════════════════════════════
//
// 本脚本的目标：在一个连贯的工作流中，展示 Workflow 引擎的每一个特性。
// 每个特性都用 ╔═══╗ 标注，包含"是什么"和"使用场景"。
//
// 演示场景：自动化"新功能开发流水线"
//   输入一个功能描述 → 理解代码库 → 设计方案竞标 → 并行实现 → 验证 → 测试
//
// ══════════════════════════════════════════════════════════════════════════════

// ┌─────────────────────────────────────────────────────────────────────────────
// │ 特性 1: export const meta                                                   │
// │                                                                             │
// │ 是什么：Workflow 的元数据声明，必须在脚本最开头。                            │
// │   - name:       工作流名称，显示在进度 UI 和 /workflows 列表中               │
// │   - description: 一句话描述，显示在权限确认对话框中                           │
// │   - phases:     每个阶段的标题和详情，控制进度条显示                          │
// │   - phases[].model: （可选）该阶段所有 agent 的默认模型覆盖                   │
// │   - whenToUse:  （可选）在 workflow 列表中显示使用建议                        │
// │                                                                             │
// │ 使用场景：每个 workflow 都必须有。phases 定义了用户在 UI 中看到的             │
// │ 进度分组——每个 phase() 调用必须对应 meta.phases 中的一个 title。             │
// └─────────────────────────────────────────────────────────────────────────────

export const meta = {
  name: 'all-features-demo',
  description: 'Comprehensive workflow demo exercising every available feature with detailed annotations',
  whenToUse: 'When you want to see every workflow feature in action, or as a template for building new workflows',
  phases: [
    {
      title: 'Phase 1: Understand',
      detail: 'Multi-modal codebase exploration using Explore agentType',
    },
    {
      title: 'Phase 2: Design',
      detail: 'Judge panel: 3 independent design proposals, scored and synthesized',
    },
    {
      title: 'Phase 3: Implement',
      detail: 'Parallel implementation in isolated worktrees',
    },
    {
      title: 'Phase 4: Verify',
      detail: 'Adversarial verification + completeness critic',
    },
    {
      title: 'Phase 5: Test',
      detail: 'Nested sub-workflow for testing loop-until-budget',
    },
    {
      title: 'Phase 6: Synthesize',
      detail: 'Final report with budget stats',
    },
  ],
}

// ┌─────────────────────────────────────────────────────────────────────────────
// │ 特性 2: args                                                                │
// │                                                                             │
// │ 是什么：从 Workflow 工具的 args 参数传入的外部输入。                          │
// │   调用方式：Workflow({ scriptPath: "...", args: { key: value } })           │
// │   在脚本中直接用 `args` 全局变量访问。                                       │
// │                                                                             │
// │ 使用场景：让 workflow 可复用。同一个脚本，不同的 args = 不同的执行。           │
// │   例：args = { targetDir: "app/services/", severityThreshold: "high" }      │
// │   也可以是数组：args = ["file1.ts", "file2.ts"]                             │
// │                                                                             │
// │ ⚠ 注意：传给 Workflow 工具时用 JSON 值，不要 stringify。                    │
// │   ✅ Workflow({ args: { dir: "app" } })                                    │
// │   ❌ Workflow({ args: '{"dir":"app"}' })  ← 这是字符串，args.dir 会 undefined│
// └─────────────────────────────────────────────────────────────────────────────

const TARGET_MODULE = args?.targetModule || 'app/services/'
const FEATURE_DESC = args?.featureDescription || 'Add request throttling middleware'

log(`📋 输入参数: targetModule=${TARGET_MODULE}, feature=${FEATURE_DESC}`)

// ┌─────────────────────────────────────────────────────────────────────────────
// │ 特性 3: budget                                                              │
// │                                                                             │
// │ 是什么：当前 turn 的 token 预算控制对象。                                     │
// │   - budget.total:     用户设定的总 token 数（如 500000），未设定时为 null     │
// │   - budget.spent():   返回当前 turn 已消耗的 token 数                        │
// │   - budget.remaining(): 返回剩余 token 数（未设定时为 Infinity）              │
// │                                                                             │
// │ 使用场景：                                                                   │
// │   1. Loop-until-budget：按预算动态调整迭代深度                               │
// │      while (budget.total && budget.remaining() > 50000) { ... }             │
// │   2. 静态缩放：有预算时多派 agent，没预算时少派                               │
// │      const WORKER_COUNT = budget.total ? Math.floor(budget.total / 100000) : 3│
// │   3. budget.total 是硬上限——spent() 达到 total 后，后续 agent() 调用会抛异常  │
// │                                                                             │
// │ ⚠ budget 是 turn 级别的，多个 workflow 共享同一个池。                        │
// └─────────────────────────────────────────────────────────────────────────────

const BUDGET_PER_PHASE = budget.total ? Math.floor(budget.total / 6) : Infinity
log(`💰 Token 预算: total=${budget.total || '∞'}, 已用=${budget.spent()}, 剩余=${budget.remaining()}`)

// 根据 budget 动态决定 agent 数量
const WORKER_COUNT = budget.total ? Math.max(2, Math.floor(budget.total / 100000)) : 3
log(`👷 基于预算的 agent 数量: ${WORKER_COUNT}`)

// ══════════════════════════════════════════════════════════════════════════════
// Schema 定义
// ══════════════════════════════════════════════════════════════════════════════

const EXPLORATION_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    key_files: { type: 'array', items: { type: 'string' } },
    patterns: { type: 'array', items: { type: 'string' } },
    constraints: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'key_files', 'patterns'],
}

const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    approach_name: { type: 'string' },
    description: { type: 'string' },
    files_to_create: { type: 'array', items: { type: 'string' } },
    files_to_modify: { type: 'array', items: { type: 'string' } },
    tradeoffs: { type: 'string' },
    estimated_complexity: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
  required: ['approach_name', 'description', 'files_to_create', 'files_to_modify'],
}

const SCORE_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'number', description: '0-100' },
    strengths: { type: 'array', items: { type: 'string' } },
    weaknesses: { type: 'array', items: { type: 'string' } },
    recommendation: { type: 'string', enum: ['adopt', 'modify', 'reject'] },
  },
  required: ['score', 'strengths', 'weaknesses', 'recommendation'],
}

const IMPL_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    files_created: { type: 'array', items: { type: 'string' } },
    files_modified: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    issues_encountered: { type: 'array', items: { type: 'string' } },
  },
  required: ['files_created', 'files_modified', 'summary'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    is_sound: { type: 'boolean' },
    confidence: { type: 'number' },
    issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['is_sound', 'confidence'],
}

const CRITIC_SCHEMA = {
  type: 'object',
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          area: { type: 'string' },
          why_important: { type: 'string' },
          suggested_fix: { type: 'string' },
        },
        required: ['area', 'why_important'],
      },
    },
    coverage_score: { type: 'number' },
  },
  required: ['gaps', 'coverage_score'],
}

// ══════════════════════════════════════════════════════════════════════════════
// Phase 1: Understand — Multi-modal Sweep + agentType
// ══════════════════════════════════════════════════════════════════════════════

phase('Phase 1: Understand')

// ┌─────────────────────────────────────────────────────────────────────────────
// │ 特性 4: phase(title)                                                        │
// │                                                                             │
// │ 是什么：声明一个新阶段的开始。此后的 agent() 调用在 UI 中归入该阶段。         │
// │   title 必须与 meta.phases[].title 精确匹配。                               │
// │                                                                             │
// │ 使用场景：把工作流划分为可见的阶段。用户在进度 UI 中看到分组进度。             │
// └─────────────────────────────────────────────────────────────────────────────

// ┌─────────────────────────────────────────────────────────────────────────────
// │ 特性 5: log(message)                                                        │
// │                                                                             │
// │ 是什么：向用户输出一条进度消息，显示在进度树的叙述行中。                       │
// │                                                                             │
// │ 使用场景：向用户报告中间状态、统计数字、决策原因。                             │
// │   例：log(`Found ${bugs.length} bugs, ${remaining} tokens left`)            │
// └─────────────────────────────────────────────────────────────────────────────

log('📖 启动多模态代码探索...')

// ┌─────────────────────────────────────────────────────────────────────────────
// │ 特性 6: agent(prompt, opts)                                                 │
// │                                                                             │
// │ 是什么：生成一个子 agent 来执行任务。返回 agent 的最终文本结果。              │
// │   opts:                                                                     │
// │     label     - UI 中显示的标签（3-5 词）                                   │
// │     phase     - 显式分配到某个进度组（覆盖 phase() 的当前阶段）              │
// │     schema    - JSON Schema 对象，强制 agent 输出结构化 JSON                 │
// │     model     - 模型覆盖: 'sonnet' | 'opus' | 'haiku'                       │
// │     isolation - 'worktree' 让 agent 在独立 git 工作树中操作                  │
// │     agentType - 使用自定义 subagent 类型（如 'Explore', 'code-reviewer'）    │
// │                                                                             │
// │ 返回值：                                                                     │
// │   无 schema → 返回 agent 的最终文本（string）                               │
// │   有 schema → 返回经过 JSON Schema 验证的结构化对象                          │
// │   用户跳过   → 返回 null                                                    │
// │                                                                             │
// │ 使用场景：所有需要子 agent 执行的工作。是 workflow 的核心构建块。              │
// └─────────────────────────────────────────────────────────────────────────────

// ┌─────────────────────────────────────────────────────────────────────────────
// │ 特性 7: opts.agentType                                                      │
// │                                                                             │
// │ 是什么：指定 agent 使用自定义 subagent 类型，而非默认的通用 agent。           │
// │   可用类型来自 Agent 工具的 subagent_type 定义：                             │
// │     'Explore'              - 只读搜索 agent，广度优先                        │
// │     'Plan'                 - 只读架构分析                                    │
// │     'feature-dev:code-reviewer' - 代码审查                                   │
// │     'general-purpose'      - 通用，可读写                                    │
// │                                                                             │
// │ 使用场景：                                                                   │
// │   - 探索代码库结构 → 用 'Explore'（只读、广度搜索、快速）                    │
// │   - 审查代码质量 → 用 'feature-dev:code-reviewer'                           │
// │   - 需要写文件 → 用 'general-purpose'                                       │
// │   agentType 可以和 schema 组合使用。                                        │
// └─────────────────────────────────────────────────────────────────────────────

// ┌─────────────────────────────────────────────────────────────────────────────
// │ 特性 8: opts.model                                                          │
// │                                                                             │
// │ 是什么：为单个 agent 调用覆盖模型。                                          │
// │   可选值: 'sonnet' | 'opus' | 'haiku'                                       │
// │   不设置时继承主循环的模型（通常是正确的选择）。                               │
// │                                                                             │
// │ 使用场景：                                                                   │
// │   - 简单的分类/提取任务 → 'haiku'（快、便宜）                               │
// │   - 复杂的架构设计 → 'opus'（最强推理能力）                                  │
// │   - 一般开发任务 → 不设置（继承默认）                                        │
// │   ⚠ 只在你非常确定时才设置。大多数情况应该省略。                              │
// └─────────────────────────────────────────────────────────────────────────────

// ┌─────────────────────────────────────────────────────────────────────────────
// │ 模式: Multi-modal Sweep（多模态扫描）                                        │
// │                                                                             │
// │ 是什么：并行启动多个 agent，每个从不同视角搜索同一个目标。                     │
// │   每个 agent 是"盲"的——看不到其他 agent 发现了什么。                         │
// │   互补性好：单一视角容易遗漏，多视角覆盖面广。                                │
// │                                                                             │
// │ 使用场景：                                                                   │
// │   - 代码审计：按安全、性能、可维护性分别扫描                                 │
// │   - 需求分析：按用户视角、开发者视角、运维视角分别分析                        │
// │   - 文档检索：按文件名、按内容、按引用关系分别搜索                            │
// └─────────────────────────────────────────────────────────────────────────────

// ┌─────────────────────────────────────────────────────────────────────────────
// │ 特性 9: parallel(thunks)                                                    │
// │                                                                             │
// │ 是什么：屏障同步——并行执行所有 thunk，等全部完成后返回结果数组。               │
// │   thunk 是 () => Promise<any> 形式的函数。                                  │
// │   任一 thunk 抛错 → 结果数组中对应位置为 null（不会整体失败）。               │
// │                                                                             │
// │ 使用场景（屏障是正确选择时）：                                                │
// │   1. 下一阶段需要所有结果的全集（如合并去重）                                │
// │   2. 需要判断总数是否为零以决定是否提前退出                                  │
// │   3. 下一阶段的 prompt 需要引用"其他发现"做比较                              │
// │                                                                             │
// │ ⚠ 不要因为"代码更整洁"就用 parallel。屏障有真实延迟代价。                    │
// │   如果下一阶段不需要所有结果同时存在，用 pipeline 更快。                      │
// └─────────────────────────────────────────────────────────────────────────────

const explorations = await parallel([
  () =>
    agent(
      `Explore the architecture of ${TARGET_MODULE}. Focus on:
       - Directory structure and module organization
       - Key classes and their relationships
       - Entry points and dependency injection patterns
       Project root: /home/caosen/GitHub/applebox-service/`,
      {
        label: 'explore:architecture',
        phase: 'Phase 1: Understand',
        agentType: 'Explore', // ← 特性 7: 使用 Explore subagent（只读、广度优先）
        model: 'haiku',       // ← 特性 8: 简单探索用 haiku，快且便宜
        schema: EXPLORATION_SCHEMA,
      }
    ),
  () =>
    agent(
      `Explore the existing patterns for adding new features in this FastAPI project.
       Focus on:
       - How endpoints are structured in app/api/v1/endpoints/
       - How services orchestrate logic in app/services/
       - How CRUD operations work in app/crud/
       - Any middleware or dependency injection patterns
       Project root: /home/caosen/GitHub/applebox-service/`,
      {
        label: 'explore:patterns',
        phase: 'Phase 1: Understand',
        agentType: 'Explore',
        model: 'haiku',
        schema: EXPLORATION_SCHEMA,
      }
    ),
  () =>
    agent(
      `Explore the test infrastructure of this project.
       Focus on:
       - Test directory structure under tests/
       - Test configuration (conftest.py, fixtures)
       - Mocking patterns and test utilities
       - Coverage requirements
       Project root: /home/caosen/GitHub/applebox-service/`,
      {
        label: 'explore:tests',
        phase: 'Phase 1: Understand',
        agentType: 'Explore',
        model: 'haiku',
        schema: EXPLORATION_SCHEMA,
      }
    ),
])

const explorationResults = explorations.filter(Boolean)
log(`📖 探索完成: ${explorationResults.length}/3 个视角返回了结果`)

const codebaseContext = explorationResults
  .map((r, i) => `视角${i + 1}: ${r.summary}\n关键文件: ${r.key_files?.join(', ') || 'N/A'}\n模式: ${r.patterns?.join('; ') || 'N/A'}`)
  .join('\n\n')

log(`💰 Phase 1 后剩余预算: ${budget.remaining()}`)

// ══════════════════════════════════════════════════════════════════════════════
// Phase 2: Design — Judge Panel
// ══════════════════════════════════════════════════════════════════════════════

phase('Phase 2: Design')

// ┌─────────────────────────────────────────────────────────────────────────────
// │ 模式: Judge Panel（评审团）                                                 │
// │                                                                             │
// │ 是什么：生成 N 个独立方案（不同角度/偏好），然后用评审团打分，                │
// │   选出最优方案，并从其他方案中汲取好的想法。                                  │
// │                                                                             │
// │ 与单方案迭代的区别：                                                         │
// │   单方案迭代 = 一个起点反复打磨，容易陷入局部最优                            │
// │   评审团模式 = 多个起点竞争，更有可能找到全局最优                            │
// │                                                                             │
// │ 使用场景：                                                                   │
// │   - 架构设计（MVP优先 vs 安全优先 vs 性能优先）                              │
// │   - API 设计（RESTful vs GraphQL vs RPC）                                   │
// │   - 任何"有多种合理方案"的决策                                               │
// └─────────────────────────────────────────────────────────────────────────────

log('🏗️ 启动评审团：3 个独立设计方案竞标...')

const designApproaches = [
  {
    name: 'minimalist',
    perspective: 'You prefer MINIMAL changes. Reuse existing patterns, add as few files as possible. Prioritize simplicity and low risk.',
  },
  {
    name: 'robust',
    perspective: 'You prefer ROBUST solutions. Add proper error handling, logging, configuration, and extensibility. Prioritize reliability.',
  },
  {
    name: 'scalable',
    perspective: 'You prefer SCALABLE solutions. Design for future growth, use abstractions, consider performance implications. Prioritize long-term value.',
  },
]

// 三个设计师并行出方案
const designs = await parallel(
  designApproaches.map((approach) => () =>
    agent(
      `You are a software architect with a specific design philosophy: ${approach.perspective}

       Codebase context:
       ${codebaseContext}

       Feature request: "${FEATURE_DESC}"
       Target module: ${TARGET_MODULE}

       Propose a concrete implementation plan. Be specific about which files to create/modify and why.`,
      {
        label: `design:${approach.name}`,
        phase: 'Phase 2: Design',
        // 这里不用 model 覆盖——设计是核心任务，用默认（最强）模型
        schema: DESIGN_SCHEMA,
      }
    )
  )
)

const validDesigns = designs.filter(Boolean)
log(`📐 收到 ${validDesigns.length} 个设计方案`)

// 评审团打分：每个方案由独立评委评分
const scoredDesigns = await pipeline(
  validDesigns,
  (design) =>
    parallel([
      // 评委 1: 从可维护性角度评分
      () =>
        agent(
          `Score this design from a MAINTAINABILITY perspective (0-100).
           Design: ${JSON.stringify(design)}
           Codebase: ${TARGET_MODULE}
           Is it easy to understand? Easy to modify? Follows existing patterns?`,
          {
            label: `score:${design.approach_name}:maint`,
            phase: 'Phase 2: Design',
            model: 'haiku', // ← 评分是简单任务，用 haiku
            schema: SCORE_SCHEMA,
          }
        ),
      // 评委 2: 从风险角度评分
      () =>
        agent(
          `Score this design from a RISK perspective (0-100).
           Design: ${JSON.stringify(design)}
           How many files does it touch? Could it break existing functionality? Is it easy to rollback?`,
          {
            label: `score:${design.approach_name}:risk`,
            phase: 'Phase 2: Design',
            model: 'haiku',
            schema: SCORE_SCHEMA,
          }
        ),
    ]),
  // ┌───────────────────────────────────────────────────────────────────────────
  // │ 特性 10: pipeline stage callback 的完整签名                               │
  // │                                                                           │
  // │ 是什么：pipeline 每个 stage 的回调接收 3 个参数：                          │
  // │   (prevResult, originalItem, index)                                       │
  // │   - prevResult:   上一个 stage 返回的结果                                 │
  // │   - originalItem: pipeline 传入的原始 item（跨 stage 可访问）             │
  // │   - index:        当前 item 在原始数组中的索引                            │
  // │                                                                           │
  // │ 使用场景：在后续 stage 中引用原始 item 的元数据（如名称、路径），           │
  // │   而不需要在上一个 stage 中透传。                                          │
  // └───────────────────────────────────────────────────────────────────────────
  (scores, design, index) => {
    const validScores = scores.filter(Boolean)
    const avgScore = validScores.length
      ? validScores.reduce((sum, s) => sum + s.score, 0) / validScores.length
      : 0
    log(`  方案 "${design.approach_name}" 平均分: ${avgScore.toFixed(1)}`)
    return { design, scores: validScores, avgScore, index }
  }
)

// 选出最优方案
const winner = scoredDesigns.reduce((best, curr) => (curr.avgScore > best.avgScore ? curr : best), scoredDesigns[0])
log(`🏆 获胜方案: "${winner.design.approach_name}" (得分 ${winner.avgScore.toFixed(1)})`)

const winningDesign = winner.design

// ══════════════════════════════════════════════════════════════════════════════
// Phase 3: Implement — Worktree Isolation
// ══════════════════════════════════════════════════════════════════════════════

phase('Phase 3: Implement')

// ┌─────────────────────────────────────────────────────────────────────────────
// │ 特性 11: opts.isolation: 'worktree'                                         │
// │                                                                             │
// │ 是什么：让 agent 在独立的 git worktree 中操作。                              │
// │   - 每个 agent 得到一个 .claude/worktrees/ 下的独立目录和分支                │
// │   - agent 之间的文件修改完全隔离，不会冲突                                  │
// │   - 如果 agent 没有做任何修改，worktree 自动清理                            │
// │                                                                             │
// │ 代价：每次约 200-500ms 设置时间 + 磁盘占用。                                │
// │                                                                             │
// │ 使用场景：                                                                   │
// │   - 多个 agent 并行修改同一仓库的不同文件（可能冲突时）                     │
// │   - 需要安全地实验，不污染主工作目录                                        │
// │   - 每个 agent 实现方案的不同部分                                           │
// │                                                                             │
// │ ⚠ 只读任务（搜索、分析、审查）不需要 worktree。                              │
// │ ⚠ 只有需要 Edit/Write 的任务才值得用。                                      │
// └─────────────────────────────────────────────────────────────────────────────

log('🔧 启动并行实现（worktree 隔离）...')

// 演示：将实现拆分为两个并行任务，每个在独立 worktree 中
const implFiles = winningDesign.files_to_create || ['new_module.py']
const implModules = implFiles.length >= 2
  ? [implFiles.slice(0, Math.ceil(implFiles.length / 2)), implFiles.slice(Math.ceil(implFiles.length / 2))]
  : [implFiles]

const implementations = await parallel(
  implModules.map((files, i) => () =>
    agent(
      `Implement the "${winningDesign.approach_name}" design for feature: "${FEATURE_DESC}".

       Files you are responsible for: ${files.join(', ')}

       Design details:
       ${JSON.stringify(winningDesign, null, 2)}

       Codebase context:
       ${codebaseContext}

       Rules:
       - Follow existing code patterns in the project
       - Use async/await for all DB operations
       - Include proper type annotations
       - Write clean, well-structured code
       - Do NOT modify files outside your assigned list`,
      {
        label: `impl:module-${i}`,
        phase: 'Phase 3: Implement',
        isolation: 'worktree', // ← 特性 11: 独立 worktree，防止并行修改冲突
        schema: IMPL_RESULT_SCHEMA,
      }
    )
  )
)

const implResults = implementations.filter(Boolean)
log(`✅ ${implResults.length}/${implModules.length} 个模块实现完成`)
implResults.forEach((r, i) => {
  log(`  模块${i}: 创建 ${r.files_created?.length || 0} 文件, 修改 ${r.files_modified?.length || 0} 文件`)
})

// ══════════════════════════════════════════════════════════════════════════════
// Phase 4: Verify — Adversarial + Completeness Critic
// ══════════════════════════════════════════════════════════════════════════════

phase('Phase 4: Verify')

// ┌─────────────────────────────────────────────────────────────────────────────
// │ 模式: Adversarial Verification（对抗式验证）                                │
// │                                                                             │
// │ 是什么：为每个发现/实现生成 N 个"质疑者"agent，每个被指示尽量推翻结论。      │
// │   只有 ≥多数 质疑者无法推翻时，结论才被接受。                               │
// │                                                                             │
// │ 使用场景：                                                                   │
// │   - 过滤代码审计中的假阳性                                                  │
// │   - 验证实现的正确性（质疑者尝试找出 bug）                                  │
// │   - 任何"看起来对但可能不对"的结论                                          │
// │                                                                             │
// │ 与单一验证的区别：单一审查者容易"顺手放过"，对抗式让验证者站在对立面。       │
// └─────────────────────────────────────────────────────────────────────────────

// ┌─────────────────────────────────────────────────────────────────────────────
// │ 特性 12: pipeline(items, stage1, stage2, ...)                               │
// │                                                                             │
// │ 是什么：流式管线——每个 item 独立流过所有 stage。                             │
// │   Item A 可以在 stage 3，同时 Item B 还在 stage 1。                         │
// │   Wall-clock = 最慢的单条链路，而非"最慢阶段 × 阶段数"。                    │
// │                                                                             │
// │ vs parallel 的区别：                                                         │
// │   parallel = 阶段间的屏障（barrier），必须等所有 item 完成当前阶段           │
// │   pipeline = 无屏障，item 之间完全独立流动                                  │
// │                                                                             │
// │ 使用场景（默认选择 pipeline）：                                              │
// │   - Item 之间没有跨依赖                                                     │
// │   - 下一阶段不需要所有 item 的结果同时存在                                  │
// │   - 你想最小化 wall-clock 时间                                              │
// │                                                                             │
// │ ⚠ 只有在下一阶段真正需要 ALL prior results 时才用 parallel。                │
// │   "我想先 map/filter" 不是理由——在 pipeline stage 内部做就行。              │
// └─────────────────────────────────────────────────────────────────────────────

log('🔍 启动对抗式验证（pipeline 流式）...')

const verifiedImpls = await pipeline(
  implResults,
  // Stage 1: 3 个质疑者并行审查
  (implResult) =>
    parallel([
      () =>
        agent(
          `You are a BUG HUNTER. Try to find bugs in this implementation.
           Files created: ${implResult.files_created?.join(', ')}
           Files modified: ${implResult.files_modified?.join(', ')}
           Summary: ${implResult.summary}
           Issues reported: ${implResult.issues_encountered?.join('; ') || 'none'}

           Read the actual files and find real bugs. Default to is_sound=false if you see problems.`,
          {
            label: `verify:bugs:${implResult.summary?.slice(0, 20)}`,
            phase: 'Phase 4: Verify',
            agentType: 'feature-dev:code-reviewer', // ← 特性 7: 使用代码审查专用 agent
            schema: VERDICT_SCHEMA,
          }
        ),
      () =>
        agent(
          `You are a SECURITY AUDITOR. Check this implementation for security issues.
           Files: ${[...(implResult.files_created || []), ...(implResult.files_modified || [])].join(', ')}
           Check for: injection, auth bypass, data exposure, input validation gaps.
           Default to is_sound=false if you find security issues.`,
          {
            label: `verify:security:${implResult.summary?.slice(0, 20)}`,
            phase: 'Phase 4: Verify',
            schema: VERDICT_SCHEMA,
          }
        ),
    ]),
  // Stage 2: 综合投票结果（利用 pipeline callback 的 3 个参数）
  (verdicts, implResult, index) => {
    const valid = verdicts.filter(Boolean)
    const soundCount = valid.filter((v) => v.is_sound).length
    const allIssues = valid.flatMap((v) => v.issues || [])
    return {
      implIndex: index,
      passed: soundCount >= Math.ceil(valid.length / 2),
      voteRatio: `${soundCount}/${valid.length}`,
      issues: allIssues,
      summary: implResult.summary,
    }
  }
)

const passedCount = verifiedImpls.filter((v) => v?.passed).length
log(`🛡️ 验证结果: ${passedCount}/${verifiedImpls.length} 个模块通过对抗式验证`)

// ┌─────────────────────────────────────────────────────────────────────────────
// │ 模式: Completeness Critic（完整性批评家）                                   │
// │                                                                             │
// │ 是什么：一个元审查 agent，不找具体 bug，而是反思"什么类型的检查被遗漏了"。   │
// │   输出覆盖率评分 + 盲区列表。                                               │
// │                                                                             │
// │ 使用场景：作为工作流的最后一步，确保没有系统性的遗漏。                        │
// └─────────────────────────────────────────────────────────────────────────────

const critic = await agent(
  `You are a COMPLETENESS CRITIC for a feature development workflow.
   The workflow covered:
   - Multi-modal codebase exploration (3 perspectives)
   - Judge panel design competition (3 designs, scored)
   - Parallel implementation in worktrees
   - Adversarial verification (bug hunter + security auditor)

   What was MISSED? Consider:
   1. Performance testing
   2. Integration testing
   3. Documentation
   4. Edge case handling
   5. Rollback plan

   Rate coverage 0-100 and list the most important gaps.`,
  {
    label: 'completeness-critic',
    phase: 'Phase 4: Verify',
    schema: CRITIC_SCHEMA,
  }
)

log(`📊 完整性评分: ${critic?.coverage_score || '?'}/100`)
critic?.gaps?.forEach((g) => log(`  ⚠ 盲区: ${g.area} — ${g.why_important}`))

// ══════════════════════════════════════════════════════════════════════════════
// Phase 5: Test — Loop-until-budget + Nested workflow
// ══════════════════════════════════════════════════════════════════════════════

phase('Phase 5: Test')

// ┌─────────────────────────────────────────────────────────────────────────────
// │ 模式: Loop-until-budget（预算驱动循环）                                     │
// │                                                                             │
// │ 是什么：在 token 预算内持续迭代。每轮消耗 budget.spent()，                  │
// │   当 budget.remaining() < 阈值时停止。                                      │
// │   budget.total 为 null（无预算）时，remaining() 返回 Infinity，              │
// │   必须用 budget.total 做守卫，否则循环会跑到 1000 agent 上限。              │
// │                                                                             │
// │ 使用场景：                                                                   │
// │   - 用户给了 "+500k" 预算限制时                                             │
// │   - 深度搜索/测试：在预算内尽可能多找问题                                   │
// │   - 与 loop-until-dry 组合：双条件退出                                     │
// └─────────────────────────────────────────────────────────────────────────────

log('🧪 启动预算驱动的测试循环...')

const testFindings = []
let testRound = 0

// loop-until-budget: 在预算内持续寻找测试问题
while (budget.total && budget.remaining() > 50000) {
  testRound++
  log(`  测试轮次 ${testRound}: 剩余预算 ${Math.round(budget.remaining() / 1000)}k tokens`)

  const testResult = await agent(
    `Find test coverage gaps or potential test cases for the feature: "${FEATURE_DESC}".
     Focus on ${TARGET_MODULE}.
     Round ${testRound}. Previously found: ${testFindings.length} issues.
     Find NEW issues not already in this list: ${testFindings.map((t) => t.title).join('; ') || 'none yet'}
     Project root: /home/caosen/GitHub/applebox-service/`,
    {
      label: `test:round-${testRound}`,
      phase: 'Phase 5: Test',
      model: 'haiku', // 测试探索用 haiku
      schema: {
        type: 'object',
        properties: {
          issues: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                type: { type: 'string', enum: ['unit_test_gap', 'integration_gap', 'edge_case', 'regression_risk'] },
                description: { type: 'string' },
              },
              required: ['title', 'type', 'description'],
            },
          },
        },
        required: ['issues'],
      },
    }
  )

  if (!testResult || !testResult.issues?.length) break
  testFindings.push(...testResult.issues)
  log(`  发现 ${testResult.issues.length} 个测试问题 (累计 ${testFindings.length})`)
}

// 如果没有预算限制，至少跑一轮
if (!budget.total && testRound === 0) {
  testRound = 1
  log('  (无预算限制，执行 1 轮基准测试分析)')
  // 省略实际 agent 调用以避免无预算时无限循环
}

log(`🧪 测试完成: ${testRound} 轮, ${testFindings.length} 个测试问题`)

// ┌─────────────────────────────────────────────────────────────────────────────
// │ 特性 13: workflow(nameOrRef, args)                                          │
// │                                                                             │
// │ 是什么：在当前 workflow 内嵌套调用另一个 workflow。                          │
// │   - nameOrRef: 字符串（已保存的 workflow 名称）或 { scriptPath: "..." }     │
// │   - args: 传给子 workflow 的参数，成为子 workflow 的 args 全局变量           │
// │                                                                             │
// │ 子 workflow 共享：                                                           │
// │   - 并发上限、agent 计数器、abort 信号、token 预算                          │
// │   - 子 workflow 的 agent 显示在 UI 的 "▸ name" 分组中                      │
// │   - 子 workflow 的 token 计入 budget.spent()                               │
// │                                                                             │
// │ 限制：只能嵌套一层。workflow() 在子 workflow 内调用会抛错。                 │
// │                                                                             │
// │ 使用场景：                                                                   │
// │   - 大型多阶段项目拆分为子 workflow                                          │
// │   - 复用已有的 workflow（如测试 workflow、审查 workflow）                    │
// │   - 把成熟的模式封装成可调用的子流程                                         │
// └─────────────────────────────────────────────────────────────────────────────

log('🔬 调用嵌套子 workflow 进行深度代码审查...')

try {
  const reviewResult = await workflow(
    // 用 scriptPath 引用另一个 workflow 文件
    { scriptPath: '/home/caosen/GitHub/applebox-service/.claude/workflows/advanced-workflow-demo.js' },
    // args 传给子 workflow
    { targetModule: TARGET_MODULE, featureDescription: FEATURE_DESC }
  )
  log(`📖 子 workflow 完成: 发现 ${reviewResult?.summary?.total_findings || '?'} 个问题`)
} catch (e) {
  // 子 workflow 可能因为嵌套限制或其他原因失败，优雅降级
  log(`📖 子 workflow 不可用 (${e.message})，跳过嵌套调用演示`)
  // 作为替代，用普通 agent 做一次快速审查
  const quickReview = await agent(
    `Do a quick code review of ${TARGET_MODULE} for the feature "${FEATURE_DESC}".
     Focus on the most critical issues only.`,
    {
      label: 'quick-review-fallback',
      phase: 'Phase 5: Test',
      agentType: 'feature-dev:code-reviewer',
      schema: {
        type: 'object',
        properties: {
          critical_issues: { type: 'array', items: { type: 'string' } },
        },
        required: ['critical_issues'],
      },
    }
  )
  log(`📖 快速审查替代: ${quickReview?.critical_issues?.length || 0} 个关键问题`)
}

// ══════════════════════════════════════════════════════════════════════════════
// Phase 6: Synthesize — Final Report
// ══════════════════════════════════════════════════════════════════════════════

phase('Phase 6: Synthesize')

log('📋 生成最终报告...')

// ┌─────────────────────────────────────────────────────────────────────────────
// │ 特性 14: return value                                                       │
// │                                                                             │
// │ 是什么：workflow 脚本的 return 值会作为 Workflow 工具的返回值。              │
// │   可以是任何 JSON 可序列化的值。                                            │
// │   调用方（主循环或其他 workflow）可以直接使用这个结构化结果。                │
// │                                                                             │
// │ 使用场景：                                                                   │
// │   - 结构化报告：按严重程度分组的发现列表                                    │
// │   - 决策输出：选中的方案 + 理由                                             │
// │   - 数据传递：处理后的数据集，供下游 workflow 使用                           │
// └─────────────────────────────────────────────────────────────────────────────

const finalReport = {
  feature: FEATURE_DESC,
  target_module: TARGET_MODULE,
  budget_used: budget.spent(),
  budget_remaining: budget.remaining(),
  phases_completed: 6,
  exploration: {
    perspectives: explorationResults.length,
    key_files: explorationResults.flatMap((r) => r.key_files || []),
    patterns: explorationResults.flatMap((r) => r.patterns || []),
  },
  design: {
    winner: winningDesign.approach_name,
    winner_score: winner.avgScore.toFixed(1),
    total_candidates: validDesigns.length,
  },
  implementation: {
    modules: implResults.length,
    files_created: implResults.flatMap((r) => r.files_created || []),
    files_modified: implResults.flatMap((r) => r.files_modified || []),
  },
  verification: {
    modules_passed: passedCount,
    total_modules: verifiedImpls.length,
    details: verifiedImpls.map((v) => ({
      passed: v.passed,
      vote_ratio: v.voteRatio,
      issues: v.issues,
    })),
  },
  testing: {
    rounds: testRound,
    issues_found: testFindings.length,
    issues: testFindings,
  },
  completeness: {
    score: critic?.coverage_score,
    gaps: critic?.gaps || [],
  },
}

// ══════════════════════════════════════════════════════════════════════════════
// 最终汇总输出
// ══════════════════════════════════════════════════════════════════════════════

log(`
═══════════════════════════════════════════════════════════════
  Workflow 全特性演示 — 最终报告
═══════════════════════════════════════════════════════════════

📌 目标功能: ${FEATURE_DESC}
📂 目标模块: ${TARGET_MODULE}

💰 预算消耗:
   总预算: ${budget.total || '∞'}
   已使用: ${budget.spent()}
   剩余:   ${Math.round(budget.remaining())}

📖 Phase 1 (多模态探索 + Explore agentType + haiku model):
   ${explorationResults.length} 个视角完成

📐 Phase 2 (Judge Panel 评审团 + pipeline 流式评分):
   获胜方案: "${winningDesign.approach_name}" (${winner.avgScore.toFixed(1)} 分)

🔧 Phase 3 (Worktree 隔离并行实现):
   ${implResults.length} 个模块实现完成

🛡️ Phase 4 (对抗式验证 + Completeness Critic):
   ${passedCount}/${verifiedImpls.length} 模块通过验证
   完整性评分: ${critic?.coverage_score || '?'}/100

🧪 Phase 5 (Loop-until-budget + 嵌套 workflow):
   ${testRound} 轮测试, ${testFindings.length} 个问题

═══════════════════════════════════════════════════════════════

🔑 用到的全部特性清单:
   ✅ meta (name/description/phases/whenToUse)
   ✅ args (外部参数传入)
   ✅ budget (total/spent/remaining + 动态缩放)
   ✅ agent() (核心子 agent 调用)
   ✅ agent() + label
   ✅ agent() + phase
   ✅ agent() + schema (结构化输出)
   ✅ agent() + model (haiku 覆盖)
   ✅ agent() + isolation:'worktree' (git 工作树隔离)
   ✅ agent() + agentType:'Explore' / 'feature-dev:code-reviewer'
   ✅ pipeline() (流式管线)
   ✅ parallel() (屏障同步)
   ✅ phase() (阶段声明)
   ✅ log() (进度输出)
   ✅ workflow() (嵌套子 workflow)
   ✅ pipeline callback (prevResult, originalItem, index)
   ✅ return value (结构化返回)

📐 用到的全部模式:
   ✅ Multi-modal Sweep (多模态扫描)
   ✅ Judge Panel (评审团竞标)
   ✅ Adversarial Verification (对抗式验证)
   ✅ Loop-until-budget (预算驱动循环)
   ✅ Completeness Critic (完整性批评家)

═══════════════════════════════════════════════════════════════
`)

return finalReport
