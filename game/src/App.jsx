import { useEffect } from 'react'
import { useGameStore } from './store.js'
import SceneLibrary from './scenes/SceneLibrary.jsx'
import ScenePipeline from './scenes/ScenePipeline.jsx'
import SceneOpening from './scenes/SceneOpening.jsx'
import Scene1Briefing from './scenes/Scene1Briefing.jsx'
import Scene2Interrogation from './scenes/Scene2Interrogation.jsx'
import Scene3Board from './scenes/Scene3Board.jsx'
import Scene4Confront from './scenes/Scene4Confront.jsx'
import Scene5Settle from './scenes/Scene5Settle.jsx'
import Scene6Share from './scenes/Scene6Share.jsx'

const SCENE_NAMES = { s0: '故事库', pipeline: '叙事流水线', opening: '故事结尾', s1: '案卷页', s2: '审讯室', s3: '证据板', s4: '对峙', s5: '结案', s6: '分享卡' }

export default function App() {
  const game = useGameStore(s => s.game)
  const error = useGameStore(s => s.error)
  const loading = useGameStore(s => s.loading)
  const loadGame = useGameStore(s => s.loadGame)
  const scene = useGameStore(s => s.scene)
  const setScene = useGameStore(s => s.setScene)
  const maybeHint = useGameStore(s => s.maybeHint)

  // 首次进入：预载主线（故事库直接点主线无需等待）
  useEffect(() => { if (!game && !loading) loadGame('main') }, [game, loading, loadGame])

  // 浏览器标签页标题随槽位更新（多案件多 tab 可区分）
  useEffect(() => { if (game?.story?.title) document.title = `二刷 · ${game.story.title}` }, [game])

  // 导演线头定时器（T3.4b）：每 30s 检查一次是否卡关超 3 分钟（仅游戏进行中）
  useEffect(() => {
    if (!['s2', 's3'].includes(scene)) return
    const t = setInterval(() => maybeHint(), 30000)
    return () => clearInterval(t)
  }, [maybeHint, scene])

  const inGame = ['s1', 's2', 's3', 's4', 's5', 's6'].includes(scene)

  return (
    <>
      {import.meta.env.DEV && <div className="devnote">二刷 · P4 叙事流水线（{SCENE_NAMES[scene] || scene}）</div>}
      <div className="stage">
        <div className="tex" />
        <div className="stain stain-a" />
        <div className="stain stain-b" />
        {scene === 's0' && <SceneLibrary />}
        {scene === 'pipeline' && <ScenePipeline />}
        {scene === 'opening' && <SceneOpening />}
        {inGame && (error
          ? <div className="boot-error">案卷调阅失败：{error}</div>
          : loading || !game
            ? <div className="boot-loading">正在调阅案卷……</div>
            : scene === 's1'
              ? <Scene1Briefing game={game} onStart={() => setScene('s2')} onExit={() => setScene('s0')} />
              : scene === 's2'
                ? <Scene2Interrogation />
                : scene === 's3'
                  ? <Scene3Board />
                  : scene === 's4'
                    ? <Scene4Confront />
                    : scene === 's5'
                      ? <Scene5Settle />
                      : <Scene6Share />)}
      </div>
    </>
  )
}
