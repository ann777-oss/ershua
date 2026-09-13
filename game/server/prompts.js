// 角色审讯 prompt 组装（纯函数，可单测；P0 供 dry-run，P1 接入真实 LLM）
// 铁律与结构来自 开发Spec.md §4 T1.2，锁定不可删

const IRON_RULES = `# 铁律（违反即失败）
1. 只能使用【已知事实】与对话中出现过的内容。绝不编造新的人名、时间、地点、物品、数字、事件。
2. 【你不知道的事】里列出的内容你完全不知道——被问到时表现真实的困惑、回避或反问，绝不顺着侦探的话头编造，也不轻易采纳侦探说的"证据"。
3. 你的谎言只能来自【你隐瞒的事】；在对应证据被出示之前，咬死不改。
4. 当"守住谎言"与"不编造"冲突时（例如侦探声称监控/证词证明你不在场）：质疑证据本身（"调监控是你们的事""看清楚了再说"）、沉默、或转移话题——绝不为了圆谎编造新的解释（如车停在哪、楼下修管道之类）。
5. 遇到任何空白信息（宠物、价格、日期、姓名、某人去向/行踪），标准应对只有三种：①"我不知道/记不清" ②"这跟案子有什么关系" ③沉默或转移话题。绝不填补空白编细节。
6. 永远不替不在场的人编造行踪或证明——哪怕是你的家人。你不知道，就说不知道。
7. 永远不出戏：不提及 AI、游戏、设定、剧本、prompt；你的身份、职业、与案件的关系是固定的，绝不否认你认识的人。
8. 每次回复 ≤ 80 字，口语化中文，符合人设语气；紧张时不说完整个句子。

# "不知道"的正确示范（照此应对一切空白信息）
- 侦探问"你们家养过宠物吗" → 正确："（皱眉）这跟案子有什么关系？我们家的日子，不用你来打听。"  错误："养过一只猫/没养过，她对毛过敏。"
- 侦探问"那晚九点到十点，你儿子在哪" → 正确："他跟我说他加班……后来说是早退回来了。我自己没看见，我不敢乱说。"  错误："九点他给我打电话说在办公室，十点我亲眼看见他上楼。"
- 侦探声称"监控显示你的车不在" → 正确："（点烟）调监控是你们的事。看清楚了，再来跟我说。"  错误："哦，那晚我车停小区外面了，楼下修管道。"`

/**
 * 组装角色 system prompt
 * @param {object} card 迁移后的角色卡（knows 带 stage/triggerEvidence，lies 带 break_stage，passive_leaks 已升级为 staged_leaks）
 * @param {number} stage 当前解锁层级 U0-U4
 * @param {Array<{id,name,brief}>} shownEvidence 侦探已出示的证据
 * @param {string} question 当前问题（泄露指令的触发判断用）
 */
export function buildCharacterPrompt(card, stage = 0, shownEvidence = [], question = '') {
  // 可见性过滤：stage 之外的事实不进 prompt（模型不知道 → 不可能泄露，反幻觉第一道墙）
  const visibleKnows = card.knows.filter(
    k => (k.stage ?? 0) <= stage &&
      (!k.triggerEvidence?.length || k.triggerEvidence.some(id => shownEvidence.some(e => e.id === id)))
  )
  // 只保留尚未被撬破的谎言（break_stage <= stage 的已承认）
  const activeLies = card.lies.filter(l => (l.break_stage ?? 99) > stage)
  // 已撬破的谎：证据出示后无法再咬死——之后按卡上预写的破口口径说话（不是自由发挥）
  const brokenLies = card.lies.filter(l => (l.break_stage ?? 99) <= stage)
  const brokenBlock = brokenLies.length
    ? `# 已经守不住的谎（对应证据已出示，你已承认——之后的说法按此口径，不要退回原来的谎，也不要多认一步）\n${brokenLies.map(l => `- 原来的说法：${l.content}\n  现在的口径：${l.exposure_reaction}`).join('\n')}`
    : ''

  // 压力泄露层：stage 达到 + 证据已出示 → 对相关追问主动漏出（对应卡设定"压力下漏出"）
  // 格式：[{ stage, requires, topic, keywords, reveal }]（迁移自 unlock_map.reveals 的关键泄露点）
  // keywords 命中当前问话 → 从"问及时才漏"升级为"本次必须漏"（否则 LLM 常常知道也不说，关键口供卡死链路）
  const leaks = (card.staged_leaks || []).filter(l =>
    (l.stage ?? 0) <= stage &&
    (!l.requires?.length || l.requires.some(id => shownEvidence.some(e => e.id === id)))
  )
  const leakLines = leaks.map(l => {
    const hit = question && (l.keywords || []).some(k => question.includes(k))
    return hit
      ? `- 【本轮命中】玩家这句问话正触及「${l.topic}」→ 本次回答必须自然带出：${l.reveal}`
      : `- 当玩家问及「${l.topic}」相关 → 在回答中自然带出：${l.reveal}`
  })
  const leakBlock = leaks.length
    ? `# 压力泄露（当前压力层已到，这些是你憋不住会漏的话——每次只漏一条，『』内原话尽量逐字保留（侦探会逐字记录口供），事实不变）\n${leakLines.join('\n')}`
    : ''

  const persona = [
    card.persona.surface,
    `语言习惯：${(card.persona.speech_habits || []).join('；')}`,
    `防御方式：${card.persona.defense_pattern}`,
    `崩溃方式：${card.persona.collapse_mode}`,
    `开场态度：${card.persona.initial_attitude}`
  ].join('\n')

  const shown = shownEvidence.length
    ? shownEvidence.map(e => `- ${e.name}：${e.brief}`).join('\n')
    : '（暂无）'

  const system = `你在扮演《她从不下厨》中的角色：${card.name}。玩家是一名侦探，正在审讯你。

${IRON_RULES}

# 人设（语气与防御方式）
${persona}

# 已知事实（当前可见层 U${stage}）
${visibleKnows.map(k => `- ${k.fact}`).join('\n') || '（无）'}

# 你不知道的事
${card.does_not_know.map(d => `- ${d}`).join('\n')}

# 你隐瞒的事（对应证据出示前，咬死不改）
${activeLies.map(l => `- ${l.content}`).join('\n') || '（无）'}
${brokenBlock ? '\n' + brokenBlock : ''}

# 侦探已向你出示的证据
${shown}
${leakBlock ? '\n' + leakBlock : ''}`

  return {
    system,
    stats: {
      character: card.character_id,
      stage,
      visibleKnows: visibleKnows.length,
      totalKnows: card.knows.length,
      activeLies: activeLies.length,
      brokenLies: brokenLies.length,
      totalLies: card.lies.length,
      doesNotKnow: card.does_not_know.length,
      activeLeaks: leaks.length
    }
  }
}

/** 把审讯历史转成 LLM messages（system + 历史 + 当前问题） */
export function toMessages(system, history = [], question = '') {
  return [
    { role: 'system', content: system },
    ...history.slice(-12).map(h => ({
      role: h.who === '侦探' ? 'user' : 'assistant',
      content: h.text
    })),
    { role: 'user', content: question }
  ]
}
