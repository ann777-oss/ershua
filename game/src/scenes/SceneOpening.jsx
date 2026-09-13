import { useGameStore } from '../store.js'

// S0.5 故事结尾页（design.md ch10 阶段 0「情绪转场」：一刷的终点 = 二刷的入口）
// 竖排故事末段 + 底部「另附案卷」纸条（rotate 1°）——"故事里还有 N 个人没说实话 →"
export default function SceneOpening() {
  const game = useGameStore(s => s.game)
  const setScene = useGameStore(s => s.setScene)

  if (!game) return null
  const lastParas = game.story.paras.slice(-4)  // 末段竖排（一刷收尾）
  const n = game.characters.length

  return (
    <div className="scene on" id="s-opening">
      <div className="open-vert">
        {lastParas.map(p => <p key={p.id} className="open-para">{p.text}</p>)}
      </div>
      <div className="open-entry">
        <button className="open-note" onClick={() => setScene('s1')}>
          故事里还有 {n} 个人没说实话 →
          <small>另附案卷 · {game.darklineTotal} 条暗线待查</small>
        </button>
      </div>
    </div>
  )
}
