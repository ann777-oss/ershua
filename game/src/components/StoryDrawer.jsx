import { useEffect, useMemo, useRef, useState } from 'react'
import { useGameStore } from '../store.js'

// 案卷原文抽屉（design.md §7.9：右侧滑入 380px 纸页 + 荧光笔划选 + 以此为证）
export default function StoryDrawer({ open, onClose }) {
  const game = useGameStore(s => s.game)
  const submitQuote = useGameStore(s => s.submitQuote)
  const judgeBusy = useGameStore(s => s.judgeBusy)
  const judgeNote = useGameStore(s => s.judgeNote)
  const activeChar = useGameStore(s => s.activeChar)
  const chars = useGameStore(s => s.chars)
  const board = useGameStore(s => s.board)
  const [sel, setSel] = useState(null) // { paraId, text, x, y }
  const [toast, setToast] = useState(null) // 抽屉内判定反馈（引导条在抽屉打开时被遮罩压暗——反馈必须在抽屉内可见）
  const lastNoteRef = useRef(null)

  const drawerRef = useRef(null)

  // 判定结果 → 抽屉内 toast（划选判定时用户正看着抽屉，S2 引导条在遮罩后不可读）。
  // judgeNote 是全局持久的"最近一次判定提示"——关抽屉时把它吞作基线，重开抽屉不重放旧消息
  useEffect(() => {
    if (!open) {
      setToast(null)
      lastNoteRef.current = judgeNote  // 吞掉当前值：重开时不再重弹（只有开着期间的新判定才弹）
      return
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    if (judgeNote && judgeNote !== lastNoteRef.current) {
      lastNoteRef.current = judgeNote
      setToast(judgeNote)
      const t = setTimeout(() => setToast(null), 2800)
      return () => clearTimeout(t)
    }
  }, [judgeNote, open])

  // 划选后浮出「以此为证」（anchor/focus 双端点定位段落，起点落在段落外也能工作）
  useEffect(() => {
    if (!open) { setSel(null); return }
    const onMouseUp = () => {
      const selection = window.getSelection?.()
      const t = selection?.toString().trim()
      if (!t || t.length < 4) { setSel(null); return }
      // 两个端点都尝试向上找段落（anchor 起点可能在段落外：行间/页边/遮罩）
      const findPara = node => {
        while (node && !(node.dataset?.paraId !== undefined)) node = node.parentElement
        return node?.dataset?.paraId ? node : null
      }
      const paraEl = findPara(selection.anchorNode) || findPara(selection.focusNode)
      if (!paraEl) { setSel(null); return }
      const rect = paraEl.getBoundingClientRect()
      // 抽屉内相对坐标（.drawer 带 transform，fixed 子元素会被 transform 祖先劫持为定位基准——必须手动换算）
      const dRect = drawerRef.current?.getBoundingClientRect()
      setSel({
        paraId: paraEl.dataset.paraId, text: t,
        x: rect.left + rect.width / 2 - (dRect?.left || 0),
        y: rect.top - 6 - (dRect?.top || 0)
      })
    }
    document.addEventListener('mouseup', onMouseUp)
    return () => document.removeEventListener('mouseup', onMouseUp)
  }, [open])

  if (!game) return null
  const charName = chars[activeChar] ? clean(chars[activeChar].profile.name) : ''

  // 已取证段落：板上任何卡的锚点段落（划选发证时记录）——有角标，避免重复划选
  const sourcedParas = useMemo(() => new Set(board.flatMap(c => c.paras || [])), [board])

  return (
    <div className={`drawer-mask ${open ? 'on' : ''}`} onClick={onClose}>
      <div className="drawer" ref={drawerRef} onClick={e => e.stopPropagation()}>
        <div className="tex" /> {/* 纸纹覆盖层（multiply 混合，与主舞台一致；不可用 filter 会吞文字） */}
        <div className="drawer-head">
          <span className="drawer-title">案卷原文</span>
          <span className="drawer-sub">《{game.story.title}》 · 划选可疑句子，以此为证</span>
          <button className="btn ghost drawer-close" onClick={onClose}>收起</button>
        </div>
        <div className="drawer-body">
          {game.story.paras.map(p => (
            <p key={p.id}
               data-para-id={p.id}
               className={`para ${sourcedParas.has(p.id) ? 'sourced' : ''}`}>
              {p.text}
              {sourcedParas.has(p.id) && <span className="sourced-mark">已取证</span>}
            </p>
          ))}
          {game.story.excerpt && (
            <p className="para excerpt-note">—— 官方内容接口仅提供正文节选，故事至此中断 ——</p>
          )}
        </div>
        {sel && (
          <button
            className="quote-btn"
            style={{ left: sel.x, top: sel.y }}
            disabled={judgeBusy}
            onClick={async () => {
              await submitQuote(sel.paraId, sel.text)
              window.getSelection?.().removeAllRanges()
              setSel(null)
            }}>
            {judgeBusy ? '判定中……' : `以此为证 → 问${charName}`}
          </button>
        )}
        {toast && <div className="drawer-toast">{toast}</div>}
      </div>
    </div>
  )
}

const clean = n => n.replace(/[　\s]/g, '')
