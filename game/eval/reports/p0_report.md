# P0 阶段验收报告

> 日期：2026-09-07 ｜ 阶段：P0 骨架与数据层 ｜ 依据：开发Spec.md §3

## 1. 交付清单

| 任务 | 状态 | 验证方式 |
|---|---|---|
| T0.1 git 仓库与项目骨架 | ✅ | git 基线 commit 8745388（20 文件）；`/api/health` 返回 `{ok:true}`；`npm run build` 通过（50 模块，gzip 48KB） |
| T0.2 样式基建 | ✅ | design-tokens.css（11 色 + 3 字族 token）/ components.css（§7 组件库）/ scenes.css（舞台框架），全 token 引用无硬编码 |
| T0.3 数据迁移 | ✅ | `node scripts/migrate_data.js` 幂等通过：故事 79 段（p01-p79 含章节）、11 证据锚点 + 关键词自检通过、3 角色卡 stage/break_stage/public_profile 生成 |
| T0.4 GET /api/game + S1 | ✅ | API 返回：title/79 段/3 人物/起手证据 2 条（含 brief）/darklineTotal 3；S1 案卷页真实数据渲染 |
| T0.5 prompt dry-run 工具 | ✅ | `node eval/run_prompt_preview.js <char> [stage]`，4 份输出存档本目录 |

## 2. AI 原生性验收（P0 独立项）

| 检查项 | 结果 | 证据文件 |
|---|---|---|
| persona / knows / lies / does_not_know 100% 注入（可见层） | ✅ | p0_dryrun_chenmo_u0.txt（人设五要素齐全） |
| stage=0 时 U1+ 的 knows 不出现在 prompt | ✅ | 陈默 U0：visibleKnows 0/9（外卖/摊牌/锁门等全部不可见——模型不知道就不可能泄露） |
| stage=2 时 U1 内容出现、U1 已破的谎言移除 | ✅ | 陈默 U2：visibleKnows 1/9（外卖事实可见）；activeLies 2/3（「我做的饭」已移除） |
| unlock_map 全部不出现（导演数据不入 prompt） | ✅ | 四份输出 grep 无 unlock_map |
| does_not_know 完整在场（反幻觉第一道墙） | ✅ | 陈默 5/5、周兰 4/4、小雅 3/3（各自 U 层报告） |
| 触发型证据（周兰 ev1_fish_dish）不出示则不可见 | ✅ | 周兰 U0：visibleKnows 1/6（半山小馆事实隐藏，等待出示触发） |

## 3. 数据迁移关键数字

- 故事：79 段，9 章，锚点关键词 11/11 命中（自检曾抓到 1 处漂移：ev3_house 关键词在 p61 而非 p60，校验规则已修正为任一锚点命中）
- 陈默 stage 分布：U1×1、U3×3、U4×5（9 条秘密）；谎言破点 U1/U3/U4
- 周兰：U0×2（叙述 + 触发型）、U2×4；谎言破点均 U2
- 小雅：U1×1、U2×1、U3×3；谎言破点 U2/U3

## 4. 代码审查（人工 checklist §0.3）

- [x] design.md v1.1 合规：无 2.1 硬性禁令违例（无多色相渐变——仅桌面 vignette/照片底色/茶渍白名单项；无卡片套卡片——层级止于 stage→面板→卡片）；色彩字体全走 token
- [x] 无 secrets 入库：.env.example 仅占位；.gitignore 覆盖 .env/tools/node_modules/dist
- [x] API 契约与 spec §2.2 一致（/api/game 字段名、类型核对通过）
- [x] LLM 调用：P0 无 LLM 调用（纯数据层），超时/重试/降级在 P1 落地
- [x] 解锁状态机：P0 未实现（statemachine.js 在 P1-T1 落地），无回退风险
- [x] 附注：design.md §6.1 舞台高度 560→640 已同步修订（demo 验证）

## 5. 环境与异常记录

1. 系统无 git/node：已按用户批准安装便携版到 `tools/`（Node 20.18.0 官方源 + MinGit 2.55 GitHub，均项目内，gitignore，可随时删除）
2. **故事 md 曾意外丢失**：已从对话记录全文重建（数据资产/她从不下厨_故事与伏笔表.md），并随基线 commit 存档——建议养成关键变更即 commit 的习惯
3. 开发中断发现并修复 3 处问题：角色卡 knowledge 嵌套结构、证据 id ev1_fish→ev1_fish_dish（含触发器别名归一）、锚点漂移校验规则
4. 工具层面注意到"并行编辑同一文件可能静默丢失"——已改为顺序编辑 + 落盘验证，后续阶段沿用

## 6. 用户验收指引

```powershell
# 启动（或直接双击项目根目录的 启动开发.cmd）
# 以下假设当前目录为仓库根（工具链相对路径，适配任意 checkout 位置）
cd game
$env:Path = "$PWD\..\tools\node-v20.18.0-win-x64;$env:Path"
npm run dev
# 浏览器打开 http://localhost:5173 —— 应看到：案卷移交页（速读摘要/三人物/起手证据2张/任务栏）
```

验收通过后执行：`git tag phase-p0`，进入 P1（审讯核心循环 + 30 问 eval）。
