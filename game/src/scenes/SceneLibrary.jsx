import { useEffect, useState } from 'react'
import { useGameStore } from '../store.js'
import { fetchStories, fetchSlots } from '../api.js'

// S0 故事库（spec §11 v1.1：官方故事 API 混合接入——主线置顶 + 官方 20 篇网格）
// 硬约束：作者/来源归属在详情与游戏内呈现；接口失败展示真实状态，不循环重试
// 已生成过的槽位：点击直接进入（避免重跑流水线覆盖已玩的卡组）；「↻ 侦探化」可强制重新生成
export default function SceneLibrary() {
  const loadGame = useGameStore(s => s.loadGame)
  const openPipeline = useGameStore(s => s.openPipeline)
  const enterGame = useGameStore(s => s.enterGame)
  const [stories, setStories] = useState(null)
  const [slots, setSlots] = useState([])
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true); setErr(null)
    fetchStories()
      .then(r => { if (alive) setStories(r.stories || []) })
      .catch(e => { if (alive) setErr(e.message) })
      .finally(() => { if (alive) setLoading(false) })
    fetchSlots().then(r => { if (alive) setSlots(r.slots || []) }).catch(() => {})
    return () => { alive = false }
  }, [])

  return (
    <div className="scene on" id="s0">
      <div className="topbar">
        <div className="t">故事库<small>选一个故事，进入二刷</small></div>
        <div className="top-actions">
          <div className="chip">主线 · 精调数据层</div>
          <div className="chip">官方故事 · AI 侦探化</div>
        </div>
      </div>

      <div className="lib-body">
        <div className="panel-h">内置主线（人工精调 · 完整三暗线）</div>
        <div className="lib-main" onClick={() => enterGame('main')}>
          <div className="lib-main-info">
            <div className="lib-title">她从不下厨</div>
            <div className="lib-sub">林晚坠楼身亡，警方认定自杀。丈夫深情守候，婆婆从质疑走向"和解"。三个月过去——但有三个人，没说实话。</div>
            <div className="lib-meta">来源：知乎盐言故事 · 作者：盐言故事·原创样本 ｜ 3 条暗线 · 3 名可审讯角色</div>
          </div>
          <div className="lib-main-badge">开始调查 →</div>
        </div>

        <div className="panel-h">知乎盐言故事 · 黑客松内容库（选择后由 AI 流水线侦探化）</div>
        {loading && <div className="lib-note">正在调取官方故事列表……</div>}
        {err && (
          <div className="lib-note err">
            官方故事接口不可用：{err}
            <button className="btn ghost" onClick={() => { setErr(null); setLoading(true); fetchStories().then(r => { setStories(r.stories || []); setLoading(false) }).catch(e => { setErr(e.message); setLoading(false) }) }}>重试</button>
          </div>
        )}
        {stories && (
          <div className="lib-grid">
            {stories.map(s => {
              const generated = slots.includes(s.work_id)
              return (
                <div className="story-card" key={s.work_id}
                  onClick={() => generated ? enterGame(s.work_id) : openPipeline(s.work_id)}>
                  {s.artwork && <div className="story-cover" style={{ backgroundImage: `url(${s.artwork})` }} />}
                  <div className="story-info">
                    <div className="story-title">{s.title}</div>
                    <div className="story-labels">
                      {(s.labels || []).slice(0, 3).join(' · ')}
                      {generated && <span className="story-generated">已生成 · 点击进入</span>}
                    </div>
                    <div className="story-desc">{s.description}</div>
                    {generated && (
                      <button className="story-regen" onClick={e => { e.stopPropagation(); openPipeline(s.work_id) }}>
                        ↻ 重新侦探化
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div className="lib-foot">内容来自知乎黑客松故事 API · AI 生成侦探化改编 · 保留作者归属</div>
      </div>
    </div>
  )
}
