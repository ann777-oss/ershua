// 后端 API 封装（vite 代理 /api → localhost:3001）
async function jsonOrThrow(res) {
  if (!res.ok) {
    // 仅非 2xx 时容忍无 body 的错误响应（status 挂到错误上，调用方可按状态分支）
    const data = await res.json().catch(() => ({}))
    const err = new Error(data.error || `HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  // 2xx 但响应体非法 JSON → 如实抛错，不吞异常
  return res.json()
}

const post = (url, body) => fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
}).then(jsonOrThrow)

// ---- 知乎 OAuth 登录 + 我的案源（P6） ----
export function authStatus() { return fetch('/api/auth/status').then(jsonOrThrow) }
export function authLoginUrl() { return fetch('/api/auth/url').then(jsonOrThrow) }
export function authLogout() { return post('/api/auth/logout', {}) }
export function fetchMyCases() { return fetch('/api/me/cases').then(jsonOrThrow) }

export function fetchGame(slotId = 'main') {
  return fetch(`/api/game?slot=${encodeURIComponent(slotId)}`).then(jsonOrThrow)
}

/** 官方故事列表（真实调用知乎内容 API；失败抛真实状态） */
export function fetchStories() {
  return fetch('/api/stories').then(jsonOrThrow)
}

/** 已生成的本地槽位 id 列表（S0 区分「直接进入」与「送去流水线」） */
export function fetchSlots() {
  return fetch('/api/slots').then(jsonOrThrow)
}

/** P4 流水线：两步草稿生成（不落盘，人工审阅后 confirm） */
export function pipelineDraft(workId) {
  return post('/api/pipeline/draft', { workId })
}

/** P4 流水线：校验 + 落盘 shared/custom/{slotId} */
export function pipelineConfirm(slotId, draft) {
  return post('/api/pipeline/confirm', { slotId, draft })
}

/** SSE 盘问流：async generator，逐事件 yield（delta / degraded / done / error） */
export async function* streamInterrogate(payload) {
  const res = await fetch('/api/interrogate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `HTTP ${res.status}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })  // streaming 解码：多字节字符跨 chunk 安全
    // 兼容 \n\n 与 \r\n\r\n 两种帧分隔
    const frames = buf.split(/\r?\n\r?\n/)
    buf = frames.pop() ?? ''  // 末段可能不完整，留待下一轮
    for (const frame of frames) {
      // 合并帧内重复 data: 字段（SSE 规范），忽略其他字段
      const dataLines = frame.split(/\r?\n/).filter(l => l.startsWith('data:'))
      if (!dataLines.length) continue
      const payloadText = dataLines.map(l => l.replace(/^data: ?/, '')).join('\n')
      try { yield JSON.parse(payloadText) } catch { /* 忽略残包 */ }
    }
  }
}

export function fetchSuggestions(characterId, recentHistory, boardEvidence = [], slotId = 'main') {
  return post('/api/suggest', { characterId, recentHistory, boardEvidence, slotId })
}

/** 原文划选判定 */
export function judgeQuote(characterId, paraId, selectedText, slotId = 'main') {
  return post('/api/judge/quote', { characterId, paraId, selectedText, slotId })
}

/** 两卡关联判定 */
export function judgeRelation(cardA, cardB, chains, slotId = 'main') {
  return post('/api/judge/relation', { cards: [cardA, cardB], chains, slotId })
}

/** 发起对峙（固定剧本 verbatim；资格不足返回 reject 短台词） */
export function confrontCharacter(characterId, chains, stage, slotId = 'main') {
  return post('/api/confront', { characterId, chains, stage, slotId })
}

/** 结算（暗线全文 + 原文坐标 + 结案评语） */
export function settleCase(stats, unlockedDLs, slotId = 'main') {
  return post('/api/settle', { stats, unlockedDLs, slotId })
}
