import { create } from 'zustand'
import { fetchGame, streamInterrogate, fetchSuggestions, judgeQuote, judgeRelation, confrontCharacter, settleCase } from './api.js'

// 客户端游戏状态（服务端无状态；stage/shownEvidence/history 由客户端持有并随请求回传）
const cleanName = n => n.replace(/[　\s]/g, '')

const emptyChar = (profile) => ({
  stage: 0,
  shownEvidence: [],
  history: [{ who: cleanName(profile.name), text: profile.opening }],
  profile
})

// 一局游戏的全部可变状态（换故事槽位时整体重置）
const freshRun = () => ({
  chars: {},
  board: [],
  pins: [],
  chains: [],
  judgeBusy: false,
  judgeNote: null,
  stats: { questions: 0, shown: 0, pins: 0, contradictions: 0, confirms: 0, wrongAccuse: 0, hints: 0 },
  confronted: [],
  unlockedDLs: [],
  confrontData: null,
  confrontBusy: false,
  settleData: null,
  settleKey: '',
  degraded: false,
  usedHint: false,
  suggestions: null,
  streaming: false,
  lastProgressAt: Date.now(),
  hintsUsed: 0,
  activeHint: null
})

// 载入请求序号（竞态守卫：只有最新 loadGame 的结果能落地）
let loadSeq = 0

export const useGameStore = create((set, get) => ({
  game: null,
  loading: false,
  error: null,
  scene: 'tutorial',
  slotId: 'main',
  activeChar: null,
  // ---- P4 流水线 ----
  pipelineWorkId: null,  // 待侦探化的官方故事 work_id
  pipelineStartedAt: 0,  // 全流程计时起点（<10min 数据点）
  ...freshRun(),

  /** 载入故事槽位（main=内置主线；custom/{workId}=流水线产物）；整体重置一局状态。
   *  返回是否成功——竞态守卫：快速连点换故事时，只有最新请求的结果能落地 */
  loadGame: async (slotId = 'main') => {
    const seq = ++loadSeq
    set({ loading: true, error: null, slotId })
    try {
      const game = await fetchGame(slotId)
      if (seq !== loadSeq) return false  // 已被更新的载入请求取代，丢弃
      const chars = {}
      for (const p of game.characters) chars[p.id] = emptyChar(p)
      // 起手证据直接上板
      const board = game.startingEvidence.map(e => ({
        id: e.id, name: e.name, content: e.brief, tag: `${e.type} · 案卷起手`, kind: 'index',
        paras: e.paraIds || []  // 锚点段落：原文抽屉据此显示「已取证」角标（与划选发证一致）
      }))
      set({
        game, chars, board, loading: false,
        activeChar: game.characters[0]?.id || null,
        ...(() => { const { chars: _c, board: _b, ...rest } = freshRun(); return rest })()
      })
      return true
    } catch (e) {
      if (seq !== loadSeq) return false
      set({ error: e.message, loading: false })
      return false
    }
  },

  /** S0 → 流水线：把官方故事送去侦探化 */
  openPipeline: (workId) => set({ pipelineWorkId: workId, pipelineStartedAt: Date.now(), scene: 'pipeline' }),

  /** 流水线确认后进入游戏（先经故事结尾页——design.md ch10 阶段 0 情绪转场） */
  enterGame: async (slotId) => {
    const ok = await get().loadGame(slotId)
    if (ok) set({ scene: 'opening' })
  },

  setScene: scene => set({ scene }),
  setActiveChar: id => set({ activeChar: id, suggestions: null }),

  // 盘问/出示共用的一条 SSE 流水线；返回是否完整收到 done（流中断=false）
  _runStream: async (payload, charId, questionText) => {
    const c = get().chars[charId]
    const history = [...c.history, { who: '侦探', text: questionText }]
    set(state => ({
      streaming: true,
      suggestions: null,
      chars: {
        ...state.chars,
        [charId]: { ...c, history: [...history, { who: cleanName(c.profile.name), text: '' }] }
      }
    }))
    let completed = false
    try {
      for await (const ev of streamInterrogate(payload)) {
        if (ev.type === 'degraded') set({ degraded: true })
        if (ev.type === 'error') {
          set(state => {
            const cc = state.chars[charId]
            return {
              chars: {
                ...state.chars,
                [charId]: { ...cc, history: [...cc.history, { who: '系统', text: ev.message }] }
              }
            }
          })
        }
        if (ev.type === 'delta') {
          set(state => {
            const cc = state.chars[charId]
            const hist = cc.history.slice()
            const last = hist[hist.length - 1]
            hist[hist.length - 1] = { ...last, text: last.text + ev.text }
            return { chars: { ...state.chars, [charId]: { ...cc, history: hist } } }
          })
        }
        if (ev.type === 'done') {
          completed = true
          set(state => {
            const cc = state.chars[charId]
            const hist = cc.history.slice()
            const last = hist[hist.length - 1]
            hist[hist.length - 1] = { ...last, shaken: ev.stateMark === '动摇' }
            const progressed = (ev.stage ?? cc.stage) > cc.stage
            return {
              chars: { ...state.chars, [charId]: { ...cc, history: hist, stage: ev.stage ?? cc.stage } },
              streaming: false,
              ...(progressed ? { lastProgressAt: Date.now() } : {})
            }
          })
        }
      }
    } catch (e) {
      set(state => {
        const cc = state.chars[charId]
        return {
          chars: {
            ...state.chars,
            [charId]: { ...cc, history: [...cc.history, { who: '系统', text: `连接中断：${e.message}` }] }
          }
        }
      })
    }
    if (get().streaming) set({ streaming: false })
    return completed
  },

  ask: async (question) => {
    const { activeChar, chars, streaming, slotId } = get()
    if (streaming || !question.trim()) return
    const c = chars[activeChar]
    set(s => ({ stats: { ...s.stats, questions: s.stats.questions + 1 } }))
    await get()._runStream(
      { slotId, characterId: activeChar, question, history: c.history, shownEvidence: c.shownEvidence, stage: c.stage },
      activeChar, question
    )
  },

  showEvidence: async (evidenceId) => {
    const { activeChar, chars, streaming, board, slotId } = get()
    if (streaming) return
    const c = chars[activeChar]
    if (c.shownEvidence.some(e => e.id === evidenceId)) return
    const ev = board.find(e => e.id === evidenceId)  // 板上任意卡（物证/划选发证/钉的口供）均可出示
    if (!ev) return
    const ok = await get()._runStream(
      {
        slotId, characterId: activeChar, showEvidenceId: evidenceId,
        showCard: { id: ev.id, name: ev.name, content: ev.content },  // 钉卡信息随请求下发（服务端做台词解析）
        history: c.history, shownEvidence: c.shownEvidence, stage: c.stage
      },
      activeChar, `〔出示${ev.kind === 'note' ? '口供' : '物证'}〕${ev.name}`
    )
    // 仅当回合完整结束（done）才计入已出示，流中断不记——保证重试时角色仍会反应
    if (!ok) return
    set(state => {
      const cc = state.chars[activeChar]
      if (cc.shownEvidence.some(e => e.id === evidenceId)) return {}
      return {
        chars: { ...state.chars, [activeChar]: { ...cc, shownEvidence: [...cc.shownEvidence, { id: evidenceId, name: ev.name, brief: ev.content }] } },
        stats: { ...state.stats, shown: state.stats.shown + 1 },
        lastProgressAt: Date.now()
      }
    })
  },

  loadSuggestions: async () => {
    const { activeChar, chars, streaming, slotId, board } = get()
    if (streaming) return
    const c = chars[activeChar]
    set({ suggestions: null })  // 切换/重开时清旧引导
    try {
      const r = await fetchSuggestions(
        activeChar, c.history,
        board.map(b => b.name),  // 板上证据名称（导师引导的素材）
        slotId
      )
      if (r.degraded) set({ degraded: true })
      // 竞态防护：仅当用户仍停留在同一角色时才应用引导
      if (get().activeChar !== activeChar) return
      set({ suggestions: r.guidance, usedHint: true })
    } catch {
      if (get().activeChar === activeChar) set({ suggestions: null })
    }
  },

  // ==================== P2 证据系统 ====================

  /** 钉口供：任意角色回答上板（忠实原话，不改写；同一句不重复钉） */
  pinTestimony: (charId, entry) => {
    if (!entry || !entry.text?.trim()) return
    // 稳定键：角色 + 原话内容（同句重钉直接跳过）
    const pinKey = `pin_${charId}_${entry.text}`
    if (get().pins.includes(pinKey)) { set({ judgeNote: '这句话已经钉过了' }); return }
    const card = {
      id: pinKey,
      name: `「${entry.text.length > 18 ? entry.text.slice(0, 18) + '……' : entry.text.replace(/^[（(].*?[)）]/, '').trim()}」`,
      content: entry.text,   // 完整原话，供关联判定
      tag: `口供 · ${cleanName(get().chars[charId].profile.name)}`,
      kind: 'note'
    }
    set(state => ({
      board: [...state.board, card],
      pins: [...state.pins, pinKey],
      stats: { ...state.stats, pins: state.stats.pins + 1 },
      lastProgressAt: Date.now()
    }))
  },

  /** 原文划选「以此为证」 */
  submitQuote: async (paraId, selectedText) => {
    const { activeChar, judgeBusy, board, slotId } = get()
    if (judgeBusy) return
    set({ judgeBusy: true, judgeNote: null })
    try {
      const r = await judgeQuote(activeChar, paraId, selectedText, slotId)
      if (r.degraded) set({ degraded: true })
      if (r.relevant && r.evidence) {
        // 发证：锚点命中的注册证据（去重）
        if (!board.some(c => c.id === r.evidence.id)) {
          const e = r.evidence
          set(state => ({
            board: [...state.board, {
              id: e.id, name: e.name, content: e.brief, tag: `${e.type} · 原文`, kind: 'index',
              paras: e.paraIds || []  // 锚点段落：原文抽屉据此显示「已取证」角标
            }],
            judgeNote: `⚡ 命中伏笔：「${e.name}」已钉上证据板`,
            lastProgressAt: Date.now()
          }))
        } else {
          set({ judgeNote: '这张证据已经在板上了' })
        }
      } else {
        set({ judgeNote: r.reaction ? `他说：「${r.reaction}」——这条似乎不算证据` : '这条似乎不算证据' })
      }
    } catch (e) {
      set({ judgeNote: `判定失败：${e.message}` })
    } finally {
      set({ judgeBusy: false })
    }
  },

  /** 证据板两卡关联（fast-path 在服务端） */
  judgePair: async (cardA, cardB) => {
    const { chains, judgeBusy, slotId } = get()
    if (judgeBusy) return
    const exists = chains.some(c => (c.a === cardA.id && c.b === cardB.id) || (c.a === cardB.id && c.b === cardA.id))
    if (exists) { set({ judgeNote: '这两张已经关联过了' }); return }
    set({ judgeBusy: true, judgeNote: '正在比对两张卡片……' })
    try {
      const r = await judgeRelation(
        { id: cardA.id, name: cardA.name, tag: cardA.tag, content: cardA.content },
        { id: cardB.id, name: cardB.name, tag: cardB.tag, content: cardB.content },
        chains.map(c => ({ a: c.a, b: c.b, verdict: c.verdict })),
        slotId
      )
      if (r.mode === 'fallback') set({ degraded: true })
      if (r.verdict === '无关') {
        set({ judgeNote: r.note || '两张卡片没有明显关联' })
      } else {
        set(state => ({
          chains: [...state.chains, {
            a: cardA.id, b: cardB.id, aName: cardA.name, bName: cardB.name,
            verdict: r.verdict, darkLine: r.darkLine, note: r.note
          }],
          stats: {
            ...state.stats,
            contradictions: state.stats.contradictions + (r.verdict === '矛盾' ? 1 : 0),
            confirms: state.stats.confirms + (r.verdict === '印证' ? 1 : 0)
          },
          judgeNote: r.verdict === '矛盾'
            ? `⚡ 矛盾成立！「${cardA.name}」与「${cardB.name}」对不上`
            : `✓ 印证成立：「${cardA.name}」与「${cardB.name}」互相支持`,
          lastProgressAt: Date.now()
        }))
      }
    } catch (e) {
      set({ judgeNote: `判定失败：${e.message}` })
    } finally {
      set({ judgeBusy: false })
    }
  },

  // ==================== P3 对峙与结算 ====================

  /** 发起对峙：资格不足 → 冤枉机制（reject 演出 + 计数）；通过 → S4 verbatim 演出 */
  confront: async (charId) => {
    const { chars, chains, confronted, confrontBusy, slotId } = get()
    if (confrontBusy || confronted.includes(charId)) return
    const c = chars[charId]
    set({ confrontBusy: true })
    try {
      const r = await confrontCharacter(charId, chains, c.stage, slotId)
      const name = cleanName(c.profile.name)
      if (!r.ok) {
        set(s => ({
          confrontData: { characterId: charId, name, ok: false, reject: r.reject },
          stats: { ...s.stats, wrongAccuse: s.stats.wrongAccuse + 1 },
          scene: 's4'
        }))
        return
      }
      const dl = r.darkLine
      set(s => ({
        confrontData: { characterId: charId, name, ok: true, beats: r.beats, darkLine: dl },
        confronted: [...s.confronted, charId],
        unlockedDLs: s.unlockedDLs.includes(dl) ? s.unlockedDLs : [...s.unlockedDLs, dl],
        lastProgressAt: Date.now(),
        scene: 's4'
      }))
    } catch (e) {
      set({ judgeNote: `对峙失败：${e.message}` })
    } finally {
      set({ confrontBusy: false })
    }
  },

  /** 结案：stats + unlockedDLs → 服务端暗线全文/原文坐标/评语（新解锁后重算，不吐旧缓存） */
  settle: async () => {
    const key = [...get().unlockedDLs].sort().join(',')
    if (get().settleData && get().settleKey === key) { set({ scene: 's5' }); return }
    try {
      const { stats, unlockedDLs, usedHint, slotId } = get()
      const r = await settleCase({ ...stats, usedHint }, unlockedDLs, slotId)
      if (r.degraded) set({ degraded: true })
      set({ settleData: r, settleKey: key, scene: 's5' })
    } catch (e) {
      set({ judgeNote: `结案失败：${e.message}` })
    }
  },

  // ==================== P3 导演线头（T3.4b：3 分钟无进展规则化） ====================

  /** 由 App 层定时器调用：卡关超时浮出一根线头（上限 3；消耗无提示通关资格） */
  maybeHint: () => {
    const s = get()
    if (s.activeHint || s.hintsUsed >= 3) return
    if (Date.now() - s.lastProgressAt < 180000) return  // 未到 3 分钟
    const hint = pickHint(s)
    if (!hint) return
    set({
      activeHint: hint,
      hintsUsed: s.hintsUsed + 1,
      usedHint: true,
      stats: { ...s.stats, hints: s.stats.hints + 1 },
      lastProgressAt: Date.now()  // 重置计时，避免连环弹
    })
  },

  dismissHint: () => set({ activeHint: null }),

  clearJudgeNote: () => set({ judgeNote: null }),

  /** 证据板：移动卡片（自由拖拽的落点持久化；会话内有效，新卡从 0 偏移开始） */
  moveBoardCard: (id, dx, dy) => set(state => ({
    board: state.board.map(c => c.id === id ? { ...c, pos: { dx, dy } } : c)
  }))
}))

// 线头文案按当前进度优先级挑选（规则化，不调 LLM）；主线用精调文案，其余槽位用通用文案
function pickHint(s) {
  const hasPin = s.board.some(c => c.kind === 'note')
  const hasChain = s.chains.length > 0
  if (s.slotId === 'main') {
    const xiaoyaReady = s.chars.xiaoya?.stage >= 3
    if (!hasPin) return '线头：先钉一张口供——问问陈默那晚的晚饭，把他的回答📌钉上证据板'
    if (!hasChain) return '线头：证据板上，把陈默的「那顿晚饭」和厨房里的物证放在一起试试'
    if (!xiaoyaReady && !s.unlockedDLs.includes('DL2')) return '线头：陈默好像提过「她总锁着门打电话」——把这句话拿去问问小雅'
    if (!s.unlockedDLs.includes('DL3')) return '线头：周兰什么都愿意说，除了她自己的事——过户的房子，去原文里翻一翻'
    return '线头：翻翻案卷原文，划选你觉得不对劲的句子'
  }
  const firstName = cleanName(s.game?.characters?.[0]?.name || '他')
  if (!hasPin) return `线头：先钉一张口供——把${firstName}的回答📌钉上证据板`
  if (!hasChain) return '线头：证据板上，把两张对不上的卡片放在一起试试'
  return '线头：翻翻案卷原文，划选你觉得不对劲的句子'
}
