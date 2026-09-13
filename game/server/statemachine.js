// 解锁状态机（纯函数，可单测；spec §2.2）
// stage 单调递增：出示证据满足 unlock_triggers 时推进到该层；
// 仅对峙可解的最深层不出现在 unlock_triggers，由 P3 对峙接口处理
// P4 起暗线归属数据化：confront_rule 挂在角色卡上（chain=矛盾链对峙 / stage=崩溃自白），不再硬编码角色 id

/**
 * 计算出示证据后的新 stage
 * @param {object} card 角色卡（含 unlock_triggers: {stageNum: {any?:[], all?:[]}}）
 * @param {number} currentStage 当前层级
 * @param {string[]} shownEvidenceIds 已出示（含本次）的证据 id 列表
 * @returns {number} 新 stage（不低于 currentStage）
 */
export function nextStage(card, currentStage, shownEvidenceIds) {
  let stage = currentStage
  const triggers = card.unlock_triggers || {}
  for (const [key, cond] of Object.entries(triggers)) {
    const target = Number(key)
    if (target <= stage) continue
    const hit = (cond.any && cond.any.some(id => shownEvidenceIds.includes(id))) ||
                (cond.all && cond.all.every(id => shownEvidenceIds.includes(id)))
    if (hit) stage = Math.max(stage, target)
  }
  return stage
}

/** 对峙资格（P3）：规则来自角色卡 confront_rule——{type:'chain',darkLine} 矛盾链成立；{type:'stage',minStage} 崩溃自白 */
export function confrontReady(card, chains = [], stage = 0) {
  const rule = card?.confront_rule
  if (!rule) return false
  if (rule.type === 'stage') return stage >= (rule.minStage ?? 3)
  if (rule.type === 'chain') return chains.some(c => c.verdict === '矛盾' && c.darkLine === rule.darkLine)
  return false
}
