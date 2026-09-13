import { useState } from 'react'
import { useGameStore } from '../store.js'
import StoryDrawer from '../components/StoryDrawer.jsx'

const steps = [
  {
    no: '01',
    title: '先读完整原文',
    text: '二刷默认你已经一刷过故事。进入调查前，先打开案卷原文，把《她从不下厨》完整读完。'
  },
  {
    no: '02',
    title: '回到审讯室',
    text: '把陈默、小雅、周兰当成旧案相关人自由盘问。角色只知道自己该知道的事，也会守住自己的谎。'
  },
  {
    no: '03',
    title: '把可疑处钉上板',
    text: '角色回答旁的图钉可以钉口供；原文里可疑句子可以划选为证，证据会进入证据板。'
  },
  {
    no: '04',
    title: '用证据撬开暗线',
    text: '把口供与物证放在一起建立关联。矛盾链成立后，向守谎者发起对峙，再结案。'
  }
]

export default function SceneTutorial() {
  const setScene = useGameStore(s => s.setScene)
  const enterGame = useGameStore(s => s.enterGame)
  const game = useGameStore(s => s.game)
  const loading = useGameStore(s => s.loading)
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className="scene on" id="s-tutorial">
      <div className="topbar">
        <div className="t">玩法说明<small>先一刷，再二刷审案</small></div>
        <div className="top-actions">
          <div className="chip">新手引导 · 她从不下厨</div>
          <button className="navbtn" onClick={() => setScene('s0')}>故事库</button>
        </div>
      </div>

      <div className="tutorial-body">
        <div className="tutorial-brief">
          <div>
            <div className="tutorial-kicker">案卷移交前须知</div>
            <h1>你不是在第一次读故事。</h1>
            <p>
              《二刷》的玩法建立在“读完之后重审”上：先把原文当作一篇盐言故事读完，再以侦探身份回到故事里，审讯人物、登记证据、拼出一刷时没看见的暗线。
            </p>
          </div>
          <button className="tutorial-read" onClick={() => setDrawerOpen(true)} disabled={!game}>
            先看案卷原文 →
            <small>{loading ? '正在调阅《她从不下厨》' : '推荐读完后再开始调查'}</small>
          </button>
        </div>

        <div className="tutorial-example">
          <div className="panel-h">以《她从不下厨》为例</div>
          <div className="tutorial-case">
            <div className="tutorial-case-title">林晚坠楼身亡，警方认定自杀。</div>
            <div className="tutorial-case-text">
              丈夫陈默显得深情，婆婆周兰逐渐“和解”，闺蜜小雅像是知道些什么。你的任务不是重写结局，而是从他们没说出口的地方，把三条暗线审出来。
            </div>
          </div>
        </div>

        <div className="tutorial-steps">
          {steps.map(step => (
            <div className="tutorial-step" key={step.no}>
              <div className="tutorial-no">{step.no}</div>
              <div>
                <div className="tutorial-step-title">{step.title}</div>
                <p>{step.text}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="tutorial-actions">
          <div className="tutorial-warning">开始前请先读完原文；如果已经读过，可以直接进入《她从不下厨》的案卷。</div>
          <div className="tutorial-buttons">
            <button className="btn ghost" onClick={() => setScene('s0')}>先去故事库</button>
            <button className="btn primary" onClick={() => enterGame('main')}>开始《她从不下厨》 →</button>
          </div>
        </div>
      </div>

      <StoryDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} readOnly />
    </div>
  )
}
