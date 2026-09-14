import express from 'express'
import crypto from 'node:crypto'

// 知乎黑客松 OAuth（references/hackathon-oauth.md 为事实源）：
//   授权  GET  openapi.zhihu.com/authorize?redirect_uri&app_id&response_type=code[&state]
//   回调  {redirect_uri}?authorization_code=…（主路径；兼容 code=…）
//   换token POST openapi.zhihu.com/access_token（表单：app_id/app_key/grant_type=authorization_code/redirect_uri/code）
// 凭证只在服务端：App Key 绝不进前端/日志/仓库（官方红线）。
const AUTHORIZE_URL = 'https://openapi.zhihu.com/authorize'
const TOKEN_URL = 'https://openapi.zhihu.com/access_token'

const APP_ID = process.env.ZHIHU_OAUTH_APP_ID || ''
const APP_KEY = process.env.ZHIHU_OAUTH_APP_KEY || ''
const STATE_DISABLED_FOR_HACKATHON = process.env.ZHIHU_OAUTH_DISABLE_STATE_FOR_HACKATHON === 'true'

function cleanRedirectUri(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const url = raw.match(/https?:\/\/[^\]\s,}"')]+/)?.[0]
  return url || raw.replace(/^['"]|['"]$/g, '').trim()
}

// 回调地址：优先环境变量显式指定；否则按请求 Origin 推导（云托管走 x-forwarded-proto）。
// 必须与活动页面登记值完全一致（协议/域名/路径，含尾斜杠差异）。
function redirectUriOf(req) {
  const configured = cleanRedirectUri(process.env.ZHIHU_OAUTH_REDIRECT_URI)
  if (configured) return configured
  const host = req.headers.host || req.hostname
  const forwardedProto = req.headers['x-forwarded-proto'] || req.headers['x-forwarded-scheme']
  const inferredProto = forwardedProto || (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? 'http' : 'https')
  const proto = String(inferredProto || req.protocol || 'https').split(',')[0].trim()
  return `${proto}://${host}/api/auth/callback`
}

function shortHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 10)
}

function redirectDiagnostics(req) {
  const rawEnv = process.env.ZHIHU_OAUTH_REDIRECT_URI || ''
  const redirectUri = redirectUriOf(req)
  let parsed = null
  try {
    const u = new URL(redirectUri)
    parsed = {
      protocol: u.protocol.replace(':', ''),
      host: u.host,
      pathname: u.pathname,
      validHttps: u.protocol === 'https:',
      expectedPath: u.pathname === '/api/auth/callback'
    }
  } catch {
    parsed = { validHttps: false, expectedPath: false, parseError: true }
  }
  return {
    redirectUri,
    redirectUriLength: redirectUri.length,
    redirectUriHash: shortHash(redirectUri),
    envRedirectUriConfigured: Boolean(rawEnv.trim()),
    envRedirectUriCleaned: Boolean(rawEnv.trim() && cleanRedirectUri(rawEnv) !== rawEnv.trim()),
    parsed
  }
}

export const oauthConfigured = () => Boolean(APP_ID && APP_KEY)

// ---- 内存会话与 state（演示规模够用；重启即清空，符合官方"应用后端会话"定位） ----
// sid → { token, expiresAt }；state → 创建时间（10 分钟一次性）
const sessions = new Map()
const states = new Map()
const SESSION_TTL_MS = 24 * 60 * 60 * 1000
const STATE_TTL_MS = 10 * 60 * 1000

function sweep() {
  const now = Date.now()
  for (const [k, v] of sessions) if (v.expiresAt <= now) sessions.delete(k)
  for (const [k, t] of states) if (now - t > STATE_TTL_MS) states.delete(k)
}

// 手动解析 cookie（不为此引依赖）
function cookieOf(req, name) {
  const raw = req.headers.cookie || ''
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return null
}

/** 取当前请求的登录会话；无/过期返回 null（/api/me/* 用） */
export function sessionOf(req) {
  sweep()
  const sid = cookieOf(req, 'zsid')
  if (!sid || !sessions.has(sid)) return null
  return sessions.get(sid)
}

function setUserSession(res, token, expiresInSeconds) {
  const sid = crypto.randomBytes(24).toString('hex')
  const ttlMs = Math.min(
    Number.isFinite(expiresInSeconds) ? expiresInSeconds * 1000 : SESSION_TTL_MS,
    SESSION_TTL_MS
  )
  sessions.set(sid, { token, expiresAt: Date.now() + ttlMs })
  res.setHeader('Set-Cookie',
    `zsid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ttlMs / 1000)}`)
}

// 简易结果页（回调是浏览器顶层跳转落点，给出可读信息 + 返回链接）
const page = (title, body, status = 200) =>
  `<meta charset="utf-8"><title>${title}</title>
   <body style="font-family:serif;background:#f4edda;color:#2b2620;padding:48px;line-height:1.8">
   <h2 style="margin-top:0">${title}</h2>${body}
   <p><a href="/" style="color:#8c2f24">← 回到二刷</a></p></body>`

export const authRouter = express.Router()

// 登录入口：返回授权页地址（前端整页跳转，用户在知乎页面亲自确认）
authRouter.get('/url', (_req, res) => {
  if (!oauthConfigured()) return res.status(503).json({ error: '服务端未配置知乎 OAuth 凭证', configured: false })
  sweep()
  const params = { redirect_uri: redirectUriOf(_req), app_id: APP_ID, response_type: 'code' }
  if (!STATE_DISABLED_FOR_HACKATHON) {
    const state = crypto.randomBytes(16).toString('hex')
    states.set(state, Date.now())
    params.state = state
  }
  const redirectUri = redirectUriOf(_req)
  const url = `${AUTHORIZE_URL}?${new URLSearchParams(params)}`
  res.json({ url, redirectUri })
})

// 知乎授权后的回调：校验 state → 换 token → 建会话 → 回首页
authRouter.get('/callback', async (req, res) => {
  const code = req.query.authorization_code || req.query.code
  console.log('[auth] callback received:', {
    hasAuthorizationCode: Boolean(req.query.authorization_code),
    hasCode: Boolean(req.query.code),
    hasState: Boolean(req.query.state),
    redirectUriHash: shortHash(redirectUriOf(req))
  })
  if (!code) {
    return res.status(400).send(page('授权失败', '<p>回调里没有授权码，流程终止（未尝试换取 Token）。</p>'))
  }
  sweep()
  // 官方 OAuth 回调在部分环境可能不回传 state；有 state 时必须命中一次性缓存，
  // 无 state 时继续按授权码换 token，避免真实登录被官方回调差异卡死。
  const state = String(req.query.state || '')
  if (state && !states.has(state)) {
    return res.status(400).send(page('授权失败', '<p>state 校验未通过（可能已过期或非本站发起），请重新登录。</p>'))
  }
  if (state) states.delete(state)  // 一次性
  try {
    const body = new URLSearchParams({
      app_id: APP_ID,
      app_key: APP_KEY,
      grant_type: 'authorization_code',
      redirect_uri: redirectUriOf(req),
      code: String(code)
    })
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15_000)
    })
    const j = await r.json().catch(() => ({}))
    // 成功以响应含 access_token 为准（业务码可能用 20000 表示成功，不作为失败依据）
    if (!r.ok || typeof j.access_token !== 'string' || !j.access_token) {
      console.error('[auth] token 交换失败：', {
        httpStatus: r.status,
        code: j.code ?? j.Code ?? null,
        message: j.message ?? j.Message ?? null
      })
      return res.status(502).send(page('登录失败', `<p>换取知乎授权令牌失败（HTTP ${r.status}）。请查看服务端日志中的脱敏错误码。</p>`))
    }
    setUserSession(res, j.access_token, Number(j.expires_in))
    res.redirect('/')
  } catch (err) {
    console.error('[auth] token 交换异常：', err.message)
    res.status(502).send(page('登录失败', '<p>与知乎的网络通信失败，请稍后重试。</p>'))
  }
})

// 登录态查询（前端启动静默调用；不回传 token 本体）
authRouter.get('/status', (req, res) => {
  const s = sessionOf(req)
  res.json({
    configured: oauthConfigured(),
    loggedIn: Boolean(s),
    expiresIn: s ? Math.max(0, Math.floor((s.expiresAt - Date.now()) / 1000)) : 0,
    redirectUri: oauthConfigured() ? redirectUriOf(req) : ''
  })
})

// 安全诊断：只返回授权参数形态与脱敏指纹，不返回 app_key / token / Access Secret。
authRouter.get('/diagnostics', (req, res) => {
  const diag = redirectDiagnostics(req)
  res.json({
    configured: oauthConfigured(),
    appIdConfigured: Boolean(APP_ID),
    appKeyConfigured: Boolean(APP_KEY),
    appIdLength: APP_ID.length,
    appIdHash: APP_ID ? shortHash(APP_ID) : '',
    ...diag,
    authorize: {
      host: new URL(AUTHORIZE_URL).host,
      responseType: 'code',
      stateSent: !STATE_DISABLED_FOR_HACKATHON
    },
    stateDisabledForHackathon: STATE_DISABLED_FOR_HACKATHON
  })
})

// 退出：清会话 + 失效 cookie
authRouter.post('/logout', (req, res) => {
  const sid = cookieOf(req, 'zsid')
  if (sid) sessions.delete(sid)
  res.setHeader('Set-Cookie', 'zsid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')
  res.json({ ok: true })
})
