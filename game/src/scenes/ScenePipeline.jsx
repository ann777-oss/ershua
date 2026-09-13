import { useEffect, useRef, useState } from 'react'
import { useGameStore } from '../store.js'
import { pipelineDraft, pipelineConfirm } from '../api.js'

const fmt = ms => `${Math.floor(ms / 60000)}分${String(Math.floor(ms % 60000 / 1000)).padStart(2, '0')}秒`

// P4 叙事流水线三屏：生成中 → 人工审阅（可改 JSON）→ 确认进入游戏
// 「AI 生成 + 人类把关」是设计而非妥协——审阅页是内容质量叙事的一部分（spec §7）
export default function ScenePipeline() {
  const workId = useGameStore(s => s.pipelineWorkId)
  const startedAt = useGameStore(s => s.pipelineStartedAt)
  const enterGame = useGameStore(s => s.enterGame)
  const setScene = useGameStore(s => s.setScene)

  const [phase, setPhase] = useState('generating') // generating | review | done
  const [draft, setDraft] = useState(null)
  const [err, setErr] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const [registryText, setRegistryText] = useState('')
  const [charsText, setCharsText] = useState('')
  const [confirmErr, setConfirmErr] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const enteredRef = useRef(false)

  // 生成计时器
  useEffect(() => {
    if (phase !== 'generating') return
    const t = setInterval(() => setElapsed(Date.now() - startedAt), 1000)
    return () => clearInterval(t)
  }, [phase, startedAt])

  // 第①步：调 draft（两步 LLM + 校验修复，服务端完成）
  useEffect(() => {
    if (!workId) { setScene('s0'); return }
    let alive = true
    pipelineDraft(workId)
      .then(({ draft: d }) => {
        if (!alive) return
        setDraft(d)
        setRegistryText(JSON.stringify(d.registry, null, 2))
        setCharsText(JSON.stringify(d.characters, null, 2))
        setPhase('review')
      })
      .catch(e => { if (alive) setErr(e.message) })
    return () => { alive = false }
  }, [workId, setScene])

  // 第③步：确认落盘 → 进入游戏（防双击：enteredRef）
  const confirm = async () => {
    if (confirming || enteredRef.current) return
    setConfirming(true); setConfirmErr(null)
    try {
      const registry = JSON.parse(registryText)
      const characters = JSON.parse(charsText)
      const r = await pipelineConfirm(workId, { ...draft, registry, characters })
      if (r.ok) {
        enteredRef.current = true
        setPhase('done')
        await enterGame(workId)
      }
    } catch (e) {
      try {
        const j = JSON.parse(await e.message)
        setConfirmErr((j.errors || [j.error]).join('；'))
      } catch {
        setConfirmErr(e.message)
      }
    } finally {
      setConfirming(false)
    }
  }

  if (!workId) return null

  return (
    <div className="scene on" id="s-pipeline">
      <div className="topbar">
        <div className="t">叙事流水线<small>新故事 → 暗线表 → 角色卡 → 可玩世界</small></div>
        <div className="top-actions">
          <div className="chip">{draft?.meta?.tier === 'deep' ? '深度适配' : draft ? '轻量适配' : '档位判定中'}</div>
          <button className="btn ghost" onClick={() => setScene('s0')}>← 返回故事库</button>
        </div>
      </div>

      {phase === 'generating' && !err && (
        <div className="pipe-body">
          <div className="pipe-steps">
            <div className="pipe-step on">① 读取原文 · 切分段落</div>
            <div className="pipe-step on">② 暗线与证据草稿（LLM）</div>
            <div className="pipe-step on">③ 角色卡草稿（LLM）</div>
            <div className="pipe-step">④ 人工审阅确认</div>
          </div>
          <div className="pipe-running">正在把这篇故事侦探化……<span className="pipe-timer">{fmt(elapsed)}</span></div>
          <div className="pipe-note">通常需要 1-2 分钟。生成后进入审阅页，人工确认才会入库（AI 生成 + 人类把关）。</div>
        </div>
      )}

      {err && (
        <div className="pipe-body">
          <div className="pipe-note err">流水线失败：{err}</div>
          <div className="st-actions"><button className="btn ghost" onClick={() => setScene('s0')}>← 返回故事库</button></div>
        </div>
      )}

      {phase === 'review' && draft && (
        <div className="pipe-review">
          <div className="pipe-left">
            <div className="panel-h">草稿速览（可编辑右侧 JSON）</div>
            <div className="pipe-meta">
              <div className="lib-title">{draft.meta.title}</div>
              <div className="lib-sub">{draft.registry.summary}</div>
              <div className="lib-meta">来源：{draft.meta.source_label} · 作者：{draft.meta.author_name} ｜ AI 生成的侦探化改编</div>
            </div>
            <div className="panel-h">暗线（{Object.keys(draft.registry.dark_lines).length}）</div>
            {Object.entries(draft.registry.dark_lines).map(([k, v]) => (
              <div className="pipe-dl" key={k}><b>{k}</b> {v}</div>
            ))}
            <div className="panel-h">证据卡（{draft.registry.evidences.length}）</div>
            {draft.registry.evidences.map(e => (
              <div className="pipe-ev" key={e.id}>
                <b>{e.name}</b><span className="pipe-ev-dl">{e.dark_line}</span>
                <div>{e.brief}</div>
                <div className="pipe-anchor">锚点：{e.paraIds?.join('、')}</div>
              </div>
            ))}
            <div className="panel-h">角色（{draft.characters.length}）</div>
            {draft.characters.map(c => (
              <div className="pipe-char" key={c.character_id}>
                <b>{c.public_profile?.name}</b><span>{c.public_profile?.relation}</span>
                <div>{c.public_profile?.blurb}</div>
              </div>
            ))}
            {(draft.warnings?.length > 0 || draft.repairs?.length > 0) && (
              <>
                <div className="panel-h">流水线提示</div>
                {draft.repairs?.map((w, i) => <div className="pipe-warn" key={'r' + i}>自动修复：{w}</div>)}
                {draft.warnings?.map((w, i) => <div className="pipe-warn" key={'w' + i}>{w}</div>)}
              </>
            )}
          </div>

          <div className="pipe-right">
            <div className="panel-h">暗线表 JSON（evidence.json）</div>
            <textarea className="pipe-json" spellCheck={false} value={registryText} onChange={e => setRegistryText(e.target.value)} />
            <div className="panel-h">角色卡 JSON（characters/*.json）</div>
            <textarea className="pipe-json" spellCheck={false} value={charsText} onChange={e => setCharsText(e.target.value)} />
            {confirmErr && <div className="pipe-note err">校验未通过：{confirmErr}</div>}
            <div className="st-actions">
              <button className="btn primary" disabled={confirming} onClick={confirm}>
                {confirming ? '校验中……' : '校验并保存 → 进入游戏'}
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'done' && (
        <div className="pipe-body">
          <div className="pipe-steps">
            <div className="pipe-step on">① 读取原文 · 切分段落</div>
            <div className="pipe-step on">② 暗线与证据草稿（LLM）</div>
            <div className="pipe-step on">③ 角色卡草稿（LLM）</div>
            <div className="pipe-step on">④ 人工审阅确认</div>
          </div>
          <div className="pipe-running">已入库 · 正在调阅案卷……</div>
          <div className="pipe-note">全流程用时 {fmt(Date.now() - startedAt)}（含人工审阅）</div>
        </div>
      )}
    </div>
  )
}
