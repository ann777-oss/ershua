// prompt dry-run：node eval/run_prompt_preview.js <chenmo|zhoulan|xiaoya> [stage] [出示证据id,逗号分隔]
// P0 AI 原生性验收工具：肉眼核对 prompt 内容完整性与可见性过滤
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCharacterPrompt } from '../server/prompts.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [, , charArg = 'chenmo', stageArg = '0', shownArg = ''] = process.argv

const card = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared/stories/main/characters', `${charArg}.json`), 'utf-8'))
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared/stories/main/evidence.json'), 'utf-8'))

const stage = Number(stageArg)
const shownEvidence = shownArg
  ? shownArg.split(',').map(id => {
      const e = registry.evidences.find(x => x.id === id)
      if (!e) throw new Error(`证据不存在：${id}`)
      return { id: e.id, name: e.name, brief: e.brief }
    })
  : []

const { system, stats } = buildCharacterPrompt(card, stage, shownEvidence)

console.log(system)
console.log('\n' + '='.repeat(50))
console.log('统计（可见性核对用）：')
console.log(JSON.stringify(stats, null, 2))
