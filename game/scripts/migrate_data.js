// 数据迁移：数据资产/（单一来源）→ game/shared/stories/main/（内置主线槽位）
// 幂等可重跑；每次重跑以 数据资产/ 为准覆盖 main 槽位
// 产出：
//   shared/stories/main/story.json          —— 从故事 md 段落化（p01...，含章节）
//   shared/stories/main/characters/*.json   —— 角色卡 + stage/break_stage/public_profile
//   shared/stories/main/evidence.json       —— 证据注册表 + paraIds 锚点 + brief 摘要
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')        // game/
const SRC = path.resolve(ROOT, '../数据资产')
const SHARED = path.join(ROOT, 'shared/stories/main')

/* ---------- 迁移配置（人工维护的映射表） ---------- */

const TITLE = '她从不下厨'
const SUMMARY = '林晚，32 岁。9 月 14 日晚十点前后，从自家十四楼阳台坠楼身亡。警方依据其半年的抑郁病史、齐全的药物，以及从里面反锁的阳台门，认定自杀。丈夫陈默深情守候，婆婆周兰从质疑走向"和解"。三个月过去，这个家看起来正在愈合。但有三个人，没说实话。'

// 证据 → 原文段落锚点（paraId 从 p01 连续编号）
const ANCHORS = {
  ev1_fish_dish: ['p03', 'p04', 'p69'],
  ev1_kitchen: ['p30', 'p31'],
  ev1_ribs: ['p27', 'p32'],
  ev2_pills: ['p48', 'p49', 'p50'],
  ev2_dali: ['p34', 'p35', 'p36'],
  ev2_escape_prep: ['p17', 'p20', 'p47'],
  ev3_pocket: ['p37', 'p38', 'p39'],
  ev3_house: ['p60', 'p61'],
  ev3_deal: ['p62', 'p65'],
  evx_key: ['p07', 'p09', 'p10', 'p11', 'p12'],
  evx_orchid: ['p52', 'p53']
}

// 锚点自检关键词（防止 md 段落增删导致锚点漂移）
const ANCHOR_KEYWORDS = {
  ev1_fish_dish: '鳜鱼', ev1_kitchen: '滤网', ev1_ribs: '两大碗',
  ev2_pills: '舍曲林', ev2_dali: '收据', ev2_escape_prep: '饺子',
  ev3_pocket: '口袋', ev3_house: '房产过户', ev3_deal: '别再问了',
  evx_key: '反锁', evx_orchid: '兰花'
}

// 证据展示摘要（S1/证据板用）
const BRIEFS = {
  ev1_fish_dish: '晚晚最后一条朋友圈：一桌菜，松鼠鳜鱼装在黑陶盘里。配文：好日子。',
  evx_key: '阳台门从里面反锁。锁坏了要用钥匙——钥匙两把，一把在陈默车钥匙串上。',
  ev1_kitchen: '滤网无油、垃圾桶空、排骨冻硬——那晚的厨房干净得反常。',
  ev1_ribs: '「她吃了两大碗糖醋排骨」× 冰箱里冻硬的排骨。',
  ev2_pills: '梳妆台上的舍曲林，倒出来数了数，一片没少。',
  ev2_dali: '大理客栈的两千元定金，出事前三天交的。照片背面写着：十二月。',
  ev2_escape_prep: '她在学包饺子，问「一个人带孩子难吗」；小雅说「不该挂她电话」。',
  ev3_pocket: '婆婆把收据放进了自己口袋，没告诉陈默。「我说不清为什么。」',
  ev3_house: '房产过户，新证上是婆婆的名字。',
  ev3_deal: '「只求你一件事——晚晚的事，别再问了。」她收起了那张收据。',
  evx_orchid: '葬礼上晚晚父亲提到托付的兰花，陈默的手抖了一下。'
}

const STARTING_EVIDENCE = ['ev1_fish_dish', 'evx_key']

// 触发器别名归一（角色卡 visibility 里的旧写法 → 注册表正式 id）
const TRIGGER_ALIASES = { ev1_fish: 'ev1_fish_dish' }

// 人物公开档案（S1 展示，不含剧透；opening 为审讯室开场白）
const PUBLIC_PROFILES = {
  chenmo: {
    name: '陈　默', relation: '丈夫 · 38 岁',
    blurb: '克制、体面、疲惫。烟点着，不抽。口供滴水不漏。',
    opening: '（他坐下，把烟盒放在桌上，看了你一眼）你们想问什么。我配合。'
  },
  zhoulan: {
    name: '周　兰', relation: '婆婆 · 64 岁',
    blurb: '叙述者。絮叨，细节记得过分清楚。什么都愿意说——除了她自己的事。',
    opening: '（她给你倒了杯水，手有点抖）孩子，你想问什么就问。这事我憋了三个月，跟谁都没法说。'
  },
  xiaoya: {
    name: '小　雅', relation: '晚晚的闺蜜 · 27 岁',
    blurb: '黑眼圈很重。手机屏幕朝下扣着。"说出来，晚晚就真的没了。"',
    opening: '（她抱着一杯没喝的水，看了你一眼）你们是警察？警察我见过了。'
  }
}

// 谎言的撬破阶段（对应 unlock_map 的 U 层级）
const LIE_BREAK_STAGE = {
  chenmo: { lie_dinner: 1, lie_love: 3, lie_alibi: 4 },
  zhoulan: { lie_unclear: 2, lie_house: 2 },
  xiaoya: { lie_noplan: 2, lie_hungup_full: 3 }
}

// 解锁触发器（unlock_map 的机器可读版；未列出的最深层=仅对峙可解，P3 接入）
// 语义：stage N 的条件满足（any=任一出示 / all=全部出示）时推进到 N
const UNLOCK_TRIGGERS = {
  chenmo: {
    1: { any: ['ev1_kitchen', 'ev1_ribs'] },   // 厨房物证 → 承认外卖
    2: { any: ['ev1_fish_dish'] },              // 鳜鱼图 → 供出见过那桌外卖
    3: { any: ['ev2_pills'] }                   // 舍曲林 → 撕掉病危叙事
    // U4 = 终局对峙（P3），不出示证据可解
  },
  zhoulan: {
    1: { any: ['ev2_escape_prep'] }
    // U2 = 对峙自白（P3）
  },
  xiaoya: {
    1: { any: ['ev2_pills'] },
    2: { any: ['ev2_dali', 'ev2_escape_prep'] },
    3: { any: ['tsm_phone'] }                   // 需 P2 钉口供跨角色传递
  }
}

/* ---------- 工具 ---------- */
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf-8'))
const writeJson = (p, data) => {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

// visibility 字符串 → 解锁阶段；特殊触发（需出示证据）单独标记
function parseVisibility(visibility) {
  const v = String(visibility)
  if (v.includes('终局台词')) return { stage: 4, triggerEvidence: null }
  if (v.includes('压力下漏出')) return { stage: 3, triggerEvidence: null }
  if (v.includes('合作给出')) return { stage: 0, triggerEvidence: null }
  if (v.includes('需出示')) {
    const triggers = (v.match(/ev\w+/g) || []).map(t => TRIGGER_ALIASES[t] || t)
    return { stage: 0, triggerEvidence: triggers }
  }
  const m = v.match(/U(\d)/)
  return { stage: m ? Number(m[1]) : 0, triggerEvidence: null }
}

/* ---------- 1. 故事段落化 ---------- */
function migrateStory() {
  const md = fs.readFileSync(path.join(SRC, '她从不下厨_故事与伏笔表.md'), 'utf-8')
  const lines = md.split(/\r?\n/)
  const paras = []
  let chapter = ''
  let inStory = false
  for (const line of lines) {
    if (line.startsWith('## 一、')) { inStory = true; continue }
    if (line.startsWith('## 二、')) break
    if (!inStory) continue
    const ch = line.match(/^\*\*（(.+?)）\*\*$/)
    if (ch) { chapter = `（${ch[1]}）`; continue }
    const text = line.trim()
    if (!text || text.startsWith('---')) continue
    paras.push({ id: `p${String(paras.length + 1).padStart(2, '0')}`, chapter, text })
  }
  if (paras.length < 60) throw new Error(`故事段落异常：仅解析到 ${paras.length} 段（预期约 79）`)
  writeJson(path.join(SHARED, 'story.json'), { title: TITLE, summary: SUMMARY, paras })
  return paras
}

/* ---------- 2. 角色卡 ---------- */
function migrateCharacters() {
  const files = { chenmo: '角色卡_陈默.json', zhoulan: '角色卡_周兰.json', xiaoya: '角色卡_小雅.json' }
  const summary = []
  for (const [id, file] of Object.entries(files)) {
    const card = readJson(path.join(SRC, file))
    if (card.character_id !== id) throw new Error(`${file} character_id 不匹配：${card.character_id}`)
    // knows → stage / triggerEvidence（卡内位于 knowledge.knows，扁平化到顶层供 prompts.js 使用）
    const knows = card.knowledge.knows.map(k => {
      const { stage, triggerEvidence } = parseVisibility(k.visibility)
      return { ...k, stage, ...(triggerEvidence ? { triggerEvidence } : {}) }
    })
    // lies → break_stage
    const lies = card.lies.map(l => ({
      ...l,
      break_stage: LIE_BREAK_STAGE[id][l.id] ?? null
    })).filter(l => {
      if (l.break_stage === null) throw new Error(`${id} 的谎言 ${l.id} 缺少 break_stage 映射`)
      return true
    })
    const out = {
      ...card,
      knows,
      does_not_know: card.knowledge.does_not_know,
      never_confirms: card.knowledge.never_confirms ?? null,
      lies,
      unlock_triggers: UNLOCK_TRIGGERS[id],
      public_profile: PUBLIC_PROFILES[id]
    }
    writeJson(path.join(SHARED, 'characters', `${id}.json`), out)
    const stageCount = {}
    knows.forEach(k => { stageCount[k.stage] = (stageCount[k.stage] || 0) + 1 })
    summary.push({ id, knows: knows.length, stage分布: stageCount, lies: lies.length })
  }
  return summary
}

/* ---------- 3. 证据注册表 ---------- */
function migrateEvidence(storyParas) {
  const registry = readJson(path.join(SRC, '证据注册表.json'))
  const byId = Object.fromEntries(storyParas.map(p => [p.id, p]))
  const evidences = registry.evidences.map(e => {
    const paraIds = ANCHORS[e.id]
    if (!paraIds) throw new Error(`证据 ${e.id} 缺少锚点映射`)
    for (const pid of paraIds) {
      if (!byId[pid]) throw new Error(`证据 ${e.id} 锚点 ${pid} 不存在于故事段落`)
    }
    // 关键词自检（锚点段落须含关键词，防止段落漂移；命中任一锚点即通过）
    const kw = ANCHOR_KEYWORDS[e.id]
    if (kw && !paraIds.some(pid => byId[pid].text.includes(kw))) {
      throw new Error(`证据 ${e.id} 锚点 ${paraIds.join(',')} 均未含关键词「${kw}」，疑似段落漂移`)
    }
    return { ...e, paraIds, brief: BRIEFS[e.id] }
  })
  if (evidences.length !== 11) throw new Error(`证据数量异常：${evidences.length}（预期 11）`)
  writeJson(path.join(SHARED, 'evidence.json'), {
    dark_lines: registry.dark_lines,
    starting_evidence: STARTING_EVIDENCE,
    evidences,
    contradiction_pairs: registry.contradiction_pairs,
    director_truth: registry.director_truth
  })
  return evidences.length
}

/* ---------- 主流程 ---------- */
const paras = migrateStory()
const charSummary = migrateCharacters()
const evCount = migrateEvidence(paras)

console.log('===== 迁移完成 =====')
console.log(`故事：${TITLE}，${paras.length} 段`)
console.log(`证据：${evCount} 条（起手 ${STARTING_EVIDENCE.length} 条），锚点关键词自检通过`)
console.log('角色：', JSON.stringify(charSummary, null, 2))
