// P1 AI 原生性验收跑批器（开发Spec.md §4.2）
// 用法：
//   1) 先启动 server：npm run dev:server（或 npm run dev）
//   2) 收集问答+自动检查（不花钱）：node eval/run_p1_eval.js
//   3) 附带 LLM 打分（需 game/.env 配置 DEEPSEEK_API_KEY）：node eval/run_p1_eval.js --judge
// 环境变量：BASE_URL（默认 http://localhost:3001）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.BASE_URL || 'http://localhost:3001'
const JUDGE = process.argv.includes('--judge')

const testSet = JSON.parse(fs.readFileSync(path.join(ROOT, 'eval/p1_free_questions.json'), 'utf8'))

async function interrogate(payload) {
  const res = await fetch(`${BASE}/api/interrogate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} ${body.slice(0, 120)}`)
  }
  let text = '', degraded = false, stateMark = '平静', stage = payload.stage || 0, mode = 'llm'
  const decoder = new TextDecoder()
  let buf = ''
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true })  // streaming 解码：多字节字符跨 chunk 安全
    const frames = buf.split(/\r?\n\r?\n/)
    buf = frames.pop() ?? ''
    for (const frame of frames) {
      const m = frame.match(/^data: (.*)$/s)
      if (!m) continue
      const ev = JSON.parse(m[1])
      if (ev.type === 'delta') text += ev.text
      if (ev.type === 'degraded') degraded = true
      if (ev.type === 'done') { stateMark = ev.stateMark; stage = ev.stage; mode = ev.mode }
    }
  }
  return { text, degraded, stateMark, stage, mode }
}

// 自动检查：出戏词 / 超长（客观项，无需判断力）
const OOC = ['AI', '人工智能', '大模型', 'prompt', '提示词', '剧本', '系统设定', '游戏', '角色扮演', '作为语言模型']
function autoCheck(text) {
  const issues = []
  if (text.length > 120) issues.push(`超长(${text.length}字)`)
  for (const w of OOC) if (text.includes(w)) issues.push(`出戏词「${w}」`)
  return issues
}

async function main() {
  const health = await fetch(`${BASE}/api/health`).then(r => r.json())
  console.log(`[eval] server ok=${health.ok} llm=${health.llm ? 'on' : 'off(将走降级剧本)'}`)
  if (!health.llm && JUDGE) { console.error('[eval] 未配置 DEEPSEEK_API_KEY，无法打分'); process.exit(1) }

  const results = []
  for (const q of testSet.questions) {
    const r = await interrogate({
      characterId: q.character, question: q.q,
      history: [], shownEvidence: [], stage: 0
    })
    const auto = autoCheck(r.text)
    results.push({ ...q, reply: r.text, degraded: r.degraded, stateMark: r.stateMark, auto })
    console.log(`[${q.id}] ${q.character} ${r.degraded ? 'DEGRADED' : 'LLM'} ${auto.length ? '⚠ ' + auto.join(';') : 'ok'}`)
  }

  const lieResults = []
  for (const p of testSet.lie_consistency) {
    const payload = p.mode === 'show'
      ? { characterId: p.character, showEvidenceId: p.evidenceId, history: [], shownEvidence: [], stage: 0 }
      : { characterId: p.character, question: p.q, history: [], shownEvidence: [], stage: 0 }
    const r = await interrogate(payload)
    const auto = autoCheck(r.text)
    lieResults.push({ ...p, reply: r.text, stage: r.stage, auto })
    console.log(`[${p.id}] ${p.mode} stage→${r.stage} ${auto.length ? '⚠ ' + auto.join(';') : 'ok'}`)
  }

  // ---- LLM 打分（0/1/2，rubric 见测试集 expect） ----
  let scored = false
  if (JUDGE) {
    const { chat } = await import('../server/llm.js')
    const sys = `你是审讯角色扮演质量评审。只根据【内容正确性】打分，不评判表演风格（是否"表现出困惑/紧张"之类的风格差异不扣分）。
- 2 分 = 内容符合预期方向，且无编造、无顺认诈术、无越界泄密、无出戏
- 1 分 = 内容无编造无越界，但答非所问或明显回避（可视为边缘合格）
- 0 分 = 仅限四种内容错误：①编造了设定中不存在的事实（人名/地点/细节/行踪/物品结局） ②顺着侦探诈术承认了假证据 ③身份出戏（否认认识的人、身份漂移） ④泄露当前阶段不应知的信息
【预期】中描述的是内容要求；若【实际回答】内容达标，即使语气平淡也必须给 2 分。
只输出 JSON：{"score":0,"reason":"不超过30字的理由"}`
    for (const r of results) {
      const user = `【被审角色】${r.character}（陈默=丈夫/周兰=婆婆/小雅=闺蜜）
【侦探的问题】${r.q}
【预期表现】${r.expect}
【实际回答】${r.reply}
【自动检查】${r.auto.join(';') || '无'}`
      try {
        const out = await chat([{ role: 'system', content: sys }, { role: 'user', content: user }], { json: true, temperature: 0 })
        const j = JSON.parse(out)
        r.score = typeof j.score === 'number' ? j.score : null
        r.judgeReason = j.reason || ''
      } catch (e) {
        r.score = null
        r.judgeReason = `打分失败：${e.message}`
      }
    }
    scored = results.every(r => typeof r.score === 'number')
  }

  // ---- 报告 ----
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const reportPath = path.join(ROOT, 'eval/reports', `p1_eval_${today}${JUDGE && scored ? '_scored' : ''}.md`)
  const L = []
  L.push(`# P1 AI 原生性验收报告（${today}）`)
  L.push('')
  L.push(`> server llm=${health.llm ? 'on' : 'off'} ｜ 打分=${JUDGE && scored ? '已含 LLM 评分' : JUDGE ? '打分失败' : '未打分（--judge 开启）'} ｜ 通过线：${testSet.pass_line.total}，且 ${testSet.pass_line.hard}`)
  L.push('')
  const scored2 = results.filter(r => r.score === 2).length
  const scored1 = results.filter(r => r.score === 1).length
  const scored0 = results.filter(r => r.score === 0).length
  if (JUDGE && scored) {
    const total = results.reduce((s, r) => s + r.score, 0)
    const z0 = results.filter(r => r.cat === 'Z' && r.score === 0).length
    const f0 = results.filter(r => r.cat === 'F' && r.score === 0).length
    const autoFail = results.filter(r => r.auto.length > 0).length
    const pass = total >= 51 && z0 === 0 && f0 === 0 && autoFail === 0
    L.push(`## 结论：${pass ? '✅ 通过' : '❌ 未通过'} ｜ 总分 ${total}/60（2分×${scored2} 1分×${scored1} 0分×${scored0}）｜ Z类0分 ${z0} ｜ F类0分 ${f0} ｜ 自动检查异常 ${autoFail}`)
    L.push('')
  }
  L.push(`## 评分表`)
  L.push('')
  L.push(`| # | 类 | 角色 | 得分 | 自动检查 | 一句话理由 |`)
  L.push(`|---|---|---|---|---|---|`)
  for (const r of results) {
    L.push(`| ${r.id} | ${r.cat} | ${r.character} | ${r.score ?? '-'} | ${r.auto.join(';') || 'ok'} | ${r.judgeReason || ''} |`)
  }
  L.push('')
  L.push(`## 守谎一致性`)
  L.push('')
  for (const p of lieResults) {
    L.push(`### ${p.id}（${p.mode === 'show' ? '出示 ' + p.evidenceId : '口头'}）stage→${p.stage} ${p.auto?.length ? '⚠ ' + p.auto.join(';') : 'ok'}`)
    L.push(`- 预期：${p.expect}`)
    L.push(`- 回答：${p.reply}`)
    L.push('')
  }
  L.push(`## 全部问答原文`)
  L.push('')
  for (const r of results) {
    L.push(`### [${r.id}] ${r.character} · ${r.q}`)
    L.push(`- 预期：${r.expect}`)
    L.push(`- 回答（${r.degraded ? '降级剧本' : 'LLM'}${r.stateMark === '动摇' ? ' · 动摇' : ''}）：${r.reply}`)
    L.push('')
  }
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, L.join('\n'), 'utf8')
  console.log(`[eval] 报告已写入 ${reportPath}`)
  if (JUDGE && scored) {
    const total = results.reduce((s, r) => s + r.score, 0)
    const z0 = results.filter(r => r.cat === 'Z' && r.score === 0).length
    const f0 = results.filter(r => r.cat === 'F' && r.score === 0).length
    const autoFail = results.filter(r => r.auto.length > 0).length
    console.log(`[eval] 总分 ${total}/60 ｜ Z0=${z0} F0=${f0} autoFail=${autoFail} ｜ ${total >= 51 && z0 === 0 && f0 === 0 && autoFail === 0 ? '✅ 通过' : '❌ 未通过'}`)
    process.exit(total >= 51 && z0 === 0 && f0 === 0 && autoFail === 0 ? 0 : 2)
  }
}

main().catch(e => { console.error('[eval] 失败：', e.message); process.exit(1) })
