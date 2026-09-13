import SceneSilhouette from './silhouettes.jsx'

export default function Scene1Briefing({ game, onStart, onExit }) {
  return (
    <div className="scene on" id="s1">
      <div className="topbar">
        <div className="t">案卷移交<small>《{game.story.title}》 · 档案编号 {game.meta?.code || 'YS-0914'}</small></div>
        <div className="top-actions">
          <button className="navbtn" onClick={onExit}>← 故事库</button>
          <div className="chip">暗线 0 / {game.darklineTotal}</div>
        </div>
      </div>

      <div className="s1body">
        <div className="brief">
          <div className="panel-h">《{game.story.title}》速读摘要（1 分钟）</div>
          <p>{game.story.summary}</p>
          {game.meta?.author_name && (
            <p className="brief-source">来源：{game.meta.source_label || '知乎盐言故事'} · 作者：{game.meta.author_name} ｜ {game.meta.adaptation || 'AI 生成的侦探化改编'}</p>
          )}
        </div>

        <div className="peeps">
          {game.characters.map(c => (
            <div className="pcard" key={c.id}>
              <div className="avatar"><SceneSilhouette id={c.id} /></div>
              <div className="nm">{c.name}</div>
              <div className="rl">{c.relation}</div>
              <div className="ds">{c.blurb}</div>
            </div>
          ))}
        </div>

        <div>
          <div className="panel-h">案卷起手 · 已知线索（{game.startingEvidence.length}）</div>
          <div className="s1ev">
            {game.startingEvidence.map(e => (
              <div className="evmini" key={e.id}>
                <div className="tag">{e.type} · 案卷起手</div>
                <div>{e.name}</div>
                <div className="sub">{e.brief}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="taskbar">
          <div className="task-text">
            任务：这个故事的真结局藏在 <b>{game.darklineTotal} 条暗线</b> 里。审讯他们，翻查原文，把没说实话的部分挖出来。
          </div>
          <button className="btn primary" onClick={onStart}>开始调查 →</button>
        </div>
      </div>
    </div>
  )
}
