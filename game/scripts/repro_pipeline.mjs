// P4 流水线端到端回归：draft → 姓名反幻觉检查 → confirm → 游戏内冒烟（盘问/反幻觉/出示/对峙）
// 用法：node scripts/repro_pipeline.mjs <workId>，如 2025684191967294692（蓝血）
const BASE = 'http://localhost:3001'
const workId = process.argv[2] || '2025684191967294692'

async function post(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  return { status: r.status, j }
}
async function sse(payload) {
  const res = await fetch(BASE + '/api/interrogate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  if (!res.ok) return { err: 'HTTP ' + res.status }
  let stage = null, text = ''
  const dec = new TextDecoder(); let buf = ''
  for await (const ch of res.body) {
    buf += dec.decode(ch, { stream: true })
    const frames = buf.split(/\r?\n\r?\n/); buf = frames.pop() ?? ''
    for (const f of frames) { const m = f.match(/^data: (.*)$/s); if (m) { const ev = JSON.parse(m[1]); if (ev.type === 'delta') text += ev.text; if (ev.type === 'done') stage = ev.stage } }
  }
  return { text, stage }
}

// ---------- ① draft ----------
console.log(`===== 流水线端到端 · workId=${workId} =====`)
const t0 = Date.now()
const d = await post('/api/pipeline/draft', { workId })
if (d.status !== 200) { console.log('① draft 失败:', d.status, d.j.error); process.exit(1) }
const draft = d.j.draft
console.log(`① draft OK ${Math.round((Date.now() - t0) / 1000)}s | 《${draft.meta.title}》${draft.meta.author_name} | 档位=${draft.meta.tier}`)
console.log('   暗线:', Object.entries(draft.registry.dark_lines).map(([k, v]) => `${k} ${v.split('——')[0]}`).join(' ｜ '))
console.log(`   证据 ${draft.registry.evidences.length} 张 | 角色 ${draft.characters.length} 名 | 段落 ${draft.paras.length} | 警告 ${draft.warnings.length} | 修复 ${draft.repairs.length}`)
draft.characters.forEach(c => console.log(`   - ${c.character_id} ${c.public_profile.name}（${c.public_profile.relation}）rule=${JSON.stringify(c.confront_rule)}`))

// ---------- ② 姓名反幻觉检查：卡面姓名必须在原文出现，或是无名字的身份称呼 ----------
const content = await fetch(`https://api.zhihu.com/km-indep-home/hackathon/v2/story/${workId}`).then(r => r.json()).then(d => d.content)
let nameOK = true
for (const c of draft.characters) {
  const bare = c.public_profile.name.replace(/[　\s]/g, '')
  const inStory = content.includes(bare)
  const isRoleTitle = /(师|男|女|人|者|员|长|主|夫|妻|母|父|哥|姐|弟|妹|叔|姨|官|医|警|秘|管|老板|邻居|同事|朋友)$/.test(bare) && bare.length <= 6
  if (!inStory && !isRoleTitle) { nameOK = false; console.log(`   ✗ 姓名「${bare}」既不在原文也不是身份称呼（幻觉姓名）`) }
}
console.log(`② 姓名反幻觉: ${nameOK ? 'PASS ✓' : 'FAIL ✗'}`)

// ---------- ③ confirm 落盘 ----------
const c3 = await post('/api/pipeline/confirm', { slotId: workId, draft })
console.log(`③ confirm: ${c3.j.ok ? 'PASS ✓ 落盘 shared/custom/' + workId : 'FAIL ✗ ' + JSON.stringify(c3.j).slice(0, 300)}`)

// ---------- ④ 游戏内冒烟 ----------
const g = await fetch(`${BASE}/api/game?slot=${workId}`).then(r => r.json())
console.log(`④ game: 《${g.story.title}》| ${g.characters.length} 角色 | 暗线 ${g.darklineTotal} | 作者 ${g.meta.author_name}`)

const ch0 = draft.characters[0]
const chGate = draft.characters.find(c => c.confront_rule?.type === 'chain') || ch0
console.log(`   主角=${ch0.public_profile.name} 守门人=${chGate.public_profile.name}`)

// 盘问：1 个自由问题 + 2 个反幻觉问题（原文没写的细节）
const free = await sse({ slotId: workId, characterId: ch0.character_id, question: '把那天的经过原原本本讲一遍。', history: [], shownEvidence: [], stage: 0 })
console.log(`   自由盘问(${ch0.public_profile.name}): ${free.text.slice(0, 60).replace(/\n/g, ' ')}…`)
const f1 = await sse({ slotId: workId, characterId: ch0.character_id, question: '你们家养过宠物吗？', history: [], shownEvidence: [], stage: 0 })
// 编造 = 肯定式陈述养过什么（「养不养猫狗不劳你打听」式拒绝不算）
const f1bad = /(养了|养过|有一只|是只|买了只|捡了只)/.test(f1.text)
console.log(`   反幻觉(宠物): ${f1bad ? 'FAIL ✗ 编造宠物 → ' + f1.text.slice(0, 60) : 'PASS ✓ ' + f1.text.slice(0, 50).replace(/\n/g, ' ')}`)
const f2 = await sse({ slotId: workId, characterId: chGate.character_id, question: '你老家是哪里的？父母还健在吗？', history: [], shownEvidence: [], stage: 0 })
console.log(`   反幻觉(老家/父母，原文未必有): ${f2.text.slice(0, 70).replace(/\n/g, ' ')}`)

// 出示：守门人吃第一张注册证据 → stage 推进
const ev0 = draft.registry.starting_evidence[0]
const evName = draft.registry.evidences.find(e => e.id === ev0)?.name
const s1 = await sse({ slotId: workId, characterId: chGate.character_id, showEvidenceId: ev0, showCard: {}, history: [], shownEvidence: [], stage: 0 })
console.log(`   出示「${evName}」→ stage=${s1.stage} ${s1.text.slice(0, 50).replace(/\n/g, ' ')}`)

// 划选 fast-path：锚点段落直接发证
const anchor = draft.registry.evidences.find(e => e.paraIds?.length)
const jq = await post('/api/judge/quote', { slotId: workId, characterId: chGate.character_id, paraId: anchor.paraIds[0], selectedText: '' })
console.log(`   划选锚点(${anchor.paraIds[0]}): ${jq.j.relevant ? `发证 ${jq.j.evidence?.name} ✓` : '未发证 ✗'}`)

// 关联 fast-path：预注册对（优先取「矛盾」对——chain 型对峙门的钥匙）
const pair = draft.registry.contradiction_pairs.find(p => p.verdict === '矛盾') || draft.registry.contradiction_pairs[0]
const jr = await post('/api/judge/relation', { slotId: workId, cards: [{ id: pair.a, name: pair.a }, { id: pair.b, name: pair.b }], chains: [] })
console.log(`   预注册对(${pair.a}×${pair.b}): ${jr.j.verdict}(${jr.j.mode}) ${jr.j.darkLine || ''}`)

// 对峙：资格不足（无链）→ reject；构造链 → 演出
const cf1 = await post('/api/confront', { slotId: workId, characterId: chGate.character_id, chains: [], stage: s1.stage ?? 0 })
console.log(`   对峙(无链): ok=${cf1.j.ok} reject=${String(cf1.j.reject).slice(0, 40)}`)
const chains = [{ a: pair.a, b: pair.b, verdict: pair.verdict, darkLine: pair.darkLine || 'DL1' }]
const cf2 = await post('/api/confront', { slotId: workId, characterId: chGate.character_id, chains, stage: s1.stage ?? 0 })
console.log(`   对峙(链成立): ok=${cf2.j.ok} beats=${cf2.j.beats?.length} darkLine=${cf2.j.darkLine}`)
if (cf2.j.beats) console.log('     第一拍:', String(cf2.j.beats[0]).slice(0, 60))

// 泄露链：staged_leaks 关键词命中（服务端保底保证说出）
// 模拟玩家已把 stage 推进到 leak.stage 并出示了 requires 证据（真实游戏路径），验证保底层
const leak = (chGate.staged_leaks || [])[0]
if (leak) {
  const leakEv = leak.requires?.[0] || ev0
  const leakStage = Math.max(leak.stage ?? 0, 0)
  const shown = (leak.requires?.length ? leak.requires : [leakEv]).map(id => ({ id, name: '', brief: '' }))
  const s3 = await sse({
    slotId: workId, characterId: chGate.character_id, question: `关于${leak.topic}，到底怎么回事？`,
    history: [], shownEvidence: shown, stage: leakStage
  })
  const core = (String(leak.reveal).match(/『([^』]+)』/) || [])[1] || ''
  const hit = core && s3.text.replace(/\s/g, '').includes(core.slice(0, 8))
  console.log(`   泄露链(${leak.topic} s${leakStage}): ${hit ? 'PASS ✓ 漏出「' + core.slice(0, 24) + '…」' : 'FAIL ✗ → ' + s3.text.slice(0, 80).replace(/\n/g, ' ')}`)
}

// 结算
const st = await post('/api/settle', { slotId: workId, stats: { questions: 3, shown: 1, pins: 0, contradictions: 1, confirms: 0, wrongAccuse: 0, hints: 0 }, unlockedDLs: [cf2.j.darkLine].filter(Boolean) })
console.log(`   结算: ${st.j.comment?.slice(0, 70)}…`)
console.log(`===== 总耗时（含两次完整 LLM 生成）: ${Math.round((Date.now() - t0) / 1000)}s =====`)
