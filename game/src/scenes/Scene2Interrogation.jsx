import { useEffect, useRef, useState } from 'react'
import { useGameStore } from '../store.js'
import StoryDrawer from '../components/StoryDrawer.jsx'

const cleanName = n => n.replace(/[　\s]/g, '')

export default function Scene2Interrogation() {
  const game = useGameStore(s => s.game)
  const chars = useGameStore(s => s.chars)
  const activeChar = useGameStore(s => s.activeChar)
  const setActiveChar = useGameStore(s => s.setActiveChar)
  const streaming = useGameStore(s => s.streaming)
  const degraded = useGameStore(s => s.degraded)
  const suggestions = useGameStore(s => s.suggestions)
  const usedHint = useGameStore(s => s.usedHint)
  const ask = useGameStore(s => s.ask)
  const showEvidence = useGameStore(s => s.showEvidence)
  const loadSuggestions = useGameStore(s => s.loadSuggestions)
  const setScene = useGameStore(s => s.setScene)
  const pinTestimony = useGameStore(s => s.pinTestimony)
  const judgeNote = useGameStore(s => s.judgeNote)
  const board = useGameStore(s => s.board)
  const chains = useGameStore(s => s.chains)
  const confronted = useGameStore(s => s.confronted)
  const unlockedDLs = useGameStore(s => s.unlockedDLs)
  const activeHint = useGameStore(s => s.activeHint)
  const dismissHint = useGameStore(s => s.dismissHint)
  const confront = useGameStore(s => s.confront)
  const settle = useGameStore(s => s.settle)

  const [input, setInput] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [hintLoading, setHintLoading] = useState(false)   // 导师便签请求中
  const [mentorClosed, setMentorClosed] = useState(false) // 用户手动收起便签
  const logRef = useRef(null)

  const c = chars[activeChar]

  // 导师便签：点开（重置关闭态）→ loading → store 拉取引导文字
  const openMentor = async () => {
    if (streaming) return
    setMentorClosed(false)
    setHintLoading(true)
    try { await loadSuggestions() } finally { setHintLoading(false) }
  }

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [c])

  if (!c) return null

  const send = () => {
    const q = input.trim()
    if (q && !streaming) { ask(q); setInput('') }
  }

  // 最后一条 NPC 回答可钉（有实文、非系统消息）
  const lastAnswers = c.history.filter(h => h.who !== '侦探' && h.who !== '系统' && h.text?.trim())
  const lastAnswer = lastAnswers[lastAnswers.length - 1]

  // 对峙资格（与服务端 confrontReady 同规则，规则来自角色卡 confront_rule）
  const rule = game.characters.find(ch => ch.id === activeChar)?.confrontRule
  const confrontReadyLocal = !rule ? false
    : rule.type === 'stage' ? c.stage >= (rule.minStage ?? 3)
      : chains.some(ch => ch.verdict === '矛盾' && ch.darkLine === rule.darkLine)
  const alreadyConfronted = confronted.includes(activeChar)

  return (
    <div className="scene on" id="s2">
      <div className="topbar">
        <div className="t">{game.story.title}<small>审讯室</small></div>
        <div className="top-actions">
          {degraded && <div className="chip degraded">离线剧本模式</div>}
          <button className="navbtn" onClick={() => setHelpOpen(true)}>玩法说明</button>
          <button className="navbtn" onClick={() => setDrawerOpen(true)}>案卷原文</button>
          <button className="navbtn" onClick={() => setScene('s3')}>证据板（{board.length}）</button>
        </div>
      </div>

      <div className="guide">
        {activeHint
          ? <span className="hint-line">{activeHint}<button type="button" className="hint-x" onClick={dismissHint}>×</button></span>
          : judgeNote || <>自由提问 · 出示证据可撬动口供 · 回答旁 📌 可钉上证据板 · 「需要思路？」{usedHint ? '（已使用）' : '（会消耗无提示通关标记）'}</>}
        {unlockedDLs.length > 0 && <button type="button" className="settle-link" onClick={() => settle()}>结案（{unlockedDLs.length}/{game.darklineTotal}）→</button>}
      </div>

      <div className="itop">
        {game.characters.map(ch => {
          const cc = chars[ch.id]
          const shownCount = cc ? cc.shownEvidence.length : 0
          return (
            <button key={ch.id}
                 type="button"
                 className={`ctab ${activeChar === ch.id ? 'cur' : ''}`}
                 aria-pressed={activeChar === ch.id}
                 onClick={() => !streaming && setActiveChar(ch.id)}
                 disabled={streaming && activeChar !== ch.id}>
              {ch.name}
              <small>{ch.relation.split(' · ')[0]}{shownCount > 0 ? ` · 已出示 ${shownCount} 项` : ''}</small>
            </button>
          )
        })}
      </div>

      <div className="ibody">
        <div className="idialog">
          <div className="dlog" ref={logRef}>
            {c.history.map((h, i) => {
              if (h.who === '系统') return <div key={i} className="dl-sys">〔{h.text}〕</div>
              if (h.who === '侦探') return <div key={i} className="dl-q"><b>问：</b>{h.text}</div>
              const isLast = h === lastAnswer
              return (
                <div key={i} className="dl-a">
                  <b>{h.who}：</b>{h.text}
                  {h.shaken && <span className="shk">动 摇</span>}
                  {isLast && !streaming && h.text.trim() &&
                    <button type="button" className="pin-btn" onClick={() => pinTestimony(activeChar, h)}>📌 钉住这句</button>}
                </div>
              )
            })}
            {streaming && <span className="typing">▌</span>}
          </div>

          <div className="iactions">
            <div className="inputrow-s2">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') send() }}
                placeholder={`向${cleanName(c.profile.name)}自由提问……`}
                disabled={streaming}
              />
              <button className="btn primary" onClick={send} disabled={streaming || !input.trim()}>发 送</button>
            </div>
            <div className="btnrow-s2">
              <button className="btn ghost" onClick={openMentor} disabled={streaming || hintLoading}>需 要 思 路 ？</button>
              <button
                className={`btn confront-btn ${confrontReadyLocal && !alreadyConfronted ? 'ready' : ''}`}
                onClick={() => confront(activeChar)}
                disabled={streaming || alreadyConfronted}
                title={alreadyConfronted ? '已完成对峙' : confrontReadyLocal ? '证据链已成立——发起对峙' : '证据不足的对峙会记为冤枉'}>
                {alreadyConfronted ? '已 对 峙' : confrontReadyLocal ? '⚡ 发起对峙' : '发 起 对 峙'}
              </button>
            </div>
            {hintLoading && !suggestions && <div className="mentor-note">导师正在看你的案卷……</div>}
            {suggestions && !mentorClosed && (
              <div className="mentor-note">
                <div className="mentor-head">老刑警的便签</div>
                <p>{suggestions}</p>
                <button type="button" className="mentor-x" onClick={() => setMentorClosed(true)}>×</button>
              </div>
            )}
          </div>
        </div>

        <div className="iside">
          <div className="lbl">证据（口供卡可出示给其他角色）</div>
          {board.map(e => {
            const shown = c.shownEvidence.some(x => x.id === e.id)
            return (
              <div className="evmini" key={e.id}>
                <div className="tag">{e.tag}{shown ? ' · 已出示过' : ''}</div>
                <div>{e.name}</div>
                <div className="sub">{e.content?.slice(0, 34)}{e.content?.length > 34 ? '……' : ''}</div>
                <div className="ops">
                  <button className="showbtn" onClick={() => showEvidence(e.id)} disabled={streaming || shown}>
                    {shown ? '已出示' : '出 示'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <StoryDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      {helpOpen && (
        <div className="help-mask" onClick={() => setHelpOpen(false)}>
          <div className="help-card" onClick={e => e.stopPropagation()}>
            <button type="button" className="help-close" onClick={() => setHelpOpen(false)}>×</button>
            <div className="help-stamp">玩法说明</div>
            <div className="help-title">审讯室怎么查</div>
            <div className="help-list">
              <p><b>问人：</b>向当前角色自由提问，追问时间、物品、关系和前后矛盾。</p>
              <p><b>钉口供：</b>觉得某句可疑，就点回答旁的图钉，把原话放上证据板。</p>
              <p><b>查原文：</b>打开案卷原文，划选可疑句子，登记成物证。</p>
              <p><b>拼证据：</b>去证据板点两张卡，找矛盾或印证；链条成立后再发起对峙。</p>
            </div>
            <div className="help-foot">卡住时可以点“需要思路？”，但会计入提示使用。</div>
          </div>
        </div>
      )}
    </div>
  )
}
