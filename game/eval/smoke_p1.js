// P1 冒烟测试：降级模式全链路（server 无 key 时 interrogate/suggest 走离线剧本且标记 degraded）
const BASE = 'http://localhost:3001'

async function sse(path, payload) {
  const res = await fetch(BASE + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  let text = '', events = []
  let buf = ''
  for await (const chunk of res.body) {
    buf += Buffer.from(chunk).toString('utf8')
    let i
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2)
      const m = line.match(/^data: (.*)$/s)
      if (m) { const ev = JSON.parse(m[1]); events.push(ev.type); if (ev.type === 'delta') text += ev.text }
    }
  }
  return { text, events }
}

const h = await fetch(BASE + '/api/health').then(r => r.json())
console.log(`1. health: ok=${h.ok} llm=${h.llm}`)
if (!h.ok) throw new Error('health 检查失败')
if (h.llm) {
  console.log('   ⚠ 本冒烟测试验证降级链路，检测到 LLM 已配置——降级路径未覆盖（LLM 路径由 30 问 eval 覆盖）')
}

const g = await fetch(BASE + '/api/game').then(r => r.json())
console.log(`2. game: opening存在=${g.characters.every(c => typeof c.opening === 'string' && c.opening.length > 5)}`)

const a = await sse('/api/interrogate', { characterId: 'chenmo', question: '她去世那晚，你们一起吃的晚饭？', history: [], shownEvidence: [], stage: 0 })
console.log(`3. 盘问(降级): events=${a.events.join(',')} 回答="${a.text.slice(0, 30)}…" degraded=${a.events.includes('degraded')}`)

const b = await sse('/api/interrogate', { characterId: 'chenmo', showEvidenceId: 'ev1_kitchen', history: [], shownEvidence: [], stage: 0 })
console.log(`4. 出示ev1_kitchen(降级): 回答="${b.text.slice(0, 30)}…"（应为外卖承认）`)

const s = await fetch(BASE + '/api/suggest', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ characterId: 'zhoulan', recentHistory: [] })
}).then(r => r.json())
console.log(`5. suggest(降级): ${s.suggestions.length}条 degraded=${!!s.degraded}`)

const bad = await fetch(BASE + '/api/interrogate', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ characterId: 'nobody', question: 'x' })
})
console.log(`6. 未知角色校验: HTTP ${bad.status}`)
