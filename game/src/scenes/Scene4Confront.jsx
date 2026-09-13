import { useEffect, useRef, useState } from 'react'
import { useGameStore } from '../store.js'

// 对峙演出 S4（design.md ch8：纸面压暗 + 台词逐行显现 + 终局红章）
// beats 与角色卡 100% 一致——展示层零改写（spec T3.1 防幻觉红线）
export default function Scene4Confront() {
  const confrontData = useGameStore(s => s.confrontData)
  const unlockedDLs = useGameStore(s => s.unlockedDLs)
  const setScene = useGameStore(s => s.setScene)
  const settle = useGameStore(s => s.settle)

  const [beatIdx, setBeatIdx] = useState(0)     // 当前 beat
  const [typed, setTyped] = useState('')        // 打字机文本
  const [done, setDone] = useState(false)       // 全部 beats 完成 → 解锁卡
  const typingRef = useRef(false)

  const d = confrontData

  // 无演出数据（异常进入）→ 回审讯室（setState 不在 render 期）
  useEffect(() => {
    if (!d) setScene('s2')
  }, [d, setScene])

  // 打字机：当前 beat 逐字显现（24ms/字，design.md ch8）。
  // interval 自持推进（不依赖 typed），每 tick 基于上一次状态 +1 字
  // prefers-reduced-motion：CSS 动画已由全局规则关闭，此处 JS 打字机同步瞬时输出
  useEffect(() => {
    if (!d?.ok || done) return
    const beat = d.beats[beatIdx] ?? ''
    if (typed === beat) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced) { setTyped(beat); return }
    typingRef.current = true
    const timer = setInterval(() => {
      setTyped(prev => {
        if (prev.length >= beat.length) {
          clearInterval(timer)
          typingRef.current = false
          return prev
        }
        return beat.slice(0, prev.length + 1)
      })
    }, 24)
    return () => { clearInterval(timer); typingRef.current = false }
    // typed 不进依赖：interval 通过函数式 setState 自持推进，避免每字重启
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beatIdx, d, done])

  if (!d) return null

  // 冤枉：短拒绝演出 → 回审讯室（T3.4）
  if (!d.ok) {
    return (
      <div className="scene on" id="s4">
        <div className="cf-reject">
          <div className="cf-name">{d.name}</div>
          <div className="cf-line">{d.reject}</div>
          <button className="btn ghost" onClick={() => setScene('s2')}>回到审讯室</button>
        </div>
      </div>
    )
  }

  // 点击：打字中 → 立即补全；已完 → 下一拍；最后一拍后 → 解锁卡
  const advance = () => {
    if (done) return
    const beat = d.beats[beatIdx] ?? ''
    if (typingRef.current) { setTyped(beat); typingRef.current = false; return }
    if (beatIdx < d.beats.length - 1) {
      setBeatIdx(beatIdx + 1)
      setTyped('')
    } else {
      setDone(true)
    }
  }

  const allDone = unlockedDLs.length >= 3

  return (
    <div className="scene on" id="s4" onClick={advance}>
      <div className="cf-stage">
        {!done ? (
          <>
            <div className="cf-head">
              <span className="cf-name">{d.name}</span>
              <span className="cf-tag">对 峙</span>
            </div>
            <div className="cf-beats">
              {d.beats.slice(0, beatIdx).map((b, i) => <div className="cf-line old" key={i}>{b}</div>)}
              <div className="cf-line cur">{typed}{typed.length < (d.beats[beatIdx] ?? '').length && <span className="typing">▌</span>}</div>
            </div>
            <div className="cf-cta">{typed.length < (d.beats[beatIdx] ?? '').length ? '（点击立即显示）' : '点击继续 ▸'}</div>
          </>
        ) : (
          <div className="cf-unlock" onClick={e => e.stopPropagation()}>
            <div className="stamp-big">对 质</div>
            <div className="cf-unlock-title">暗线解锁 · {d.darkLine}</div>
            <div className="cf-unlock-actions">
              <button className="btn primary" onClick={() => settle()}>{allDone ? '去结案 →' : '去结案 / 继续调查'}</button>
              {!allDone && <button className="btn ghost" onClick={() => setScene('s2')}>继续调查</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
