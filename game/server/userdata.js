import { sessionOf } from './auth.js'
import { fetchOfficialList } from './pipeline.js'

// 知乎用户数据 API（references/user-api.md）：代表已授权用户读取其公开收藏。
// 鉴权三件套：Bearer <开放平台 Access Secret> + X-OAuth-Token <用户 OAuth token> + 秒级时间戳（无签名）。
// App Key 不参与这里的任何 Header（官方明确）。
const DEV_BASE = 'https://developer.zhihu.com'
const ACCESS_SECRET = process.env.ZHIHU_ACCESS_SECRET || ''

export const userdataConfigured = () => Boolean(ACCESS_SECRET)

class DevApiError extends Error {
  constructor(message, status) { super(message); this.status = status }
}

async function devGet(path, token, query = {}) {
  const url = new URL(path, DEV_BASE)
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v))
  let r
  try {
    r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${ACCESS_SECRET}`,
        'X-OAuth-Token': token,
        'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(15_000)
    })
  } catch (err) {
    throw new DevApiError('与知乎开放平台的网络通信失败', 502)
  }
  const j = await r.json().catch(() => ({}))
  if (r.status === 401 || j.Code === 20001) throw new DevApiError('知乎授权已过期，请重新登录', 401)
  if (j.Code !== 0 || !j.Data) throw new DevApiError(j.Message || `用户数据接口错误（HTTP ${r.status}）`, 502)
  return j.Data
}

/** 拉取用户收藏：近期收藏 + 前 3 个收藏夹的内容（控制调用量），按 Url 去重合并 */
async function fetchAllFavorites(token) {
  const merged = new Map()  // url → item
  const push = items => (items || []).forEach(it => { if (it.Url) merged.set(it.Url, it) })
  const recent = await devGet('/api/v1/user/collections', token, { Limit: 50 })
  push(recent.Items)
  try {
    const lists = await devGet('/api/v1/user/favlists', token, { Limit: 50 })
    for (const list of (lists.Items || []).slice(0, 3)) {
      try {
        const c = await devGet('/api/v1/user/favlist_contents', token, { FavlistUrlToken: list.UrlToken, Limit: 50 })
        push(c.Items)
      } catch (err) {
        if (err.status === 401) throw err  // 授权问题直接上抛，其余收藏夹失败可容忍
      }
    }
  } catch (err) {
    if (err.status === 401) throw err  // favlists 本身失败仅意味着收藏夹部分缺失，近期收藏仍可用
  }
  return [...merged.values()]
}

// 官方故事列表缓存（10 分钟）：匹配用途的重复读取不额外打内容接口
let listCache = { at: 0, stories: null }
async function officialStories() {
  if (listCache.stories && Date.now() - listCache.at < 10 * 60 * 1000) return listCache.stories
  const stories = await fetchOfficialList()
  listCache = { at: Date.now(), stories }
  return stories
}

// 我的案源结果缓存（5 分钟/会话）：官方要求应用层缓存与去重
const casesCache = new Map()  // token → { at, payload }
const CASES_TTL_MS = 5 * 60 * 1000

/**
 * GET /api/me/cases：登录用户的收藏 × 官方故事库 交叉匹配。
 * 返回 matched（确定可侦探化：ID 或标题命中官方库）+ others（未命中条目，前端提供「尝试侦探化」兜底）。
 */
export async function myCasesHandler(req, res) {
  const session = sessionOf(req)
  if (!session) return res.status(401).json({ error: '未登录或登录已过期' })
  if (!userdataConfigured()) return res.status(503).json({ error: '服务端未配置 Access Secret' })

  const cached = casesCache.get(session.token)
  if (cached && Date.now() - cached.at < CASES_TTL_MS) return res.json(cached.payload)

  let favorites
  try {
    favorites = await fetchAllFavorites(session.token)
  } catch (err) {
    if (err.status === 401) return res.status(401).json({ error: err.message })
    console.error('[me/cases] 收藏拉取失败：', err.message)
    return res.status(err.status || 502).json({ error: err.message })
  }

  let stories
  try {
    stories = await officialStories()
  } catch (err) {
    console.error('[me/cases] 官方列表失败：', err.message)
    return res.status(err.status || 502).json({ error: `官方故事列表不可用：${err.message}` })
  }

  // 匹配：work_id == 收藏条目 UrlToken（字符串比较，避免 Int64 精度问题）或标题完全相等
  const byId = new Map(), byTitle = new Map()
  for (const s of stories) {
    byId.set(String(s.work_id), s)
    byTitle.set(String(s.title || '').trim(), s)
  }
  const matched = new Map()  // workId → story
  const others = []
  for (const f of favorites) {
    const id = String(f.UrlToken ?? '')
    const byIdHit = byId.get(id)
    const byTitleHit = byTitle.get(String(f.Title || '').trim())
    if (byIdHit || byTitleHit) {
      const s = byIdHit || byTitleHit
      if (!matched.has(String(s.work_id))) {
        matched.set(String(s.work_id), {
          workId: String(s.work_id), title: s.title, labels: s.labels || [],
          artwork: s.artwork || '', description: s.description || '', source: '收藏'
        })
      }
    } else if (others.length < 10) {
      others.push({ id, title: f.Title || '（无标题）', contentType: f.ContentType || '', url: f.Url || '' })
    }
  }

  const payload = {
    matched: [...matched.values()],
    others,
    favoriteTotal: favorites.length,
    fetchedAt: Date.now()
  }
  casesCache.set(session.token, { at: Date.now(), payload })
  res.json(payload)
}