// 链路回归：陈默泄露 → 钉卡 → 小雅U3 → 对峙DL2 + 周/雅迁移点 + 泄露门控/反幻觉回归
const BASE = 'http://localhost:3001'

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
async function post(path, body) {
  return (await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()
}

// A. 钉卡跨角色：陈默漏出的台词 → 钉卡出示给小雅 → 应解析到 tsm_phone 并解锁 U3
const leakLine = '她那阵子总锁着门打电话。我问过一次，她说跟同事聊工作。'
const a = await sse({ characterId: 'xiaoya', showEvidenceId: 'pin_test', showCard: { name: '口供 · 陈默', content: leakLine }, history: [], shownEvidence: [], stage: 0 })
console.log('A. 钉卡(tsm_phone)→小雅: stage=' + a.stage + '（期望3）')
console.log('   小雅反应:', a.text.slice(0, 90).replace(/\n/g, ' '))

// B. 对峙资格 + C. 对峙演出（DL2）
const check = await post('/api/confront/check', { characterId: 'xiaoya', chains: [], stage: 3 })
console.log('B. 小雅对峙资格(stage3):', check.ready, '（期望true）')
const conf = await post('/api/confront', { characterId: 'xiaoya', chains: [], stage: 3 })
console.log('C. 对峙演出: ok=' + conf.ok + ' beats=' + (conf.beats?.length ?? 0) + ' darkLine=' + conf.darkLine + '（期望 ok=true darkLine=DL2）')

// D. 小雅 staged_leak：出示舍曲林 → 问药 → 应漏停药三个月
const d1 = await sse({ characterId: 'xiaoya', showEvidenceId: 'ev2_pills', history: [], shownEvidence: [], stage: 0 })
console.log('D0. 出示舍曲林(小雅)即时泄露(U1设计):', /停药|她停了/.test(d1.text) ? 'YES ✓' : 'NO', '→', d1.text.slice(0, 100).replace(/\n/g, ' '))
const d2 = await sse({ characterId: 'xiaoya', question: '她一直按时吃药吗？', history: [{ who: '侦探', text: '〔出示物证〕一片没少的舍曲林' }, { who: '小雅', text: d1.text.slice(0, 60) }], shownEvidence: [{ id: 'ev2_pills', name: '一片没少的舍曲林', brief: '' }], stage: d1.stage })
console.log('D. 小雅漏「停药三个月」?', /停药|她停了/.test(d1.text + d2.text) ? 'YES ✓（出示回合已逐字漏出）' : 'NO ✗ → ' + d2.text.slice(0, 100).replace(/\n/g, ' '))

// E. 周兰 stage0 口供触发：问厨房 → 应给滤网/油花/垃圾桶
const e = await sse({ characterId: 'zhoulan', question: '案发之后，你去她家厨房收拾过吗？', history: [], shownEvidence: [], stage: 0 })
console.log('E. 周兰厨房口供?', /滤网|油花|垃圾/.test(e.text) ? 'YES ✓' : 'NO ✗ → ' + e.text.slice(0, 100).replace(/\n/g, ' '))

// F. 泄露门控回归：stage3+舍曲林已出示，但问题与病情无关 → 不应强漏
const f = await sse({ characterId: 'chenmo', question: '你母亲身体怎么样？', history: [], shownEvidence: [{ id: 'ev2_pills', name: '一片没少的舍曲林', brief: '' }], stage: 3 })
const fLeak = f.text.includes('锁着门') && f.text.includes('电话')
console.log('F. 无关问题(母亲)误漏?', fLeak ? 'YES ✗（门控过宽）' : 'NO ✓', '→ ' + f.text.slice(0, 80).replace(/\n/g, ' '))

// G. 反幻觉回归：U0 问宠物 → 应困惑/反问
const g = await sse({ characterId: 'chenmo', question: '你们家养过宠物吗？', history: [], shownEvidence: [], stage: 0 })
console.log('G. U0问宠物(应困惑/反问):', g.text.slice(0, 70).replace(/\n/g, ' '))
