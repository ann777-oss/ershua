// 复现脚本：出示舍曲林 → 追问病 → 检查 tsm_phone 泄露
async function sse(payload) {
  const res = await fetch('http://localhost:3001/api/interrogate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
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
const r1 = await sse({ characterId: 'chenmo', showEvidenceId: 'ev2_pills', history: [], shownEvidence: [], stage: 0 })
console.log('1. 出示舍曲林: stage=' + r1.stage + '（期望3）')
console.log('   陈默反应:', r1.text.slice(0, 90))
const r2 = await sse({
  characterId: 'chenmo', question: '她的病，真的有那么重吗？',
  history: [{ who: '侦探', text: '〔出示物证〕一片没少的舍曲林' }, { who: '陈默', text: r1.text.slice(0, 70) }],
  shownEvidence: [{ id: 'ev2_pills', name: '一片没少的舍曲林', brief: '' }],
  stage: r1.stage ?? 0
})
console.log('2. 追问病: stage=' + r2.stage)
console.log('   陈默回答:', r2.text.slice(0, 140))
const hasLeak = r2.text.indexOf('锁') >= 0 && r2.text.indexOf('电话') >= 0
console.log('   漏出「锁着门打电话」?', hasLeak ? 'YES ✓' : 'NO ✗')
