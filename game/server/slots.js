// 故事槽位（slot）加载器：main = shared/stories/main（内置主线），custom = shared/custom/{slotId}（流水线产物）
// 内存缓存；文件即数据库（无 DB 选型），confirm 落盘后需重载对应槽位
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SHARED = path.resolve(__dirname, '../shared')

// slotId 白名单：main 或纯字母数字下划线（官方 work_id 为纯数字）
const SLOT_RE = /^[A-Za-z0-9_-]{1,64}$/
const cache = new Map()

export function slotDir(slotId = 'main') {
  if (slotId === 'main') return path.join(SHARED, 'stories/main')
  if (!SLOT_RE.test(slotId)) throw new Error(`非法槽位 id：${slotId}`)
  return path.join(SHARED, 'custom', slotId)
}

export function slotExists(slotId) {
  try { return fs.existsSync(path.join(slotDir(slotId), 'story.json')) } catch { return false }
}

/** 加载槽位（缓存）：{ slotId, story, registry, cards:{id:card}, order:[characterId], meta } */
export function loadSlot(slotId = 'main') {
  if (cache.has(slotId)) return cache.get(slotId)
  const dir = slotDir(slotId)
  const story = readJson(path.join(dir, 'story.json'))
  const registry = readJson(path.join(dir, 'evidence.json'))
  const charsDir = path.join(dir, 'characters')
  const cards = {}
  for (const f of fs.readdirSync(charsDir).filter(f => f.endsWith('.json'))) {
    const card = readJson(path.join(charsDir, f))
    cards[card.character_id] = card
  }
  const order = Object.keys(cards)
  if (!order.length) throw new Error(`槽位 ${slotId} 无角色卡`)
  const meta = fs.existsSync(path.join(dir, 'meta.json'))
    ? readJson(path.join(dir, 'meta.json'))
    : { author_name: '', source_label: '未知来源' }
  const slot = { slotId, story, registry, cards, order, meta }
  cache.set(slotId, slot)
  return slot
}

/** 流水线 confirm 落盘后重载 */
export function reloadSlot(slotId) {
  cache.delete(slotId)
  return loadSlot(slotId)
}

export function listCustomSlots() {
  const dir = path.join(SHARED, 'custom')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(id => slotExists(id))
}

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf-8')) }
