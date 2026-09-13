// P4 叙事流水线：官方故事 API → 段落切分 → ① 暗线表草稿 → ② 角色卡草稿 → 校验/修复 → 落盘
// 人工确认在审阅页完成（/api/pipeline/confirm 只做校验+写文件）；「AI 生成 + 人类把关」是产品叙事的一部分
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chat } from './llm.js'
import { slotDir, reloadSlot } from './slots.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CUSTOM_ROOT = path.resolve(__dirname, '../shared/custom')

const OFFICIAL_BASE = 'https://api.zhihu.com/km-indep-home/hackathon/v2/story'
// work_id 白名单：列表接口返回的非空单行标识（官方文档要求拒绝 /?# 与换行）
const WORK_ID_RE = /^[A-Za-z0-9]{1,64}$/

// ---------- 官方故事 API ----------

export async function fetchOfficialList() {
  const res = await fetch(`${OFFICIAL_BASE}/list`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) { const err = new Error(`知乎故事接口 HTTP ${res.status}`); err.status = res.status; throw err }
  return res.json()
}

export async function fetchOfficialStory(workId) {
  if (!WORK_ID_RE.test(String(workId || ''))) throw new Error(`非法 work_id：${workId}`)
  const res = await fetch(`${OFFICIAL_BASE}/${encodeURIComponent(workId)}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) { const err = new Error(`知乎故事接口 HTTP ${res.status}`); err.status = res.status; throw err }
  const d = await res.json()
  if (!d?.content) throw new Error('故事详情缺少 content 字段')
  return d
}

// ---------- 段落切分与档位 ----------

/** 正文 → 带段落 id 的数组（换行切分；过滤空行与纯章节号行）。
 *  官方 API 仅提供 ~3000 字节选：结尾断在半句时裁到最后一个完整句，并标记 excerpt（如实呈现节选，不补写正文） */
export function splitParas(content) {
  const lines = String(content).split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  const paras = []
  for (const text of lines) {
    // 纯数字/一二三章式小节标记不成段
    if (/^[\d\s]{1,3}$/.test(text) || /^[（(]?[一二三四五六七八九十]{1,3}[)）、.．]?$/.test(text)) continue
    paras.push({ id: `p${String(paras.length + 1).padStart(2, '0')}`, text })
  }
  let excerpt = false
  const last = paras[paras.length - 1]
  if (last && !/[。！？…」』】”]$/u.test(last.text)) {
    const m = last.text.match(/^[\s\S]*[。！？…」』】”]/u)
    if (m && m[0].trim().length >= 8) last.text = m[0].trim()
    else paras.pop()
    excerpt = true
  }
  return { paras, excerpt }
}

/** 适配档位：核心悬疑标签（悬疑/推理/烧脑/犯罪）→ 深度；其余（言情/仙侠等反转文）→ 轻量 */
export function tierOf(labels = []) {
  return labels.some(l => /悬疑|推理|烧脑|犯罪|刑侦/.test(l)) ? 'deep' : 'light'
}

const parasBlock = paras => paras.map(p => `${p.id}: ${p.text}`).join('\n')

// ---------- 第一步：暗线表草稿 ----------

function step1Prompt({ title, labels, tier, paras }) {
  const tierText = tier === 'deep'
    ? '深度档：1-2 条暗线、≥5 个证据、后续将设计 2 个可审讯角色'
    : '轻量档：1 条暗线、≥3 个证据、后续将设计 1-2 个可审讯角色'
  return [
    { role: 'system', content: `你是悬疑审讯游戏《二刷》的叙事设计师。任务：把一篇知乎盐言故事「侦探化」——找出作者埋在原文里、一刷读不出来的暗线，并登记可作为证据的原文细节。

# 铁律
1. 暗线（dark_lines）= 原文有伏笔但没有明说的隐藏真相（「二刷才能看懂」的那层），不是复述剧情。
2. 每个证据必须锚定原文段落：paraIds 给出真实存在的段落 id，锚定段落必须真的包含该细节；给不出段落 id 的证据直接不要。
3. 证据 type ∈ 物证/口供/结构信息，优先实物/记录/文档类物证；text_anchor 摘录原句。
4. second_read = 二刷解读（这个细节在暗线视角下意味着什么）；brief = 一句话证据卡描述（≤30 字）。
5. 证据之间必须存在咬合：至少 1 对「矛盾」或「印证」（contradiction_pairs，只登记证据 id 之间的对，verdict ∈ 矛盾/印证）。
6. starting_evidence：挑 2 张最适合开局展示的证据 id。
7. summary：80-150 字案卷速读摘要（给侦探看，不剧透暗线）。
8. theme_hint：一句话点题暗线核心（≤20 字，如「她从不下厨——宠爱即囚禁」风格）。

只输出 JSON：
{"summary":"...","theme_hint":"...","dark_lines":{"DL1":"暗线名——一句话真相"},"starting_evidence":["ev_a","ev_b"],"evidences":[{"id":"ev_语义","name":"...","type":"物证","source":"原文段落","text_anchor":"原句摘录","paraIds":["p01"],"dark_line":"DL1","second_read":"...","brief":"..."}],"contradiction_pairs":[{"a":"ev_a","b":"ev_b","verdict":"矛盾","darkLine":"DL1","comment":"≤40字说明"}]}` },
    { role: 'user', content: `【标题】${title}\n【标签】${labels.join('/') || '无'}\n【档位】${tierText}\n\n【原文段落】\n${parasBlock(paras)}` }
  ]
}

// ---------- 第二步：角色卡草稿 ----------

function step2Prompt({ title, labels, tier, paras, registry }) {
  const countText = tier === 'deep' ? '2 个角色' : '1-2 个角色'
  return [
    { role: 'system', content: `你是审讯游戏《二刷》的角色卡架构师。基于暗线表与原文，设计可审讯的角色卡（玩家=侦探，通过盘问与出示证据撬开角色的谎）。

# 角色设计铁律
1. 角色只能来自原文中出现（或被明确提及）的人物，共 ${countText}；每个角色都是「守谎者」——有必须守住的事，也有真的不知道的事。原文中给出姓名的用原文姓名；没有姓名的人物一律用身份称呼（如「培训师」「灰夹克男人」），绝不发明原文没有的姓名。
2. knows[].stage 知识分层：0=开局即可说出；1/2/3=对应证据出示解锁后才可说（fact 只能来自原文与暗线设定）。
3. does_not_know = 反幻觉之墙：原文没写的细节（金额/日期/宠物/人名/行踪/物品去向…）全部列入，被问到时只能困惑、回避或反问，绝不编造。
4. lies[]：他说的谎 + break_stage（第几层证据后破，1-3）+ exposure_reaction（破谎后按此口径说话，不是自由发挥）。
5. staged_leaks[] 关键口供泄露点：{id, stage, requires:[证据id], topic, keywords:[触发词], reveal}——reveal 中『』内的原话是该角色的关键口供，玩家问到 keywords 相关话题时必须自然带出；这句原话必须同时登记进 testimony_yield。
6. unlock_triggers：{"1":{"any":["ev_x"]},"2":{"any":[...]}}——证据 id 必须真实存在（暗线表 evidences 的 ev_*，或另一角色的 testimony id）。
7. testimony_yield[]：{id:"t{角色拼音缩写}_{语义}", content:"『原话』", how:"何时给出"}——与 staged_leaks 的『』句一字不差；跨角色口供（可出示给其他角色触发解锁）尤其要登记。
8. confront_rule：{"type":"chain","darkLine":"DL1"}=主暗线守门人（该暗线矛盾链成立才可对峙）；{"type":"stage","minStage":3,"darkLine":"DL1"}=崩溃自白型（stage 达到即对峙）。两种类型都必须给出 darkLine（该角色守的暗线）。
9. confrontation_script：{trigger:"触发条件一句话", beats:[8-12 拍终局台词], hard_rules:[2-4 条], reject_line:"资格不足时的短拒绝台词（≤40字）"}。beats 是逐字演出的自白（一拍一句，可含（舞台指示）），必须揭示他所守的暗线真相，结尾保留道德灰区——不下非黑即白的定论，不替作者回答「是不是他干的」。
10. persona 决定「人感」：surface / speech_habits[] / defense_pattern（三层递进）/ collapse_mode / initial_attitude。
11. public_profile：name（原文姓名，两字姓名中间加全角空格如「方　诺」；无名人物用身份称呼如「培训师」）/ relation（身份·年龄）/ blurb（一句话外在印象）/ opening（开场白 ≤40 字，含一个可推进的口子）。
12. public_story：角色开局自述（≤120 字，包含他主动要说的话——表层版本，含至少一个会在证据面前破掉的谎）。

只输出 JSON：
{"characters":[{"character_id":"拼音","name":"姓名","confront_rule":{...},"persona":{...},"public_story":"...","public_profile":{...},"knows":[{"fact":"...","stage":0}],"does_not_know":["..."],"lies":[{"id":"lie_语义","content":"他说的原话谎","contradicted_by":["ev_x"],"exposure_reaction":"破谎后口径","break_stage":1}],"staged_leaks":[{"id":"t{缩写}_语义","stage":2,"requires":["ev_x"],"topic":"话题","keywords":["触发词"],"reveal":"『关键口供原话』（导演注记可加括号）"}],"passive_leaks":["问A话题时…"],"testimony_yield":[{"id":"t{缩写}_语义","content":"『原话』","how":"何时给出"}],"unlock_triggers":{"1":{"any":["ev_x"]}},"relationships":{},"confrontation_script":{"trigger":"...","beats":["..."],"hard_rules":["..."],"reject_line":"..."},"never_say":["..."],"never_confirms":"他永远不正面回答的那个问题"}]}` },
    { role: 'user', content: `【标题】${title}\n【标签】${labels.join('/') || '无'}\n\n【暗线表（已确认）】\n${JSON.stringify(registry, null, 1)}\n\n【原文段落】\n${parasBlock(paras)}` }
  ]
}

// ---------- 生成（含校验失败重试一次） ----------

async function generateStep(name, messages, validate, maxTokens) {
  let lastErrors = []
  for (let attempt = 0; attempt < 2; attempt++) {
    const userMsgs = attempt === 0
      ? messages
      : [...messages, { role: 'user', content: `（你上一次的输出未通过校验，错误如下，请修正后重新输出完整 JSON：\n${lastErrors.map(e => '- ' + e).join('\n')}）` }]
    const content = await chat(userMsgs, { json: true, temperature: 0.7, maxTokens })
    let parsed
    try { parsed = JSON.parse(content) } catch { lastErrors = ['输出不是合法 JSON']; continue }
    const { errors, warnings } = validate(parsed)
    if (!errors.length) return { data: parsed, warnings, retries: attempt }
    lastErrors = errors
  }
  throw new Error(`${name} 两次生成均未通过校验：${lastErrors.join('；')}`)
}

/** 全流程：workId → 完整草稿（未落盘） */
export async function draftFromWorkId(workId) {
  const t0 = Date.now()
  const detail = await fetchOfficialStory(workId)
  const tFetch = Date.now()
  const { paras, excerpt } = splitParas(detail.content)
  if (paras.length < 10) throw new Error('故事太短，无法侦探化（段落 < 10）')
  const title = detail.chapter_name || '未命名故事'
  const labels = Array.isArray(detail.labels) ? detail.labels : []
  const tier = tierOf(labels)

  const step1 = await generateStep('暗线表',
    step1Prompt({ title, labels, tier, paras }),
    r => validateRegistry(r, paras),
    6000)
  const t1 = Date.now()

  const registry = step1.data
  const step2 = await generateStep('角色卡',
    step2Prompt({ title, labels, tier, paras, registry }),
    r => validateCharacters(r, registry, paras),
    8000)
  const t2 = Date.now()

  const { errors, warnings, repaired } = repairAlign(registry, step2.data)
  if (errors.length) throw new Error(`角色卡校验失败：${errors.join('；')}`)

  return {
    meta: {
      slot_id: String(workId), source: 'official-api', source_label: '知乎盐言故事（黑客松内容 API）',
      author_name: detail.author_name || '佚名', work_id: String(workId), title, labels, tier,
      code: String(workId), theme_hint: registry.theme_hint || ''
    },
    paras, registry, characters: step2.data.characters, excerpt,
    timings: { fetch: tFetch - t0, step1: t1 - tFetch, step2: t2 - t1, total: t2 - t0 },
    warnings: [...step1.warnings, ...step2.warnings, ...warnings],
    repairs: repaired
  }
}

// ---------- 校验器 ----------

const leakCore = reveal => {
  const m = String(reveal || '').match(/『([^』]+)』/)
  return (m ? m[1] : String(reveal || '')).replace(/（[^）]*）/g, '').trim()
}
// 6 字滑窗（与 index.js overlap 同规则）：措辞容差下判断两句话是否同一句
const sameLine = (a, b) => {
  const clean = s => String(s || '').replace(/[「」『』"“”\s，。？！…]/g, '')
  const x = clean(a), y = clean(b)
  if (x.length < 6 || y.length < 6) return x.includes(y) || y.includes(x)
  for (let i = 0; i + 6 <= x.length; i++) if (y.includes(x.slice(i, i + 6))) return true
  return false
}

export function validateRegistry(r, paras) {
  const errors = [], warnings = []
  const paraIds = new Set(paras.map(p => p.id))
  if (typeof r.summary !== 'string' || r.summary.length < 20) errors.push('summary 缺失或过短')
  const dlKeys = Object.keys(r.dark_lines || {})
  if (!dlKeys.length) errors.push('dark_lines 至少 1 条')
  if (!Array.isArray(r.evidences) || r.evidences.length < 3) errors.push('evidences 至少 3 个')
  for (const e of r.evidences || []) {
    if (!e.id || !e.name) errors.push(`证据缺 id/name：${JSON.stringify(e).slice(0, 50)}`)
    if (!Array.isArray(e.paraIds) || !e.paraIds.length) errors.push(`证据 ${e.name}：paraIds 为空（给不出锚点的证据必须删除）`)
    else if (!e.paraIds.every(id => paraIds.has(id))) errors.push(`证据 ${e.name}：锚定了不存在的段落 ${e.paraIds.join(',')}`)
    if (e.dark_line && !dlKeys.includes(e.dark_line)) errors.push(`证据 ${e.name}：dark_line ${e.dark_line} 不在 dark_lines 中`)
    if (!e.brief) errors.push(`证据 ${e.name}：缺 brief`)
  }
  const evIds = new Set((r.evidences || []).map(e => e.id))
  if (!Array.isArray(r.starting_evidence) || r.starting_evidence.length < 1 || r.starting_evidence.length > 2) errors.push('starting_evidence 应为 1-2 个')
  else if (!r.starting_evidence.every(id => evIds.has(id))) errors.push('starting_evidence 引用了不存在的证据')
  for (const p of r.contradiction_pairs || []) {
    if (!evIds.has(p.a) || !evIds.has(p.b)) errors.push(`矛盾对 ${p.a}×${p.b}：引用了不存在的证据 id`)
    if (!['矛盾', '印证'].includes(p.verdict)) errors.push(`矛盾对 ${p.a}×${p.b}：verdict 非法`)
    if (p.darkLine && !dlKeys.includes(p.darkLine)) errors.push(`矛盾对 ${p.a}×${p.b}：darkLine 非法`)
  }
  if ((r.contradiction_pairs || []).length < 1) errors.push('contradiction_pairs 至少 1 对（证据必须能咬合）')
  // 每条暗线 ≥1 条「矛盾」对（chain 型对峙门的钥匙——缺了对峙门死锁；在此层校验可随第一步重试自愈）
  for (const k of dlKeys) {
    if (!(r.contradiction_pairs || []).some(p => p.verdict === '矛盾' && p.darkLine === k)) {
      errors.push(`暗线 ${k} 缺少「矛盾」预注册对——必须存在指向该暗线的矛盾对（verdict="矛盾" 且 darkLine="${k}"）`)
    }
  }
  if (r.theme_hint && r.theme_hint.length > 40) warnings.push('theme_hint 偏长（>40 字）')
  return { errors, warnings }
}

export function validateCharacters(c, registry, paras) {
  const errors = [], warnings = []
  const evIds = new Set((registry.evidences || []).map(e => e.id))
  const chars = c.characters
  if (!Array.isArray(chars) || chars.length < 1 || chars.length > 3) { errors.push('角色数量应为 1-3'); return { errors, warnings } }
  const allTestimonyIds = new Set(chars.flatMap(ch => (ch.testimony_yield || []).map(t => t.id)))
  const seen = new Set()
  for (const ch of chars) {
    const n = ch.name || ch.character_id || '?'
    if (!ch.character_id || !/^[a-z0-9_]{2,32}$/.test(ch.character_id)) errors.push(`${n}：character_id 需为小写拼音/下划线`)
    if (seen.has(ch.character_id)) errors.push(`${n}：character_id 重复`)
    seen.add(ch.character_id)
    const p = ch.persona || {}
    for (const f of ['surface', 'defense_pattern', 'collapse_mode', 'initial_attitude']) {
      if (!p[f]) errors.push(`${n}：persona.${f} 缺失`)
    }
    if (!Array.isArray(p.speech_habits) || !p.speech_habits.length) errors.push(`${n}：persona.speech_habits 缺失`)
    const pp = ch.public_profile || {}
    for (const f of ['name', 'relation', 'blurb', 'opening']) {
      if (!pp[f]) errors.push(`${n}：public_profile.${f} 缺失`)
    }
    if (!ch.public_story) errors.push(`${n}：public_story 缺失`)
    if (!Array.isArray(ch.knows) || ch.knows.length < 3) errors.push(`${n}：knows 至少 3 条`)
    else for (const k of ch.knows) {
      if (!k.fact) errors.push(`${n}：knows 有空 fact`)
      if (![0, 1, 2, 3, 4].includes(k.stage)) errors.push(`${n}：knows.stage 应为 0-4`)
    }
    if (!Array.isArray(ch.does_not_know) || ch.does_not_know.length < 3) errors.push(`${n}：does_not_know 至少 3 条（反幻觉之墙）`)
    if (!Array.isArray(ch.lies) || !ch.lies.length) errors.push(`${n}：lies 至少 1 条（守谎者）`)
    else for (const l of ch.lies) {
      if (!l.content || !l.exposure_reaction) errors.push(`${n}：lie 缺 content/exposure_reaction`)
      if (![1, 2, 3, 4].includes(l.break_stage)) errors.push(`${n}：lie.break_stage 应为 1-4`)
    }
    if (!Array.isArray(ch.staged_leaks) || !ch.staged_leaks.length) warnings.push(`${n}：无 staged_leaks（关键口供泄露点，建议至少 1 条）`)
    for (const l of ch.staged_leaks || []) {
      if (!l.topic || !Array.isArray(l.keywords) || !l.keywords.length) errors.push(`${n}：staged_leak ${l.id || '?'} 缺 topic/keywords`)
      if (!leakCore(l.reveal) || leakCore(l.reveal).length < 6) errors.push(`${n}：staged_leak ${l.id || '?'} 的 reveal 缺『』原话`)
      if (![0, 1, 2, 3].includes(l.stage)) errors.push(`${n}：staged_leak ${l.id || '?'} stage 非法`)
      for (const rid of l.requires || []) {
        if (!evIds.has(rid) && !allTestimonyIds.has(rid)) errors.push(`${n}：staged_leak ${l.id || '?'} requires 引用了不存在的 ${rid}`)
      }
    }
    for (const t of ch.testimony_yield || []) {
      if (!t.id || !t.content) errors.push(`${n}：testimony_yield 有缺 id/content 的条目`)
      if (t.id && !/^t[a-z]+_[a-z0-9_]+$/.test(t.id)) warnings.push(`${n}：testimony id ${t.id} 不符合 t{缩写}_{语义} 约定`)
    }
    for (const [k, cond] of Object.entries(ch.unlock_triggers || {})) {
      const ids = [...(cond.any || []), ...(cond.all || [])]
      if (!ids.length) errors.push(`${n}：unlock_triggers.${k} 未引用任何证据`)
      for (const id of ids) {
        if (!evIds.has(id) && !allTestimonyIds.has(id)) errors.push(`${n}：unlock_triggers.${k} 引用了不存在的 ${id}`)
      }
    }
    const rule = ch.confront_rule
    if (!rule || !['chain', 'stage'].includes(rule.type)) errors.push(`${n}：confront_rule 非法`)
    else {
      if (!Object.keys(registry.dark_lines || {}).includes(rule.darkLine)) errors.push(`${n}：confront_rule.darkLine 不存在`)
      // 对峙门硬校验：chain 型暗线必须存在 ≥1 条「矛盾」预注册对，否则门永远开不了（E2E 会卡死）
      else if (rule.type === 'chain' && !(registry.contradiction_pairs || []).some(p => p.verdict === '矛盾' && p.darkLine === rule.darkLine)) {
        errors.push(`${n}：暗线 ${rule.darkLine} 缺少「矛盾」预注册对——对峙门将无法开启`)
      }
    }
    const script = ch.confrontation_script
    if (!script || !Array.isArray(script.beats) || script.beats.length < 5) errors.push(`${n}：confrontation_script.beats 至少 5 拍`)
    if (!script?.reject_line) warnings.push(`${n}：无 reject_line（将使用通用拒绝台词）`)
  }
  return { errors, warnings }
}

/** 修复对齐：staged_leaks 的『』口供若不在 testimony_yield 中 → 追加对应条目（保证玩家可钉选、可跨角色出示） */
function repairAlign(registry, charsData) {
  const errors = [], warnings = [], repaired = []
  for (const ch of charsData.characters || []) {
    const yields = ch.testimony_yield = ch.testimony_yield || []
    for (const l of ch.staged_leaks || []) {
      const core = leakCore(l.reveal)
      if (!core) continue
      if (!yields.some(t => sameLine(t.content, core))) {
        const id = l.id && /^t[a-z]+_/.test(l.id) ? l.id : `t${ch.character_id}_leak_${yields.length + 1}`
        yields.push({ id, content: `『${core}』`, how: `追问「${l.topic}」时漏出` })
        repaired.push(`${ch.name}：口供 ${id} 由泄露点自动登记`)
      }
    }
  }
  return { errors, warnings, repaired }
}

/** confirm 前的最终校验（审阅页可能手改过 JSON） */
export function validateDraft(draft) {
  if (!draft || typeof draft !== 'object') return { ok: false, errors: ['draft 非法'], warnings: [] }
  const paras = Array.isArray(draft.paras) ? draft.paras : []
  if (paras.length < 10) return { ok: false, errors: ['paras 至少 10 段'], warnings: [] }
  const chars = Array.isArray(draft.characters) ? { characters: draft.characters } : { characters: [] }
  const r1 = validateRegistry(draft.registry || {}, paras)
  const r2 = validateCharacters(chars, draft.registry || {}, paras)
  const errors = [...r1.errors, ...r2.errors]
  return { ok: !errors.length, errors, warnings: [...r1.warnings, ...r2.warnings] }
}

// ---------- 落盘 ----------

export function persistSlot(slotId, draft) {
  const dir = slotDir(slotId)
  if (slotId === 'main') throw new Error('main 为内置主线，不可覆盖')
  const charsDir = path.join(dir, 'characters')
  fs.mkdirSync(charsDir, { recursive: true })
  // 先清空旧角色卡：同一槽位重新生成时，残留旧文件会与新 evidence.json 的 id 脱节（解锁链路断裂）
  for (const f of fs.readdirSync(charsDir)) fs.rmSync(path.join(charsDir, f))
  fs.writeFileSync(path.join(dir, 'story.json'), JSON.stringify({
    title: draft.meta.title, summary: draft.registry.summary, paras: draft.paras,
    ...(draft.excerpt ? { excerpt: true } : {})
  }, null, 2))
  fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(draft.registry, null, 2))
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(draft.meta, null, 2))
  const chars = Array.isArray(draft.characters) ? draft.characters : draft.characters?.characters || []
  for (const ch of chars) {
    fs.writeFileSync(path.join(charsDir, `${ch.character_id}.json`), JSON.stringify(ch, null, 2))
  }
  reloadSlot(slotId)
  return dir
}
