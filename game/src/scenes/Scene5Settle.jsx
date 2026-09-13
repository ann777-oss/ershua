import { useEffect, useState } from 'react'
import { useGameStore } from '../store.js'

// 结算页 S5（design.md ch10：打印机吐纸 + 印章"已结" + 暗线对照 + 原文坐标回放）
export default function Scene5Settle() {
  const game = useGameStore(s => s.game)
  const settleData = useGameStore(s => s.settleData)
  const stats = useGameStore(s => s.stats)
  const unlockedDLs = useGameStore(s => s.unlockedDLs)
  const usedHint = useGameStore(s => s.usedHint)
  const hintsUsed = useGameStore(s => s.hintsUsed)
  const setScene = useGameStore(s => s.setScene)

  const [printIdx, setPrintIdx] = useState(0)  // 吐纸动画：逐块显现

  useEffect(() => {
    if (!settleData) return
    const blocks = 4 + (settleData.darkLines?.length ?? 0)
    let n = 0
    const t = setInterval(() => {
      n += 1
      setPrintIdx(Math.min(n, blocks))
      if (n >= blocks) clearInterval(t)  // 吐完即停，不再空转
    }, 120)
    return () => clearInterval(t)
  }, [settleData])

  if (!settleData || !game) return null

  const perfect = !usedHint && hintsUsed === 0
  const statRows = [
    ['提问', stats.questions], ['出示证据', stats.shown], ['钉口供', stats.pins],
    ['矛盾链', stats.contradictions], ['印证链', stats.confirms],
    ['冤枉好人', stats.wrongAccuse], ['线头/提示', stats.hints + (usedHint && stats.hints === 0 ? 1 : 0)]
  ]
  const allDL = ['DL1', 'DL2', 'DL3']
  const dlText = id => settleData.darkLines.find(d => d.id === id)

  return (
    <div className="scene on" id="s5">
      <div className="topbar">
        <div className="t">结案档案<small>《{game.story.title}》</small></div>
        <div className="top-actions">
          <div className="chip">档案编号 YS-0914</div>
          <div className={`chip seal-chip ${unlockedDLs.length === 3 ? 'sealed' : ''}`}>{unlockedDLs.length === 3 ? '已 结' : '未 结'}</div>
        </div>
      </div>

      <div className="settle-body">
        {printIdx >= 1 && (
          <div className="st-block">
            <div className="panel-h">侦探档案</div>
            <div className="stat-grid">
              {statRows.map(([k, v]) => <div className="stat-cell" key={k}><b>{v}</b><span>{k}</span></div>)}
            </div>
            {perfect && <div className="perfect-badge">完美侦探 · 未用任何提示</div>}
          </div>
        )}

        {printIdx >= 2 && (
          <div className="st-block">
            <div className="panel-h">暗线还原 {unlockedDLs.length} / 3</div>
            {allDL.map(id => {
              const d = dlText(id)
              return d ? (
                <div className="dl-card on" key={id}>
                  <div className="dl-id">{id}</div>
                  <div className="dl-text">{d.text}</div>
                  {id === 'DL1' && <div className="dl-coda">作者没有写。你的证据链到此为止，你的判断从现在开始。</div>}
                </div>
              ) : (
                <div className="dl-card off" key={id}>
                  <div className="dl-id">{id}</div>
                  <div className="dl-text">未解锁——这条暗线还埋在纸里</div>
                </div>
              )
            })}
          </div>
        )}

        {printIdx >= 3 && (
          <div className="st-block">
            <div className="panel-h">原文坐标回放（每条解锁暗线的证据定位）</div>
            {settleData.darkLines.map(d => (
              <div className="dl-evidence" key={d.id}>
                {d.evidences.map(ev => (
                  <div className="ev-locator" key={ev.id}>
                    <div className="ev-locator-name">◈ {ev.name}<span>{ev.brief}</span></div>
                    {ev.paras.map((p, j) => (
                      <div className="ev-para" key={p.id} style={{ animationDelay: `${j * 120}ms` }}>
                        <i>{p.id}</i>{p.text}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
            {settleData.darkLines.length === 0 && <div className="ev-para">（没有解锁的暗线，没有坐标。）</div>}
          </div>
        )}

        {printIdx >= 4 && (
          <div className="st-block">
            <div className="panel-h">结案批注</div>
            <div className="comment">{settleData.comment}</div>
          </div>
        )}

        <div className="st-actions">
          <button className="btn primary" onClick={() => setScene('s6')}>生成破案档案分享卡 →</button>
          <button className="btn ghost" onClick={() => setScene('s2')}>再看一眼案发现场</button>
        </div>
      </div>
    </div>
  )
}
