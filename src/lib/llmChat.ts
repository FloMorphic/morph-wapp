/**
 * Browser-side chat-completion client — the local-mode counterpart of the
 * backend `llm` package (flomorphic-api/llm).
 *
 * When a backend is configured the HITL conversation bot runs server-side, so
 * the provider token never reaches the browser. But the app also runs fully
 * standalone (no backend, everything in localStorage), and there the model call
 * has nowhere to go but the browser. This module covers that case: given a
 * provider profile's settings and a message list, it calls the provider directly
 * and returns the assistant's reply — the same providers and field names as the
 * settings schema (`src/lib/settingsSchemas.ts`).
 *
 * It is deliberately only reached in local mode (see api/hitl). In backend mode
 * the token stays on the server.
 */

/** A chat turn. `role` uses the task-thread vocabulary; `human` maps to `user`. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'human'
  text: string
}

/** Provider config resolved from a settings profile's `settings` record. */
export interface ChatConfig {
  provider: string
  model: string
  token: string
  baseUrl: string
  temperature?: number
  maxTokens?: number
}

/** Read a {@link ChatConfig} out of a profile's free-form settings record. */
export function chatConfigFromSettings(settings: Record<string, unknown>): ChatConfig {
  return {
    provider: String(settings.provider ?? '').trim().toLowerCase(),
    model: String(settings.model ?? '').trim(),
    token: String(settings.access_token ?? '').trim(),
    baseUrl: String(settings.url ?? '').trim().replace(/\/$/, ''),
    temperature: toNum(settings.temperature),
    maxTokens: toNum(settings.max_tokens),
  }
}

/** Throw with a clear message when a config can't drive a call. */
export function assertChatConfig(cfg: ChatConfig): void {
  if (!cfg.provider) throw new Error('No LLM provider configured on the HITL node profile')
  if (!cfg.model) throw new Error(`No model configured for provider "${cfg.provider}"`)
  if (!cfg.token) throw new Error(`No access token configured for provider "${cfg.provider}"`)
}

/** Send the conversation to the configured provider; resolve with the reply. */
export async function chat(cfg: ChatConfig, messages: ChatMessage[]): Promise<string> {
  assertChatConfig(cfg)
  switch (cfg.provider) {
    case 'anthropic':
      return chatAnthropic(cfg, messages)
    case 'gemini':
      return chatGemini(cfg, messages)
    default:
      // openai / openrouter / openai-compatible + any custom base URL.
      return chatOpenAI(cfg, messages)
  }
}

// ---- OpenAI family ----------------------------------------------------------

function openAIBase(cfg: ChatConfig): string {
  if (cfg.baseUrl) return cfg.baseUrl
  return cfg.provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1'
}

async function chatOpenAI(cfg: ChatConfig, messages: ChatMessage[]): Promise<string> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: messages.map((m) => ({ role: oaRole(m.role), content: m.text })),
  }
  if (cfg.temperature !== undefined) body.temperature = cfg.temperature
  if (cfg.maxTokens) body.max_tokens = cfg.maxTokens

  const raw = await postJson(`${openAIBase(cfg)}/chat/completions`, body, {
    Authorization: `Bearer ${cfg.token}`,
  })
  const content = raw?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content === '') throw new Error('Model returned no reply')
  return content.trim()
}

function oaRole(role: ChatMessage['role']): string {
  if (role === 'system') return 'system'
  if (role === 'assistant') return 'assistant'
  return 'user'
}

// ---- Anthropic --------------------------------------------------------------

async function chatAnthropic(cfg: ChatConfig, messages: ChatMessage[]): Promise<string> {
  const base = cfg.baseUrl || 'https://api.anthropic.com/v1'
  const system: string[] = []
  const turns: { role: string; content: string }[] = []
  for (const m of messages) {
    if (m.role === 'system') system.push(m.text)
    else turns.push({ role: oaRole(m.role), content: m.text })
  }
  const body: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: cfg.maxTokens && cfg.maxTokens > 0 ? cfg.maxTokens : 1024,
    messages: turns,
  }
  if (system.length) body.system = system.join('\n\n')
  if (cfg.temperature !== undefined) body.temperature = cfg.temperature

  const raw = await postJson(`${base}/messages`, body, {
    'x-api-key': cfg.token,
    'anthropic-version': '2023-06-01',
    // Browsers need this header to call the Anthropic API directly (CORS).
    'anthropic-dangerous-direct-browser-access': 'true',
  })
  const text = Array.isArray(raw?.content)
    ? raw.content.filter((c: { type?: string }) => c.type === 'text').map((c: { text?: string }) => c.text ?? '').join('')
    : ''
  if (!text) throw new Error('Model returned no reply')
  return text.trim()
}

// ---- Gemini -----------------------------------------------------------------

async function chatGemini(cfg: ChatConfig, messages: ChatMessage[]): Promise<string> {
  const base = cfg.baseUrl || 'https://generativelanguage.googleapis.com/v1beta'
  const system: string[] = []
  const contents: { role: string; parts: { text: string }[] }[] = []
  for (const m of messages) {
    if (m.role === 'system') {
      system.push(m.text)
      continue
    }
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })
  }
  const body: Record<string, unknown> = { contents }
  if (system.length) body.system_instruction = { parts: [{ text: system.join('\n\n') }] }
  const gen: Record<string, unknown> = {}
  if (cfg.temperature !== undefined) gen.temperature = cfg.temperature
  if (cfg.maxTokens) gen.maxOutputTokens = cfg.maxTokens
  if (Object.keys(gen).length) body.generationConfig = gen

  const url = `${base}/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.token)}`
  const raw = await postJson(url, body, {})
  const parts = raw?.candidates?.[0]?.content?.parts
  const text = Array.isArray(parts) ? parts.map((p: { text?: string }) => p.text ?? '').join('') : ''
  if (!text) throw new Error('Model returned no reply')
  return text.trim()
}

// ---- shared -----------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function postJson(url: string, body: unknown, headers: Record<string, string>): Promise<any> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw new Error(`LLM request failed: ${(err as Error).message}`)
  }
  const text = await res.text()
  if (!res.ok) {
    let msg = text.slice(0, 500)
    try {
      const j = JSON.parse(text)
      msg = j?.error?.message ?? j?.error ?? msg
    } catch {
      /* keep raw text */
    }
    throw new Error(`Provider returned ${res.status}: ${msg}`)
  }
  return text ? JSON.parse(text) : {}
}

function toNum(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : undefined
}
