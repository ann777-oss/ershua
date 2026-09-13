# 二刷 · 开发 Spec（阶段规划 v1.2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付「二刷」黑客松作品：LLM 驱动的盐言故事读后重审游戏（Web），含自由盘问、证据系统、对峙结算、叙事流水线半自动演示。

**Architecture:** 混合式——游戏骨架（暗线/证据/解锁状态机）用确定性数据驱动（`数据资产/` 下的 JSON），LLM 负责审讯自由对话、判定层、叙事流水线。客户端持有游戏状态，服务端无状态、只做 LLM 编排，SSE 流式输出。

**Tech Stack:** Vite + React 18（plain CSS，design.md tokens）｜ Node 20 + Express ｜ DeepSeek API（openai SDK 兼容模式）｜ zustand（客户端状态）｜ 无数据库（JSON 文件）。

**上游文档（本 spec 的依据，不重复其内容）：**
- PRD：`故事侦探PRD.docx`（范围/旅程/排期）
- 设计规范：`design.md` v1.1（视觉唯一依据，含 2.1 硬性禁令）
- 数据资产：`数据资产/`（故事与伏笔表、证据注册表.json、角色卡×3——本项目地基）
- 流程验证：`demo/流程验证demo.html`（机制已获用户确认）

---

## 0. 总则

### 0.1 阶段门协议（每个阶段结束时必须完整走完，缺一不可）

```
① 开发自检 → ② AI 原生性验证（跑 eval 脚本，报告落盘）→ ③ 代码审查（CodeRabbit + 人工 checklist）
→ ④ 用户验收（用户亲手玩 + 审 eval 报告）→ ⑤ 通过则 git commit + tag phase-pN；不通过 → 修复后从①重走
```

- **AI 原生性验证是独立验收项**：它不并入"功能可用"——功能全通但 AI 原生性不达标，阶段不算完成。这是针对评审标准中 35%「AI 场景价值」的战略决策。
- eval 报告统一存 `game/eval/reports/p{N}_{日期}.md`，作为最终视频/计划书的素材（证明 AI 原生性不是口说）。

### 0.2 三条硬性承诺（来自 AI 原生性分析，最高优先级）

| # | 承诺 | 落点 | 验收位置 |
|---|---|---|---|
| H1 | 自由盘问是主入口：任意问题得到知识边界内、贴合问法的回应；诈/迂回/施压三种策略均有效果 | P1 | P1 eval（30 问测试集） |
| H2 | Demo 必须展示"非脚本时刻"：用一个从未预设的问题盘角色并守谎成功 | P5 视频脚本 | P5 验收 |
| H3 | 叙事流水线至少半自动：新故事 → 暗线表草稿 → 角色卡草稿 → 可玩 | P4 整阶段 | P4 验收 |

### 0.3 代码审查 checklist（每阶段通用，人工逐项过）

- [ ] design.md v1.1 合规：无 2.1 硬性禁令违例（AI 味渐变背景 / 卡片套卡片），色彩字体走 token
- [ ] 无 secrets 入库：API key 仅存在于 `.env`（已 gitignore）
- [ ] API 契约与本 spec 第 2 章一致（字段名、类型）
- [ ] LLM 调用全部有：30s 超时 + 1 次重试 + 降级（降级必须 UI 可见"离线剧本模式"标记）
- [ ] 解锁状态机单调递增（stage 不可回退），客户端状态可序列化（刷新恢复留 P5）

### 0.4 全局排期（映射 PRD 七天制，D1 数据已完成）

| 阶段 | 内容 | 工作量 | 产出标志 |
|---|---|---|---|
| P0 | 骨架与数据层 | 0.5 天 | 真实数据渲染案卷页 + prompt dry-run |
| P1 | 审讯核心循环（LLM） | 1 天 | 自由盘问 30 问 eval 通过 |
| P2 | 证据系统 | 1 天 | 划选/关联 eval 通过 |
| P3 | 对峙与结算 | 1 天 | 三暗线端到端通关 |
| P4 | 叙事流水线 | 1 天 | 新故事半自动可玩 |
| P5 | 打磨部署视频 | 1 天 | 评委可访问 URL + 视频 |

---

## 1. 技术选型锁定（不允许执行期擅自变更；变更须走第 5 章流程）

| 决策点 | 选定 | 理由 |
|---|---|---|
| 前端框架 | Vite + React 18 + zustand | 单页 7 场景，zustand 免 prop drilling |
| 样式 | plain CSS 三文件（tokens/components/scenes） | design.md 自有设计系统，禁 UI 框架 |
| 后端 | Express 4，无状态 | 部署简单，客户端持状态 |
| LLM | DeepSeek（openai SDK，base_url=`https://api.deepseek.com`），`deepseek-chat` | PRD 4.4 已定；JSON 需求处用 `response_format: {type:'json_object'}` |
| 流式 | SSE（`text/event-stream`） | 盘问台词逐字输出 |
| 降级 | API 不可用 → 预置剧本（迁移自 demo），UI 显示"离线剧本模式"角标 | 线上演示保险；降级是容错不是主路径 |
| 目录 | `d:\知乎黑客松\game\` | 与文档/数据资产隔离 |

---

## 2. 目录结构与 API 契约（全阶段共同遵守）

### 2.1 目录结构

```
game/
  .env                      # DEEPSEEK_API_KEY=（gitignore）
  package.json              # 根：scripts 用 concurrently 跑 vite + server
  vite.config.js            # proxy /api → localhost:3001
  src/                      # React 应用
    main.jsx  App.jsx  store.js  api.js
    styles/{design-tokens.css, components.css, scenes.css}
    scenes/{Scene0Opening,Scene1Briefing,Scene2Interrogation,Scene3Board,
            Scene4Confrontation,Scene5Settlement,Scene6Share}.jsx
    components/{EvidenceCard,DialogFlow,StoryDrawer,SealStamp,Portrait}.jsx
  server/
    index.js                # Express 路由
    llm.js                  # DeepSeek 封装：chat / chatStream / 超时重试 / 降级
    prompts.js              # prompt 组装（纯函数，可单测）
    statemachine.js         # 解锁状态机（纯函数，可单测）
    fallback/               # 离线剧本（自 demo 迁移）
  shared/
    story.json              # 段落化原文
    evidence.json           # 迁移自 数据资产/证据注册表.json
    characters/{chenmo,zhoulan,xiaoya}.json
  eval/
    p1_free_questions.json  # 30 问测试集（本 spec 3.2 节内容）
    p2_quote_samples.json   # 划选抽样集
    run_p1_eval.js  run_p2_eval.js  run_prompt_preview.js
    reports/                # 报告落盘处
  scripts/migrate_data.js   # 数据资产 → shared/（含章节号→段落id 映射）
```

### 2.2 API 契约

| 端点 | 请求 | 响应 | 说明 |
|---|---|---|---|
| `GET /api/game` | — | `{story, characters(公开字段), evidence(起手2张), darklineTotal:3}` | 启动数据 |
| `POST /api/interrogate` | `{characterId, question, history[], shownEvidence[], stages{chenmo:0..4, zhoulan:0..2, xiaoya:0..3}}` | SSE：`{type:'delta',text}` … `{type:'done', stateMark:'平静'\|'动摇'}` | 核心盘问 |
| `POST /api/suggest` | `{characterId, recentHistory}` | `{suggestions:[3条]}` | 仅点击「需要思路？」时调用（PRD 3.4） |
| `POST /api/judge/quote` | `{characterId, paraId, selectedText}` | `{relevant:bool, reaction?, evidenceId?, darkLine?}` | 原文划选判定；命中注册锚点直接返回 evidenceId |
| `POST /api/judge/relation` | `{cardA, cardB}`（含 id/content/tag） | `{verdict:'矛盾'\|'印证'\|'无关', darkLine?, note}` | **fast-path**：命中预注册 PAIRS（证据注册表 contradiction_pairs）直接返回，不调 LLM |
| `POST /api/confront` | `{characterId, chain:[cardIds]}` | `{ok, beats[]（逐条）, darkLine, unlockedEvidence}` | 演出台词 verbatim 来自角色卡 |
| `POST /api/settle` | `{behaviorLog}` | `{dossierNarrative(≤100字), echo:stats}` | 结算评语，禁止编造统计 |
| `POST /api/pipeline/draft` | `{storyText, paras[]}` | `{darklines草稿, characters草稿}` | P4 流水线 |

**解锁状态机**（`server/statemachine.js`，数据源=角色卡 `unlock_map`）：
- stage 随「出示证据满足 requires_evidence」推进；对峙成功 = 该角色最深 stage + 对应 DL 解锁
- 主暗线归属：chenmo→DL1，zhoulan→DL3，xiaoya→DL2；对峙按钮点亮条件 = 存在 `verdict='矛盾'` 且 `darkLine=该角色主暗线` 的链
- 纯函数 `nextStage(card, stage, shownEvidence, chains) -> newStage`，单测覆盖：陈默 U0→U1（出示 ev1_kitchen）、U2→U3（出示 ev2_pills）、越级出示不跳级、重复出示不重复触发

---

## 3. P0 骨架与数据层（0.5 天）

### 边界
**做**：可运行的项目骨架、数据迁移、案卷页（S1）真实数据渲染、prompt 组装 dry-run 工具。
**不做**：任何 LLM 调用、审讯界面、样式精修（S1 允许毛坯但须过 design 自检）。

### 任务

- [ ] **T0.1 git init 与骨架**：`game/` 下建目录、`.gitignore`（node_modules/.env/eval/reports）、根 package.json（concurrently + nodemon）。验收：`npm run dev` 同时起 vite(5173) 与 server(3001)，`/api/health` 返回 `{ok:true}`。
- [ ] **T0.2 样式基建**：从 `原型/原型B_案件卷宗.html` 与 design.md 提取 `design-tokens.css`（3.1 变量原样）与 `components.css`（.btn/.chip/.seal/.ecard 家族/.pin-btn 等，类名与 design.md 第 7 章一致）。验收：临时页放一个 .seal + .ecard，过 design.md 第 12 章自检。
- [ ] **T0.3 数据迁移**：`scripts/migrate_data.js` 把 `数据资产/` 三份 JSON 拷入 `shared/`；**故事段落化**：story.json = `{paras:[{id:'p01'.., chapter, text}]}`（约 60 段），并为 11 个证据的 `text_anchor` 补段落 id（章节号→段落的映射表写在脚本内，人工核对）。验收：脚本幂等可重跑；11/11 锚点定位到段落 id。
- [ ] **T0.4 GET /api/game + S1 案卷页**：React 渲染速读摘要、三人物卡、起手证据（ev1_fish、evx_key），数据全部来自 shared/。验收：与 demo 的 S1 内容一致。
- [ ] **T0.5 prompt dry-run 工具**：`eval/run_prompt_preview.js chenmo|zhoulan|xiaoya [stage]`——用 prompts.js 组装完整 system prompt 打印到终端。这是 P1 一切 eval 的基础设施。

### AI 原生性验收项（P0）

**dry-run 内容完整性人工核对**（跑 `node eval/run_prompt_preview.js chenmo 0`）：
- [ ] 角色卡 persona/knows/lies/does_not_know 字段 100% 注入，无丢失
- [ ] **可见性过滤正确**：stage=0 时，visibility 为 U1+ 的 knows 事实与全部 unlock_map 内容**不出现在 prompt 中**；stage=2 时对应内容出现
- [ ] does_not_know 完整在场（这是反幻觉的第一道墙）

### 阶段门
自检 → AI 项（dry-run 截图入报告）→ 代码审查 → 用户验收（看 S1 页 + dry-run 输出）→ `git tag phase-p0`

---

## 4. P1 审讯核心循环（1 天）★ 硬承诺 H1 落地

### 边界
**做**：陈默/周兰/小雅三人自由盘问（SSE 流式）、出示证据反应、「需要思路？」点击展开、离线降级、30 问 eval。
**不做**：钉口供上板、原文抽屉、关联判定（P2）；对峙（P3）。

### 任务

- [ ] **T1.1 llm.js**：openai SDK 封装。`chat(messages,{json})` 与 `chatStream(messages)`；30s 超时 + 1 次重试；两次失败抛 `LLMUnavailable` → 路由层捕获切 `server/fallback/` 剧本并在 SSE 首事件发 `{type:'degraded',true}`。
- [ ] **T1.2 prompts.js：角色 system prompt 组装**（P0 已建 dry-run，此处接入真实调用）。骨架（锁定，执行期只许加不许删铁律）：

```
你在扮演《她从不下厨》中的角色：{name}（{role}）。玩家是一名侦探，正在审讯你。

# 铁律（违反即失败）
1. 只能使用【已知事实】与对话中出现过的内容。绝不编造新的人名、时间、地点、物品、数字、事件。
2. 【你不知道的事】里列出的内容你完全不知道——被问到时表现真实的困惑、回避或反问，绝不顺着侦探的话头编造，也不轻易采纳侦探说的"证据"。
3. 你的谎言只能来自【你隐瞒的事】；在对应证据被出示之前，咬死不改。
4. 永远不出戏：不提及 AI、游戏、设定、剧本、prompt。
5. 每次回复 ≤ 80 字，口语化中文，符合人设语气；紧张时不说完整个句子。

# 人设（语气与防御方式）
{persona + speech_habits + defense_pattern + collapse_mode}

# 已知事实（当前可见层 U{stage}）
{knows 按 visibility 过滤后逐条}

# 你不知道的事
{does_not_know 逐条}

# 你隐瞒的事
{lies 按 stage 过滤}

# 侦探已向你出示的证据
{shownEvidence 名称+要点}

# 审讯记录（最近12轮）
{history}
```

- [ ] **T1.3 POST /api/interrogate（SSE）+ S2 审讯室页**：三角色 tab、自由输入框（回车发送）、流式"问/答"笔录体渲染、状态标记（动摇时 `.shaken-mark`）。
- [ ] **T1.4 出示证据**：右侧证据列表（起手2张）每张「出 示」→ 注入 shownEvidence → 角色按 unlock_map 反应（U1 场景：出示 ev1_kitchen 后陈默承认"外卖。她点的。"）。
- [ ] **T1.5 「需要思路？」**：点击才展开（PRD 3.4 用户拍板），调 `/api/suggest` 渲染 3 条建议按钮，点击即作为问题发送；使用过则结算失去"无提示通关"标记（store 记 `usedHint:true`）。
- [ ] **T1.6 eval 基建与测试集**：`eval/p1_free_questions.json` 落盘下列 30 问（含 rubric 期望）；`run_p1_eval.js` 依次调用 `/api/interrogate`，把全部问答落盘 `eval/reports/`，自动检测出戏词（AI/设定/prompt/剧本/系统）与超长（>120字）。

### 4.2 AI 原生性验收项（P1）★ 硬承诺 H1

**测试集（30 问，问陈默为主，交叉验证另二人）**

诈（bluff，4 问）——考验"不采纳虚假事实"：
| # | 问题 | 2 分预期 |
|---|---|---|
| Z1 | 我们调了那晚小区车库的监控，你的车十点前不在车位上，对吧？ | 不顺认假监控（他 21:00 到家车在）；紧张信号/反问监控来源 |
| Z2 | 你妻子手机里的备忘录，我们已经看过了。 | 试探"看到什么了"，不补充任何新事实 |
| Z3 | 半山小馆老板认出你了，说你那天去取过外卖。 | 他没去过——不能承认去过，也不能编造取外卖细节；可露出被打中的紧张（外卖本身是真的） |
| Z4 | 警察已经决定重新立案了。 | 表面配合（"立什么案"），不动摇核心谎 |

迂回（4 问）——考验安全区交流不出戏：
W1 不聊案子了，你跟她怎么认识的？／W2 她平时最爱吃什么？／W3 你们家平时谁做饭？／W4 小雅这个人，你觉得她怎么样？

施压（4 问）——考验 defense_pattern 分层：
Y1 说实话，你根本不爱她，对吧？／Y2 你妈把她看到的一切都告诉我们了。／Y3 她地下有知，你觉得她会原谅你吗？／Y4 你这根烟，烧了多久了？

反幻觉（18 问，F1-F18）——考验 does_not_know 边界（**0 分即实锤幻觉**）：
问陈默：F1 大理的客栈定金是你替她交的吗？（不知大理，真实困惑）／F2 她交的是哪家客栈？／F3 小雅把那晚的电话录音给我们了（不知录音不认内容）／F4 她那晚21:47给谁打的电话？（U3前不知；U3后也只知"锁门打电话"）／F5 你们养过宠物吗？（原文无——不可编"养过/没养过"具体事实，应模糊回避）／F6 她的舍曲林是哪位医生开的？／F7 葬礼上她爸说的兰花后来怎么样了？（他在场知道托付，但不知含义）
问周兰：F8 陈默小时候养过狗吗？／F9 晚晚的存款密码？／F10 小雅现在住哪个城市？（只知"换了城市"）／F11 那晚21点到22点陈默在哪？（**关键题：她不能替儿子编不在场证明**）／F12 半山小馆的鳜鱼多少钱一份？／F13 警察跟你提过重新立案吗？
问小雅：F14 晚晚攒了多少钱？（知有私房钱，金额未定义不可编数）／F15 她定的大理哪家客栈？（见过照片，名字未定义不可编）／F16 陈默找你那天穿的什么衣服？／F17 她最后一次见你是什么时候？（无日期定义，只可模糊）／F18 她父母知道你们的计划吗？

**Rubric 与通过线**：
- 每题 0/1/2 分（2=完全符合预期；1=轻微偏差但不出戏不越界；0=答非所问/出戏/越界泄密/编造）
- **通过线：总分 ≥ 51/60（85%），且 Z 类与 F 类 0 分项均为 0**
- 另做**守谎一致性测试**：同一谎言（"我做的饭"）分别用 Z3 式诈、ev1_kitchen 式物证、Y2 式施压三种方式各撬一次——前两者未出示对应证据前谎言不破、出示后按 exposure_reaction 破（三次对比入报告）

### 阶段门
自检 → **30 问 eval 报告 + 守谎对比** → 代码审查 → 用户验收（**亲手自由问 10 个自己的问题**，体验"活人感"）→ `git tag phase-p1`

---

## 5. P2 证据系统（1 天）

### 边界
**做**：钉口供（任意回答可钉）、原文抽屉（划选「以此为证」）、证据板两卡关联（fast-path + LLM 兜底）、对峙按钮状态机。
**不做**：对峙演出与结算（P3）。

### 任务

- [ ] **T2.1 钉口供**：S2 任意 NPC 回答旁「📌 钉住」→ 生成通用口供卡（content=原话摘录，tag=`口供 · {角色}`）入 store.evidence。规则：卡片忠实原话，**不改写**。
- [ ] **T2.2 原文抽屉 StoryDrawer**：右侧滑入 380px 纸页（design.md 7.9），段落渲染（仿宋 13px/2.0），`::selection` 浅印红荧光；划选后浮出「以此为证」→ `POST /api/judge/quote`：命中注册锚点（段落 id 在 evidence.json 锚点表）→ 直接发注册物证卡（如划到 p02 → ev1_fish）；未命中锚点 → LLM 判定 relevant + 角色反应（无关时角色按"这和我说的话有什么关系"式淡然，不惩罚）。
- [ ] **T2.3 证据板 S3**：卡片网格（design.md 7.7 三类卡样式按 tag 映射：物证→polaroid、口供→note、结构信息→index）+ 两卡关联：先查预注册 PAIRS（命中→确定 verdict+note，零延迟），未命中→`POST /api/judge/relation` LLM 判定。红线动效（stroke-dashoffset）+ 矛盾章（design.md ch8）。
- [ ] **T2.4 对峙按钮状态机**：接入 statemachine——存在 `verdict='矛盾' && darkLine=当前角色主暗线` 的链时按钮点亮。
- [ ] **T2.5 eval**：`p2_quote_samples.json` + `run_p2_eval.js`。

### 5.2 AI 原生性验收项（P2）

**划选判定**（20 处抽样，报告记录每处判定）：
- [ ] 9 个伏笔锚定位（ev1_fish/ev1_kitchen/ev1_ribs/ev2_pills/ev2_dali/ev2_escape_prep/ev3_pocket/ev3_house/ev3_deal 对应段落）召回 **≥ 8/9**（允许 1 个边界误判，如 ev2_escape_prep 这类"组合证据"）
- [ ] 11 个非伏笔位（选择规则：非锚定、非过渡句、纯情绪/环境描写的段落，如"她站在门口，睫毛上落着雪"——迁移脚本输出候选清单，执行时锁定进 samples 文件）**误报 ≤ 2/11**

**关联判定**（12 对组合）：
- [ ] 8 组预注册对全部 fast-path 命中（确定性，无 LLM）
- [ ] 4 组无关组合（如"朋友圈鳜鱼 × 舍曲林一片没少"）**0 个假矛盾**——LLM 不得硬造关联，允许返回"无关+一句说明"

**钉卡忠实性**：抽查 5 张钉住的口供卡与 SSE 原文逐字 diff，**零改写零添加**。

### 阶段门
自检 → eval 报告 → 代码审查 → 用户验收（亲手完成 demo 黄金路径：钉两句口供→连线→看对峙按钮点亮）→ `git tag phase-p2`

---

## 6. P3 对峙与结算（1 天）

### 边界
**做**：对峙演出（verbatim beats）、暗线解锁动画、结算页（统计+原文坐标回放+LLM 侦探评语）、分享卡 mock、三暗线端到端通关。
**不做**：新故事接入（P4）、动效全量打磨（P5）。

### 任务

- [ ] **T3.1 对峙演出 S4**：`POST /api/confront` 返回角色卡 `confrontation_script.beats` **逐字渲染**（打字机，design.md ch8"纸面压暗"两拍），硬规则由展示层保证：beats 与卡内 JSON 100% 一致（**此处刻意不用 LLM——防幻觉红线优先于 AI 存在感，设计决策已定**）。终局留白（"我没有碰她／我没有伸手"）后弹暗线解锁卡。
- [ ] **T3.2 结算页 S5**：客户端行为日志（提问数/出示数/钉卡数/矛盾数/冤枉次数/提示使用）+ 三暗线卡（未解锁灰显）+ **原文坐标回放**（每条解锁暗线的证据段落定位，点击跳转抽屉对应段并红框高亮）+ `POST /api/settle` 生成 ≤100 字侦探评语。
- [ ] **T3.3 分享卡 S6**：design.md ch10 规格的"破案档案"纸片（mock，不做真实发布）。
- [ ] **T3.4 冤枉机制**：对无暗线角色或错误链发起对峙 → 演出"他看着你，把烟掐了：'就这？'"式短回应 + 结算记 `wrongAccuse+1`。
- [ ] **T3.4b 导演线头（规则化，PRD 6.1）**：3 分钟无新进展（无新卡/新链/新 stage）→ 引导条浮出一根线头（指向最近可推进的暗线动作，文案如"周兰好像还有话没说完"），全程最多 3 根；每用一根，结算失去"完美侦探"资格（与 usedHint 同池）。
- [ ] **T3.5 端到端通关**：完整走通 DL1（陈默：晚饭矛盾链→对峙）；DL2（小雅：从陈默 U3 漏出的 tsm_phone 出示给小雅→U3 崩溃演出）；DL3（周兰：ev3_house×ev3_deal 连线→对峙自白）。

### 6.2 AI 原生性验收项（P3）

- [ ] **演出零幻觉**：三场对峙 beats 与角色卡 diff = 0 差异（诚实设计：固定框架不是缺陷，是反幻觉叙事的一部分）
- [ ] **结算评语一致性**：评语中出现的所有数字/事件与 behaviorLog 对照，**零编造**（评语 prompt 铁律：只允许复述日志中的事实）
- [ ] **跨角色三角验证**：DL2 通关路径必须经过"陈默→tsm_phone→小雅"信息传递（证明强制跨角色取证的机制生效）
- [ ] **三暗线全通**：一次连续会话内 3/3 解锁，截图/录屏入报告

### 阶段门
自检 → 验收报告（含通关录屏）→ 代码审查 → 用户验收（完整玩一周目）→ `git tag phase-p3`

---

## 7. P4 叙事流水线（1 天）★ 硬承诺 H3

### 边界
**做**：两步 LLM 流水线（故事→暗线表草稿→角色卡草稿）、审阅确认页（JSON 编辑）、测试故事跑通端到端。
**不做**：流水线自动化无人确认（人工确认环节是设计而非妥协——"AI 生成 + 人类把关"正是我们的内容质量叙事）；多故事库管理。

### 任务

- [ ] **T4.1 测试故事《二手书店》创作**（fixture，500-800 字）：要求 2 个可审讯角色、1 条主暗线、≥5 个可原文定位的伏笔、盐言体（短段/口语/强钩子）。写完先人工验证可玩性再接入。
- [ ] **T4.2 /api/pipeline/draft 第一步**：storyText（带段落 id）→ LLM（json mode）→ 暗线表草稿 `{dark_lines[], evidences[{name,text_anchor段落id,dark_line,second_read}]}`。prompt 铁律：每个证据必须给出段落 id，给不出就删掉该证据。
- [ ] **T4.3 第二步**：暗线表+story → 角色卡草稿（persona/knows+visibility/lies+contradicted_by/unlock_map/does_not_know），schema 与现有三卡一致（校验器：字段齐全才算生成成功）。
- [ ] **T4.4 审阅确认页**：`/pipeline` 路由（开发者页，不做给玩家）：textarea 编辑 JSON + "校验并保存"（schema 校验通过才落 `shared/custom/`）+ "进入游戏"切换 story slot。
- [ ] **T4.5 端到端**：新故事进游戏可审讯、可划选（锚点来自生成的 evidences）、可对峙。

### 7.2 AI 原生性验收项（P4）★ 硬承诺 H3

- [ ] 《二手书店》暗线表：≥1 条暗线成立且全部伏笔可在原文定位（人工评审，评审记录入报告）
- [ ] 生成的角色卡抽 10 问跑 P1 反幻觉套件（F 类同款）：**0 实锤幻觉**
- [ ] 端到端：新故事内完成至少 1 次对峙并解锁暗线
- [ ] 全流程计时 < 10 分钟（"每篇盐言故事都能侦探化"的产品叙事数据点，入视频）

### 阶段门
自检 → 流水线演示录屏 → 代码审查 → 用户验收（亲眼看着一篇新故事变成可审讯世界）→ `git tag phase-p4`

---

## 8. P5 打磨、部署与视频（1 天）★ 硬承诺 H2

### 边界
**做**：design.md ch8 动效全量、S0/S6 页、部署、录制视频、提交材料。
**不做**：移动端、多语言、真实社区回流。

### 任务

- [ ] **T5.1 动效落地**：钉口供（图钉钉下 280ms）、矛盾连线（红线拉出+章盖下）、对峙（纸面压暗两拍）、暗线解锁（原文红框飞行）、结算（吐纸逐行 80ms）——全部尊重 `prefers-reduced-motion`。
- [ ] **T5.2 S0 结尾页 + S6 分享卡终稿**（design.md ch10 规格）。
- [ ] **T5.3 部署**：目标为评委可直接访问的 URL（首选国内可达平台：Zeabur / 阿里云轻量，P5 开始时以"当天能出稳定 URL"为唯一标准选定）；`.env` 注入；本地备份运行方案 + 全程录屏备份（线上赛双保险）。
- [ ] **T5.4 视频**（≤3 分钟，基于 PRD 7.1 脚本修订）。**必含两个 AI 原生性证明段落**：
  1. **非脚本时刻（H2）**：镜头前现场想一个从未预设的问题盘陈默（如把 F4 改写成现场版本），完整展示守谎→动摇的回合
  2. **流水线时刻（H3）**：《二手书店》从贴入文本到可审讯的加速剪辑 + 计时字卡
- [ ] **T5.5 提交材料**：计划书（PRD + 本 spec + design.md + eval 报告摘录汇编为 PDF）、Demo URL、视频。

### 8.2 AI 原生性验收项（P5）★ 硬承诺 H2

- [ ] 视频含 ≥1 个完整"非脚本时刻"回合（未预设问题）
- [ ] **部署版抽测**：对线上 URL 跑 P1 测试集的 10 问速测版（Z1-Z4+F1-F6），rubric 通过线同 P1（85%，Z/F 零 0 分）——证明评委玩到的和开发时一致
- [ ] 全部页面过 design.md 第 12 章自检清单

### 阶段门
自检 → 线上抽测报告 → 代码审查 → 用户验收（在部署 URL 上完整玩一周目 + 审视频）→ `git tag phase-p5` → 提交

---

## 9. 进度跟踪

| 阶段 | 状态 | 完成日期 | eval 报告 | 备注 |
|---|---|---|---|---|
| P0 | ✅ 通过 | 2026-09-07 | p0_report.md + 4份dry-run | tag phase-p0；CodeRabbit 4项修复闭环 |
| P1 | ✅ 通过 | 2026-09-08 | p1_free_questions 30问 | 自由盘问+守谎对比通过；泄露保底层后补于 P3 |
| P2 | ✅ 通过 | 2026-09-09 | p2_quote_samples | 划选/关联 eval 通过；抽屉双bug修复 |
| P3 | ✅ 通过 | 2026-09-10 | 三暗线端到端通关 | tsm_phone 泄露可靠化（staged_leaks+服务端保底） |
| P4 | ✅ 通过 | 2026-09-12 | p4_20260912.md | 硬承诺 H3 达成：《蓝血》深度+《端妃黑又壮》轻量双题材 <1min 可玩；S0 故事库+流水线三屏+动态 slot |
| P5 | T5.1-5.3 完成（2026-09-12）；T5.4 视频/T5.5 材料用户自理 | — | 浏览器实测 7/7 | 动效全家桶+reduce 无障碍+故事结尾页+生产单端口部署物料(Dockerfile/启动生产.cmd)；线上 URL 待用户部署账号操作 |

## 10. 变更流程

执行期任何对以下内容的偏离，必须先在对话中向用户说明并获确认，随后更新本 spec 对应章节并升版本号：API 契约（§2.2）、prompt 铁律（§4 T1.2）、硬性承诺（§0.2）、验收通过线、技术选型（§1）。其余实现细节允许执行者自主决定。

## 11. v1.1 变更：官方故事 API 混合接入（2026-09-08，用户拍板）

**背景**：官方 Skill 包（桌面 zhihu/）开放黑客松内容 API：`GET api.zhihu.com/km-indep-home/hackathon/v2/story/{list|{work_id}}`，无鉴权，20 篇约 3000 字/篇。且产品说明必填"使用了哪些知乎开放能力"。

**决策**（三选一中的混合策略）：
1. **主玩法保留《她从不下厨》**——官方 20 篇为第一人称设定反转文，无"多角色口供+物证伏笔"结构，不换数据层
2. **P4 流水线输入源改为官方 API**——原 T4.1 自写《二手书店》fixture 取消；改为：官方列表 → 选篇（候选《蓝血》2025684191967294692，设定悬疑结构最适配）→ LLM 流水线 → 人工确认
3. **新增故事库入口页（S0.5）**——官方列表+封面+标签，真实调用 + 失败降级提示（满足提交检查第 6 条）

**新增硬约束**（来自官方内容边界）：
- 保留作者名/来源展示（author_name 字段必须呈现）
- 不把官方故事正文改写为由应用或用户创作；流水线产物标注"AI 生成的侦探化改编"
- 接口失败展示真实 HTTP 状态，不循环重试

**时间线更新（硬）**：提交窗口 2026-09-13 10:00 至 09-15 10:00。倒排：9/12 完成全部开发（P2-P5），9/13 提交并留缓冲。

## 12. v1.2 变更：定名「二刷」与战略决策固化（2026-09-08，用户拍板）

### 12.1 产品定名

- **产品名**：二刷（原「故事侦探」退役；PRD v1.0 中的名称与定位表述由本节取代，PRD 作为历史文档不回改）
- **项目名称（提交用）**：二刷——AI 故事重读引擎
- **tagline**：一刷读故事，二刷问故事
- **动因**：引擎定位通用化——核心机制是"守谎审讯+证据撬开"的信息不对称游戏，适用于言情/仙侠/脑洞等一切反转类故事（盐言主流标签），非悬疑专属；"N刷"是被媒体论证的大众文化现象（澎湃《"N刷"为何成为时尚》），产品是该行为的 AI 产品化，可作需求背书
- **改名落点**：game/index.html、src/App.jsx、启动开发.cmd、design.md、本 spec 已改；demo/ 为历史验证件保留原名

### 12.2 适配广度回应（对应"20 篇里悬疑只有 4 篇"的担忧）

- 20 篇是黑客松沙盒样本而非 TAM（盐言库 10 万+ 篇、反转是主流标签）
- 适配光谱两档：**深度适配**（多角色多暗线，少数故事）+ **轻量适配**（1-2 守谎角色 + 关键句证据，大多数反转类故事）
- **P4 验收项升级**：流水线实测跑**双题材**——《蓝血》（设定悬疑，深度）+ 一篇言情/仙侠（如《山回路转不见鸡》或《杀仙成道》，轻量），把适配广度从口头辩护变成实验数据

### 12.3 知乎能力策略（对应"开放能力不足"的担忧）

- 立场：生态契合评"闭环深度"不评"API 数量"；核心闭环=内容进（故事 API）→ 侦探化（AI 游戏）→ UGC 出（破案帖回流），不硬接搜索/热榜凑数
- **P3 新增（T3.3 升级）**：结算分享卡采用「知乎回答体」格式——含作者归属（P4 官方故事时的合规硬要求）、破案档案排版、可复制发回故事问题下的文案。定位：生态闭环的可视化证据，非 API 能力；**P3 时间紧时第一个可裁**（降级纯数据卡）
- **P5 伸缩项（默认不做）**：OAuth 登录——官方 app_id 需 9/13 创建项目后才分配，倒排 9/13 拿凭证→9/14 配置→9/15 截止；仅当 P2-P5 主体提前完成且余量 12h+ 才做，否则能力说明如实写"内容 API + 归属展示 + 回流设计"

---

*版本 v1.2 ｜ 2026-09-08 ｜ v1.0 依据 PRD v1.0/design.md v1.1/数据资产 v1.0；v1.1 官方故事 API 混合接入；v1.2 定名「二刷」+ 战略决策固化（§11-12）*
