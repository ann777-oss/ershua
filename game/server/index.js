import express from 'express'
import cors from 'cors'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCharacterPrompt, toMessages } from './prompts.js'
import { nextStage, confrontReady } from './statemachine.js'
import { chat, chatStream, llmAvailable, LLMUnavailable } from './llm.js'
import { fallbackAsk, fallbackShow, fallbackSuggestions } from './fallback.js'
import { loadSlot, slotExists, listCustomSlots } from './slots.js'
import { fetchOfficialList, draftFromWorkId, validateDraft, persistSlot } from './pipeline.js'
import { authRouter } from './auth.js'
import { myCasesHandler } from './userdata.js'

const app = express()
app.set('trust proxy', true)
app.use(cors())
app.use(express.json({ limit: '2mb' }))
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 槽位解析：body.slotId / query.slot，默认 main；不存在 → 400（不静默回退，避免串档）
function slotOf(req) {
  const slotId = req.body?.slotId || req.query.slot || 'main'
  if (!slotExists(slotId)) return null
  return loadSlot(slotId)
}
const needSlot = (req, res) => {
  const slot = slotOf(req)
  if (!slot) { res.status(400).json({ error: `未知故事槽位：${req.body?.slotId || req.query.slot}` }); return null }
  return slot
}

app.get('/api/health', (_req, res) => res.json({ ok: true, llm: llmAvailable() }))

// ---- 故事库（官方列表代理：真实状态透传，不循环重试） ----
app.get('/api/stories', async (_req, res) => {
  try {
    const stories = await fetchOfficialList()
    res.json({ stories })
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message })
  }
})

// 已生成的本地槽位（S0 据此区分「直接进入」与「送去流水线」）
app.get('/api/slots', (_req, res) => res.json({ slots: listCustomSlots() }))

// ---- 知乎 OAuth 登录 + 我的案源（P6；未配置凭证时 /status 返回 configured:false，前端隐藏入口） ----
app.use('/api/auth', authRouter)
app.get('/api/me/cases', myCasesHandler)

// ---- 启动数据：故事、人物公开档案、起手证据、槽位元信息（作者归属） ----
app.get('/api/game', (req, res) => {
  const slot = needSlot(req, res)
  if (!slot) return
  try {
    const { story, registry, cards, order, meta } = slot
    const characters = order.map(id => {
      const c = cards[id]
      return {
        id: c.character_id,
        name: c.public_profile.name,
        relation: c.public_profile.relation,
        blurb: c.public_profile.blurb,
        opening: c.public_profile.opening,
        confrontRule: c.confront_rule || null  // 客户端对峙资格镜像（与服务端同规则）
      }
    })
    const startingEvidence = registry.starting_evidence
      .map(id => registry.evidences.find(e => e.id === id))
      .filter(Boolean)
      .map(e => ({ id: e.id, name: e.name, type: e.type, source: e.source, brief: e.brief, paraIds: e.paraIds || [] }))
    res.json({
      slotId: slot.slotId,
      story: { title: story.title, summary: story.summary, paras: story.paras },
      characters,
      startingEvidence,
      darklineTotal: Object.keys(registry.dark_lines).length,
      meta: { author_name: meta.author_name || '', source_label: meta.source_label || '', code: meta.code || '', adaptation: meta.adaptation || 'AI 生成的侦探化改编' }
    })
  } catch (err) {
    console.error('[game]', err)
    res.status(500).json({ error: '案卷数据损坏' })
  }
})

// ---- P4 叙事流水线 ----
// 草稿：workId → 两步 LLM 生成 + 校验修复（不落盘；人工审阅后才 confirm）
app.post('/api/pipeline/draft', async (req, res) => {
  const { workId } = req.body || {}
  if (!workId) return res.status(400).json({ error: '缺少 workId' })
  if (!llmAvailable()) return res.status(503).json({ error: 'LLM 不可用，流水线无法运行' })
  try {
    const draft = await draftFromWorkId(workId)
    res.json({ draft })
  } catch (err) {
    console.error('[pipeline/draft]', err.message)
    res.status(err.status || 500).json({ error: err.message })
  }
})

// 确认落盘：校验（审阅页可能手改过）→ shared/custom/{slotId}/
app.post('/api/pipeline/confirm', (req, res) => {
  const { slotId, draft } = req.body || {}
  if (!slotId || !/^[A-Za-z0-9_-]{1,64}$/.test(slotId)) return res.status(400).json({ error: '非法 slotId' })
  const check = validateDraft(draft)
  if (!check.ok) return res.status(400).json({ error: '校验未通过', errors: check.errors })
  try {
    persistSlot(slotId, draft)
    res.json({ ok: true, slotId, warnings: check.warnings })
  } catch (err) {
    console.error('[pipeline/confirm]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ---- 盘问（SSE 流式；spec §2.2） ----
app.post('/api/interrogate', async (req, res) => {
  const slot = needSlot(req, res)
  if (!slot) return
  const { characterId, question = '', showEvidenceId, history = [], shownEvidence = [], stage = 0 } = req.body || {}
  const card = slot.cards[characterId]
  if (!card) return res.status(400).json({ error: `未知角色：${characterId}` })
  const REGISTRY = slot.registry

  // 出示证据：先推进状态机，LLM 在新状态内反应（谎言已移除/新事实已可见）
  let newStage = stage
  let shown = shownEvidence
  let effectiveQuestion = String(question || '')
  let showing = false
  if (showEvidenceId) {
    // 注册证据：查表；钉卡（pin_*）：用客户端卡面 + 内容解析到注册台词 id（驱动跨角色解锁）
    const regEv = REGISTRY.evidences.find(e => e.id === showEvidenceId)
    const clientCard = req.body.showCard || {}
    const evName = regEv?.name || clientCard.name || '一样东西'
    const evBrief = regEv?.brief || clientCard.content || ''
    let stageId = showEvidenceId
    if (!regEv) {
      const tId = matchTestimonyId(slot, clientCard.content || '')
      if (tId) stageId = tId  // 钉卡内容命中注册台词 → 按注册 id 计入解锁状态机
    }
    newStage = nextStage(card, stage, [...shownEvidence.map(e => e.id), stageId])
    shown = [...shownEvidence, { id: stageId, name: evName, brief: evBrief }]
    effectiveQuestion = `〔侦探把一样东西推到桌上：${evName}〕${evBrief}\n（侦探）你有什么要说的？`
    showing = true
  }
  if (!showing && !effectiveQuestion.trim()) {
    return res.status(400).json({ error: 'question 与 showEvidenceId 至少提供其一' })
  }

  // 关键口供保底：关键词命中的泄露必须真的说出来（玩家要逐字钉选）——
  // 纯 prompt 指令在 temperature 下有漏说概率，暗线链路会因此卡死，故加确定性执行层
  const hitLeak = (card.staged_leaks || []).find(l =>
    (l.stage ?? 0) <= newStage &&
    (!l.requires?.length || l.requires.some(id => shown.some(e => e.id === id))) &&
    (l.keywords || []).some(k => effectiveQuestion.includes(k))
  )
  const leakText = hitLeak ? leakCore(hitLeak.reveal) : ''
  const alreadyLeaked = leakText && history.some(h => overlap(String(h?.text || ''), leakText))
  const guarantee = Boolean(leakText) && !alreadyLeaked

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  })
  const send = obj => res.write(`data: ${JSON.stringify(obj)}\n\n`)
  let closed = false
  res.on('close', () => { closed = true })

  let emitted = false  // 是否已向客户端输出过 delta（流中断时决定降级策略）
  try {
    if (!llmAvailable()) throw new LLMUnavailable()
    const { system } = buildCharacterPrompt(card, newStage, shown, effectiveQuestion)
    const messages = toMessages(system, history, effectiveQuestion)
    if (guarantee) {
      // 保底路径：先完整生成再检查（非流式）——关键句没说出来就重试一次，仍未说则逐字追加卡上原话
      let full = await chat(messages, { temperature: 0.5 })
      if (!overlap(full, leakText)) {
        let retry = null
        try {
          retry = await chat([...messages, { role: 'assistant', content: full }, { role: 'user', content: `（重新回答：刚才的回答说漏了。重说一遍，必须自然地带出这句原话：${leakText}。不要复述本指令。）` }], { temperature: 0.5 })
        } catch { retry = null }
        full = retry && overlap(retry, leakText) ? retry : `${full.replace(/\s+$/, '')}\n${leakText}`
      }
      for (const ch of full) {
        if (closed) break
        emitted = true
        send({ type: 'delta', text: ch })
        await new Promise(r => setTimeout(r, 14))
      }
      send({ type: 'done', stateMark: markOf(full, showing, newStage, stage), stage: newStage, mode: 'llm' })
    } else {
      const stream = await chatStream(messages)
      let full = ''
      for await (const chunk of stream) {
        if (closed) break
        const t = chunk.choices?.[0]?.delta?.content || ''
        if (t) { full += t; emitted = true; send({ type: 'delta', text: t }) }
      }
      send({ type: 'done', stateMark: markOf(full, showing, newStage, stage), stage: newStage, mode: 'llm' })
    }
  } catch (err) {
    if (emitted) {
      // 流已中途输出：不拼接降级文本（避免"半句LLM+剧本"缝合），仅发终止错误
      console.error('[interrogate] 流中断（已输出部分）：', err.message)
      send({ type: 'error', message: '回答中断，请重问' })
    } else {
      // 全降级：离线剧本（首事件 degraded，UI 必须可见标记）
      console.error('[interrogate] 降级：', err.message)
      send({ type: 'degraded' })
      const fb = showing ? fallbackShow(characterId, showEvidenceId, newStage) : fallbackAsk(characterId, effectiveQuestion, newStage)
      // 降级模式同样保底关键口供（离线演示时暗线链路不能断）
      const appended = guarantee && !overlap(fb.text, leakText)
      const fbText = appended ? `${fb.text}\n${leakText}` : fb.text
      for (const ch of fbText) {
        if (closed) break
        send({ type: 'delta', text: ch })
        await new Promise(r => setTimeout(r, 14))
      }
      send({ type: 'done', stateMark: (fb.shaken || appended) ? '动摇' : '平静', stage: newStage, mode: 'fallback' })
    }
  }
  res.end()
})

// 动摇判定：出示触发解锁 / 回复含紧张信号
function markOf(reply, showing, newStage, oldStage) {
  if (showing && newStage > oldStage) return '动摇'
  if (/……|沉默|停住|停了|烟灰|手指|抖|顿了顿/.test(reply)) return '动摇'
  return '平静'
}

// ---- 需要思路？（仅玩家点击时调用；spec T1.5，UX5 改造：侦探导师式文字引导，不直接给问题） ----
app.post('/api/suggest', async (req, res) => {
  const slot = needSlot(req, res)
  if (!slot) return
  const { characterId, recentHistory = [], boardEvidence = [] } = req.body || {}
  const card = slot.cards[characterId]
  if (!card) return res.status(400).json({ error: `未知角色：${characterId}` })
  // 原文锚点素材：注册证据的锚定原句——只给原句（原文玩家都能翻到），
  // 不给证据卡名/second_read：玩家还没登记的证据不该被导师点名（CodeRabbit：防未获得证据泄露）
  const anchors = slot.registry.evidences.map(e => e.text_anchor).join('\n')
  try {
    if (!llmAvailable()) throw new LLMUnavailable()
    const system = `你在为一款审讯推理游戏扮演"侦探导师"（带新人的老刑警）。侦探正在审讯《${slot.story.title}》中的${card.name}（${card.public_profile.relation}），卡住了，点开「需要思路」求助。

写一段引导文字（100-160字），帮他打开思路。要求：
1. 基于审讯记录，点出当前的僵局或值得再敲一敲的口子（他哪句话留了尾巴、哪里答得太顺）——这是引导的支点；
2. 给思考方向，但不直接给出该问的问题——授人以渔，让他自己组织提问；
3. 可以引用一句案卷原文（素材里有）作为线索提示，说"案卷里有这么一句，值得再读读"式的提示——但绝不提证据卡的名字，也绝不暗示"存在某张证据卡"；侦探还没发现的东西，只能让他自己去翻原文；
4. 口吻：老刑警带新人——克制、白描、点到为止，可以有一句经验之谈；
5. 绝不剧透暗线真相，绝不替他下结论。
只输出 JSON：{"guidance":"..."}`
    const content = await chat([
      { role: 'system', content: system },
      { role: 'user', content: `【审讯记录（最近8轮）】\n${JSON.stringify(recentHistory.slice(-8))}\n\n【侦探证据板上已有的证据】\n${boardEvidence.length ? boardEvidence.join('；') : '（空）'}\n\n【案卷原文锚点素材（可引用）】\n${anchors}` }
    ], { json: true, temperature: 0.8 })
    const parsed = JSON.parse(content)
    if (typeof parsed.guidance !== 'string' || parsed.guidance.trim().length < 20) throw new Error('引导解析为空')
    res.json({ guidance: parsed.guidance.trim() })
  } catch (err) {
    console.error('[suggest] 降级：', err.message)
    res.json({ guidance: fallbackSuggestions(characterId), degraded: true })
  }
})

// ---- 原文划选判定（spec §5 T2.2：锚点命中 fast-path / LLM 判定兜底） ----
app.post('/api/judge/quote', async (req, res) => {
  const slot = needSlot(req, res)
  if (!slot) return
  const { characterId, paraId, selectedText = '' } = req.body || {}
  const card = slot.cards[characterId]
  if (!card) return res.status(400).json({ error: `未知角色：${characterId}` })

  // fast-path：段落命中任一注册证据锚点 → 直接发证（确定性，零延迟）
  const hit = slot.registry.evidences.find(e => e.paraIds?.includes(paraId))
  if (hit) {
    return res.json({
      relevant: true,
      evidenceId: hit.id,
      evidence: { id: hit.id, name: hit.name, type: hit.type, source: hit.source, brief: hit.brief, paraIds: hit.paraIds },
      darkLine: hit.dark_line,
      reaction: null  // 系统发证，无需角色反应
    })
  }

  // LLM 判定：非锚点段落是否与当前审讯相关
  const para = slot.story.paras.find(p => p.id === paraId)
  if (!para) return res.status(400).json({ error: `未知段落：${paraId}` })

  try {
    if (!llmAvailable()) throw new LLMUnavailable()
    const system = `你在为一款审讯推理游戏做判定。玩家从故事原文中划选了一句话，试图作为证据。判断它是否构成"可登记的物证"。
背景：玩家正在审讯《${slot.story.title}》中的${card.name}（${card.public_profile.relation}）。
【严格标准】"relevant=true" 仅当这句话是一个**可独立成立的实物证据**（收据、药片、钥匙、截图、遗嘱类的具体物件/文件/记录）。
单纯的角色台词、情绪描写、人物行为、场景氛围——哪怕信息量大（如某人说自己做了饭、某人包了饺子）——一律 relevant=false。
宁可 false 不可 true：只有物证才能过审。
只输出 JSON：{"relevant":true/false,"reaction":"..."}
- reaction 是该角色对"这句话被打出来"的回应台词（≤40字，符合人设，可淡然/回避/反问）
- relevant=true 时 reaction 应带紧张感（但角色不承认任何事）
- 绝不编造原文没有的事实。`
    const content = await chat([
      { role: 'system', content: system },
      { role: 'user', content: `【段落 ${paraId}】${para.text}\n【玩家划选】${selectedText}` }
    ], { json: true, temperature: 0.3 })
    const j = JSON.parse(content)
    // 非锚点段落即使 LLM 判 relevant，也只给反应不给证据（锚点证据只能来自注册表——反幻觉红线）
    res.json({ relevant: false, evidenceId: null, darkLine: null, reaction: j.reaction || '（他看了一眼，没什么反应。）' })
  } catch (err) {
    // 降级：不判伪也不发证，保守放行为"无关"
    res.json({ relevant: false, evidenceId: null, darkLine: null, reaction: '（他看了一眼，没什么反应。）', degraded: true })
  }
})

// ---- 两卡关联判定（spec §5 T2.3：预注册对 fast-path / LLM 判定兜底） ----
app.post('/api/judge/relation', async (req, res) => {
  const slot = needSlot(req, res)
  if (!slot) return
  const { cards = [], chains = [] } = req.body || {}
  if (!Array.isArray(cards) || cards.length < 2) return res.status(400).json({ error: '需要至少两张卡' })
  const [a, b] = cards

  // fast-path ①：预注册对（contradiction_pairs）按 id 命中
  const normId = c => c.id || ''
  const pair = slot.registry.contradiction_pairs.find(p =>
    (normId(a) === p.a && normId(b) === p.b) || (normId(a) === p.b && normId(b) === p.a)
  )
  if (pair) {
    return res.json({ verdict: pair.verdict, darkLine: pairDarkLine(slot, pair), note: pair.comment, mode: 'registry' })
  }

  // fast-path ②：钉出的口供卡（pin_*）按台词内容匹配预注册对——
  // 台词型 id 在角色卡 testimony_yield 中有原文，钉卡 content 即该台词
  const pairByContent = slot.registry.contradiction_pairs.find(p => {
    const texts = [a.content || '', b.content || '']
    const needA = testimonyText(slot, p.a), needB = testimonyText(slot, p.b)
    if (!needA && !needB) return false
    // 任一侧台词被钉卡内容包含（LLM 台词允许少量措辞差，取核心片段匹配）
    const hitA = needA && texts.some(t => overlap(t, needA))
    const hitB = needB && texts.some(t => overlap(t, needB))
    return (needA && needB) ? (hitA && hitB) : (hitA || hitB)
  })
  if (pairByContent) {
    return res.json({ verdict: pairByContent.verdict, darkLine: pairDarkLine(slot, pairByContent), note: pairByContent.comment, mode: 'registry' })
  }

  // LLM 兜底：任意两卡（含钉出的口供卡）——背景与暗线定义按槽位注入
  try {
    if (!llmAvailable()) throw new LLMUnavailable()
    const dlDefs = Object.entries(slot.registry.dark_lines).map(([k, v]) => `${k}=${v}`).join('；')
    const system = `你在为一款审讯推理游戏做证据关联判定。玩家在证据板上选了两张卡片，判断它们之间是否存在关联。
背景故事：《${slot.story.title}》——${slot.story.summary}
暗线定义：${dlDefs}
只输出 JSON：{"verdict":"矛盾"|"印证"|"无关","darkLine":"${Object.keys(slot.registry.dark_lines).join('"|"')}|null,"note":"一句话说明（≤40字）"}
判定标准：
- 矛盾：两张卡指向相反的事实（如口供与物证冲突）
- 印证：两张卡互相支持同一推断
- 无关：无实质关联
警告：宁可"无关"不可硬造关联。darkLine 仅在明确指向某条暗线时给出。`
    const content = await chat([
      { role: 'system', content: system },
      { role: 'user', content: `【卡片A】${a.tag || ''}｜${a.name}｜${a.content || a.brief || ''}\n【卡片B】${b.tag || ''}｜${b.name}｜${b.content || b.brief || ''}\n【已成立的关联链（避免重复判定）】${chains.map(c => `${c.a}×${c.b}=${c.verdict}`).join('；') || '无'}` }
    ], { json: true, temperature: 0.3 })
    const j = JSON.parse(content)
    const verdict = ['矛盾', '印证', '无关'].includes(j.verdict) ? j.verdict : '无关'
    const dlKeys = Object.keys(slot.registry.dark_lines)
    res.json({ verdict, darkLine: dlKeys.includes(j.darkLine) ? j.darkLine : null, note: j.note || '', mode: 'llm' })
  } catch (err) {
    // 降级：无 LLM 时未注册对一律判无关（宁可放过不可冤枉）
    res.json({ verdict: '无关', darkLine: null, note: '（无法判定关联）', mode: 'fallback' })
  }
})

// 台词型 id（t{缩写}_）→ 角色卡 testimony_yield 中的台词原文
function testimonyText(slot, id) {
  if (!/^t[a-z]+_/.test(id)) return null
  for (const card of Object.values(slot.cards)) {
    const t = (card.testimony_yield || []).find(t => t.id === id)
    if (t) return t.content
  }
  return null
}

// 钉卡内容 → 注册台词 id（跨角色出示的解锁解析；复用 overlap 的 6 字滑窗容差）
function matchTestimonyId(slot, content) {
  if (!content) return null
  for (const card of Object.values(slot.cards)) {
    for (const t of card.testimony_yield || []) {
      if (overlap(content, t.content)) return t.id
    }
  }
  return null
}

// 台词匹配：LLM 生成台词与注册台词允许措辞差——
// 取注册台词中连续 6 字窗口，任一窗口被钉卡内容包含即视为同一句话
function overlap(pinText, registryText) {
  if (!pinText || !registryText) return false
  const clean = s => s.replace(/[「」『』"“”\s，。？！…]/g, '')
  const p = clean(pinText), r = clean(registryText)
  if (p.length < 6 || r.length < 6) return p.includes(r) || r.includes(p)
  for (let i = 0; i + 6 <= r.length; i++) {
    if (p.includes(r.slice(i, i + 6))) return true
  }
  return false
}

// 泄露台词的核心句：『』引号内、去掉括号里的导演注记——保底检查与逐字追加都用它
function leakCore(reveal) {
  const m = String(reveal || '').match(/『([^』]+)』/)
  return (m ? m[1] : String(reveal || '')).replace(/（[^）]*）/g, '').trim()
}

// 预注册对的暗线归属：pair 显式 darkLine → 证据注册表反查 → 台词 id 前缀映射角色主暗线（main 兼容）
function pairDarkLine(slot, pair) {
  if (pair.darkLine && slot.registry.dark_lines[pair.darkLine]) return pair.darkLine
  const ev = slot.registry.evidences.find(e => e.id === pair.a || e.id === pair.b)
  if (ev) return ev.dark_line
  // 台词型对：按 testimony id 归属到该角色的主暗线（confront_rule.chain）
  const byTestimony = tid => {
    for (const card of Object.values(slot.cards)) {
      if ((card.testimony_yield || []).some(t => t.id === tid)) {
        return card.confront_rule?.type === 'chain' ? card.confront_rule.darkLine : null
      }
    }
    return null
  }
  return byTestimony(pair.a) || byTestimony(pair.b) || null
}

// ---- 对峙资格查询（客户端状态机用，纯计算无副作用） ----
app.post('/api/confront/check', (req, res) => {
  const slot = needSlot(req, res)
  if (!slot) return
  const { characterId, chains = [], stage = 0 } = req.body || {}
  const card = slot.cards[characterId]
  if (!card) return res.status(400).json({ error: `未知角色：${characterId}` })
  res.json({ ready: confrontReady(card, chains, stage) })
})

// ---- 对峙演出（P3 T3.1）：beats 与角色卡 100% 一致，刻意不用 LLM（防幻觉红线优先） ----
// 冤枉机制（T3.4）：资格不足时返回短拒绝台词 + wrongAccuse（由客户端计数）
app.post('/api/confront', (req, res) => {
  const slot = needSlot(req, res)
  if (!slot) return
  const { characterId, chains = [], stage = 0 } = req.body || {}
  const card = slot.cards[characterId]
  if (!card) return res.status(400).json({ error: `未知角色：${characterId}` })
  const mainDL = card.confront_rule?.darkLine || null
  if (!confrontReady(card, chains, stage)) {
    const reject = card.confrontation_script?.reject_line ||
      `（${card.public_profile.name}看着你，收起了刚才的神色）就这？`
    return res.json({ ok: false, reject })
  }
  const script = card.confrontation_script || card.u2_confession_script || card.u3_confession_script
  if (!script?.beats?.length) return res.status(500).json({ error: `${characterId} 角色卡缺少对峙剧本` })
  res.json({
    ok: true,
    beats: script.beats,            // verbatim——展示层保证零改写
    hardRules: script.hard_rules || [],
    trigger: script.trigger,
    darkLine: mainDL || Object.keys(slot.registry.dark_lines)[0]
  })
})

// ---- 结算（P3 T3.2）：暗线全文 + 原文坐标回放数据 + LLM 结案评语（只许复述日志事实） ----
app.post('/api/settle', async (req, res) => {
  const slot = needSlot(req, res)
  if (!slot) return
  const { stats = {}, unlockedDLs = [] } = req.body || {}
  const story = slot.story
  const REGISTRY = slot.registry
  const darkLines = unlockedDLs
    .filter(id => REGISTRY.dark_lines[id])
    .map(id => ({
      id,
      text: REGISTRY.dark_lines[id],
      evidences: REGISTRY.evidences
        .filter(e => e.dark_line === id)
        .map(e => ({
          id: e.id, name: e.name, brief: e.brief,
          paras: (e.paraIds || [])
            .map(pid => story.paras.find(p => p.id === pid))
            .filter(Boolean)
            .map(p => ({ id: p.id, text: p.text }))
        }))
    }))
  const dlTotal = Object.keys(REGISTRY.dark_lines).length
  const facts = `提问${stats.questions ?? 0}次；出示证据${stats.shown ?? 0}项；钉口供${stats.pins ?? 0}张；矛盾链${stats.contradictions ?? 0}条；印证${stats.confirms ?? 0}条；冤枉好人${stats.wrongAccuse ?? 0}次；使用提示${(stats.hints ?? 0) + (stats.usedHint && !stats.hints ? 1 : 0)}次；解锁暗线：${unlockedDLs.length ? unlockedDLs.join('、') : '无'}（共${dlTotal}条）`
  let comment, degraded = false
  try {
    if (!llmAvailable()) throw new LLMUnavailable()
    const theme = slot.meta.theme_hint ? `最后一句点题本故事的暗线核心（${slot.meta.theme_hint}），不替作者下有罪无罪的结论。` : '最后一句点题暗线核心，不替作者下有罪无罪的结论。'
    const system = `你在为一款审讯推理游戏《${story.title}》生成"侦探档案"结案评语，不超过100字。
铁律：只允许复述日志中出现过的数字与事件，禁止编造日志之外的任何数字、证据名或情节。日志里没有的，一个字都不能加。
口吻：老刑警的档案批注——克制、准确、白描；${theme}`
    const content = await chat([
      { role: 'system', content: system },
      { role: 'user', content: `侦探行为日志：${facts}` }
    ], { temperature: 0.5 })
    comment = content.trim()
  } catch {
    degraded = true
    comment = `结案批注：提问${stats.questions ?? 0}次，出示证据${stats.shown ?? 0}项，成立矛盾${stats.contradictions ?? 0}条；暗线${unlockedDLs.length}/${dlTotal}。` +
      (unlockedDLs.length === dlTotal ? '所有暗线都见了光。' : '还有真相埋在纸里。')
  }
  res.json({ comment, darkLines, facts, degraded })
})

// ---- 生产模式：托管 vite 构建产物（dist）+ SPA fallback（API 路由优先注册，不受影响） ----
const dist = path.resolve(__dirname, '../dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next()
    res.sendFile(path.join(dist, 'index.html'))
  })
}

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`[server] http://localhost:${PORT}  llm=${llmAvailable() ? 'on' : 'off(降级模式)'}  static=${fs.existsSync(dist) ? 'dist' : 'off(开发模式)'}`))
