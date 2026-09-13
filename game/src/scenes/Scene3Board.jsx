import { useEffect, useRef, useState } from 'react'
import { useGameStore } from '../store.js'

// 证据板 S3（design.md §7.6-7.8：牛皮板 + 卡片网格 + 两卡关联 + 矛盾章）
// 卡片可自由拖动（UX4 降级版）：位移 ≥5px 判定为拖动（落点存 store）；否则为点击（关联选择）
export default function Scene3Board() {
  const game = useGameStore(s => s.game)
  const board = useGameStore(s => s.board)
  const chains = useGameStore(s => s.chains)
  const judgePair = useGameStore(s => s.judgePair)
  const judgeNote = useGameStore(s => s.judgeNote)
  const clearJudgeNote = useGameStore(s => s.clearJudgeNote)
  const judgeBusy = useGameStore(s => s.judgeBusy)
  const setScene = useGameStore(s => s.setScene)
  const confront = useGameStore(s => s.confront)
  const confronted = useGameStore(s => s.confronted)
  const confrontBusy = useGameStore(s => s.confrontBusy)
  const moveBoardCard = useGameStore(s => s.moveBoardCard)

  const [firstCard, setFirstCard] = useState(null)
  const [dragPos, setDragPos] = useState(null)  // 拖动中的实时位置 {id, dx, dy}
  const dragRef = useRef(null)                  // {id, startX, startY, baseX, baseY, moved}
  const didDragRef = useRef(false)              // mouseup 后供 click 判定（先 click 后 mouseup 顺序反转保护）

  // 全局拖动监听（document 级：拖出卡片范围仍跟手）
  useEffect(() => {
    const onMove = e => {
      const d = dragRef.current
      if (!d) return
      if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 5) return  // 阈值内视为点击
      d.moved = true
      d.dx = d.baseX + e.clientX - d.startX
      d.dy = d.baseY + e.clientY - d.startY
      setDragPos({ id: d.id, dx: d.dx, dy: d.dy })
    }
    const onUp = () => {
      const d = dragRef.current
      if (d?.moved) {
        didDragRef.current = true
        moveBoardCard(d.id, d.dx || 0, d.dy || 0)  // 落点持久化
        setTimeout(() => { didDragRef.current = false }, 0)  // 本次 click 事件结束后复位
      }
      dragRef.current = null
      setDragPos(null)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [moveBoardCard])

  if (!game) return null

  const pick = (card) => {
    if (didDragRef.current) return  // 刚结束拖动，吞掉误触 click
    if (judgeBusy) return
    if (!firstCard) { setFirstCard(card); clearJudgeNote(); return }
    if (firstCard.id === card.id) { setFirstCard(null); return }
    judgePair(firstCard, card)
    setFirstCard(null)
  }

  const linkedIds = new Set(chains.flatMap(c => [c.a, c.b]))

  // 矛盾链成立 → 该暗线的 chain 守门角色可直接在板上发起对峙（免回审讯室的断点）
  const gateOf = darkLine => game.characters.find(
    ch => ch.confrontRule?.type === 'chain' && ch.confrontRule.darkLine === darkLine
  )

  return (
    <div className="scene on" id="s3">
      <div className="topbar">
        <div className="t">证据板<small>依次点击两张卡片，尝试建立关联</small></div>
        <div className="top-actions">
          <div className="navbtn" onClick={() => setScene('s2')}>← 审讯室</div>
          <div className="chip">暗线 {chains.filter(c => c.darkLine).length} / {game.darklineTotal}</div>
        </div>
      </div>

      <div className="guide">
        {judgeNote
          ? judgeNote
          : firstCard
            ? <>已选中「<b>{firstCard.name}</b>」——再点一张卡片建立关联</>
            : <>点击两张卡片建立关联 · 卡片可<b>自由拖动</b>编排。线索：把<b>口供</b>和<b>物证/他人观察</b>放在一起想想</>}
      </div>

      <div className="boardwrap">
        <div className="bdot" />
        <div className="bgrid">
          {board.map((c, i) => {
            const dragging = dragPos?.id === c.id
            const pos = dragging ? dragPos : c.pos
            return (
              <div key={c.id}
                   className={`ecard ${c.kind === 'note' ? 'note' : ''} ${firstCard?.id === c.id ? 'sel' : ''} ${linkedIds.has(c.id) ? 'linked' : ''} ${dragging ? 'dragging' : ''}`}
                   style={{
                     transform: `translate(${pos?.dx || 0}px, ${pos?.dy || 0}px) rotate(${(i % 3 - 1) * 1.2}deg)`,
                     zIndex: dragging ? 30 : undefined,
                     position: dragging ? 'relative' : undefined
                   }}
                   onMouseDown={e => {
                     if (e.button !== 0) return
                     dragRef.current = { id: c.id, startX: e.clientX, startY: e.clientY, baseX: c.pos?.dx || 0, baseY: c.pos?.dy || 0, moved: false }
                   }}
                   onClick={() => pick(c)}>
              <div className="tag">{c.tag}</div>
              <div>{c.name}</div>
              {c.content && c.content !== c.name &&
                <div style={{ color: 'var(--ink-faint)', fontSize: '10.5px', marginTop: '4px' }}>
                  {c.content.length > 40 ? c.content.slice(0, 40) + '……' : c.content}
                </div>}
            </div>
            )
          })}
          {board.length === 0 && <div className="board-empty">证据板还是空的——去审讯室钉口供，或翻案卷原文找证据</div>}
        </div>

        {chains.length > 0 && (
          <div className="chainzone">
            <div className="panel-h">已成立的关联</div>
            {chains.map((c, i) => {
              const gate = c.verdict === '矛盾' ? gateOf(c.darkLine) : null
              const gateDone = gate && confronted.includes(gate.id)
              return (
                <div className="chain" key={i}>
                  <div className="cc">{c.aName}</div>
                  <div className="redline" />
                  <div className={`clash ${c.verdict === '印证' ? 'soft' : ''}`}>{c.verdict === '矛盾' ? '⚡ 矛盾' : '✓ 印证'}</div>
                  <div className="redline" />
                  <div className="cc">{c.bName}</div>
                  {gate && !gateDone && (
                    <button
                      type="button"
                      className="board-confront"
                      disabled={confrontBusy}
                      title={`矛盾链已成立——直接向${gate.name}摊牌`}
                      onClick={() => confront(gate.id)}>
                      ⚡ 向 {gate.name} 发起对峙 →
                    </button>
                  )}
                  {gateDone && <span className="board-confronted">已对峙</span>}
                  <div className="cnote">{c.note}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
