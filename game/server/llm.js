// DeepSeek 封装：chat / chatStream；30s 超时 + 1 次重试（SDK 内置）；不可用即抛 LLMUnavailable 走降级
import OpenAI from 'openai'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 轻量 .env 加载（不引入 dotenv 依赖；文件不存在则忽略，走降级）
try {
  const envPath = path.resolve(__dirname, '../.env')
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
} catch { /* .env 不存在 */ }

export class LLMUnavailable extends Error {
  constructor(msg = 'LLM 不可用') { super(msg); this.name = 'LLMUnavailable' }
}

const client = process.env.DEEPSEEK_API_KEY
  ? new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: 'https://api.deepseek.com',
      timeout: 30_000,  // spec §0.3：30s 超时
      maxRetries: 1      // 1 次重试
    })
  : null

export const llmAvailable = () => !!client

/** 非流式对话；json=true 时启用 JSON 输出模式 */
export async function chat(messages, { json = false, temperature = 0.8, maxTokens } = {}) {
  if (!client) throw new LLMUnavailable('DEEPSEEK_API_KEY 未配置')
  const res = await client.chat.completions.create({
    model: 'deepseek-chat',
    messages,
    temperature,
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
    ...(json ? { response_format: { type: 'json_object' } } : {})
  })
  return res.choices[0].message.content
}

/** 流式对话；返回 async iterable 的 stream（审讯角色扮演固定低温：守谎稳定性优先于创造性） */
export async function chatStream(messages, { temperature = 0.5 } = {}) {
  if (!client) throw new LLMUnavailable('DEEPSEEK_API_KEY 未配置')
  return client.chat.completions.create({
    model: 'deepseek-chat',
    messages,
    temperature,
    stream: true
  })
}
