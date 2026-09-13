import { useState } from 'react'
import { useGameStore } from '../store.js'

// 分享卡 S6（design.md ch10：破案大章 + 关键数据 + 知乎回答体文案，MVP mock 不做真实发布）
export default function Scene6Share() {
  const game = useGameStore(s => s.game)
  const settleData = useGameStore(s => s.settleData)
  const stats = useGameStore(s => s.stats)
  const unlockedDLs = useGameStore(s => s.unlockedDLs)
  const usedHint = useGameStore(s => s.usedHint)
  const hintsUsed = useGameStore(s => s.hintsUsed)
  const setScene = useGameStore(s => s.setScene)
  const [copied, setCopied] = useState(false)

  if (!settleData || !game) return null
  const perfect = !usedHint && hintsUsed === 0

  // 知乎回答体文案（v1.2 决策：回流知乎的 UGC 形态——作者归属 + 原问题格式）
  const author = game.meta?.author_name || '盐言故事'
  const dlTotal = game.darklineTotal || 3
  const zhihuText = [
    `我在「二刷」里把《${game.story.title}》刷了两遍，审了 ${game.characters.length} 个人，拼出了 ${unlockedDLs.length}/${dlTotal} 条暗线。`,
    unlockedDLs.length > 0
      ? `最难的一条：${settleData.darkLines[0].text.split('——')[0]}。每一个证据都能在原文里找到原句——这才是"细思极恐"的正确打开方式。`
      : '这次空手而归，但原文里那些没对上的细节，我记下了。',
    `侦探档案：提问 ${stats.questions} 次 · 出示证据 ${stats.shown} 项 · 矛盾链 ${stats.contradictions} 条${stats.wrongAccuse > 0 ? ` · 冤枉好人 ${stats.wrongAccuse} 次` : ''}${perfect ? ' · 完美侦探（未用提示）' : ''}`,
    `原问题：盐言故事《${game.story.title}》里有哪些细思极恐的细节？（作者：${author}）`,
    `—— 由「二刷 · AI 故事重读引擎」生成：一刷读故事，二刷问故事。`
  ].join('\n')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(zhihuText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* 剪贴板被浏览器拒绝时静默 */ }
  }

  return (
    <div className="scene on" id="s6">
      <div className="share-wrap">
        <div className="share-card">
          <div className="share-case">档案编号 {game.meta?.code || 'YS-0914'} · 《{game.story.title}》</div>
          <div className="stamp-solved">破 案</div>
          <div className="share-big">{unlockedDLs.length}<span>/{dlTotal} 暗线</span></div>
          <div className="share-stats">
            <span>矛盾 {stats.contradictions}</span>
            <span>口供 {stats.pins}</span>
            <span>冤枉 {stats.wrongAccuse}</span>
            {perfect && <span className="share-perfect">完美侦探</span>}
          </div>
          <div className="share-sig">二刷 · AI 故事重读引擎</div>
        </div>

        <div className="share-zhihu">
          <div className="panel-h">知乎回答体文案（发回故事问题下）</div>
          <pre className="zhihu-pre">{zhihuText}</pre>
          <div className="st-actions">
            <button className="btn primary" onClick={copy}>{copied ? '已复制 ✓' : '复制文案'}</button>
            <button className="btn ghost" onClick={() => setScene('s5')}>← 返回结算</button>
          </div>
        </div>
      </div>
    </div>
  )
}
