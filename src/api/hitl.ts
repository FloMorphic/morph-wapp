import type { HumanTask, HumanTaskMessage, HumanTaskStatus, Page, PaginationParams } from '@/types/api'
import { apiEnabled, http, list } from './client'
import { readCollection, writeCollection } from '@/lib/localStore'
import { createId, now } from '@/lib/id'
import { nodeSettingsApi } from './nodeSettings'
import { chat as llmChat, chatConfigFromSettings, type ChatMessage } from '@/lib/llmChat'

/**
 * Human-in-the-Loop task repository.
 *
 * Tasks are created by the backend `hitl` svc handler when a workflow reaches a
 * `humanInLoop` node — so there is deliberately **no create/save** here. The UI
 * only reads (list / get), runs the answer / message / close actions, and
 * deletes. Backed by `/hitl` when a backend is configured, otherwise
 * localStorage (which stays empty until something writes a task).
 */

const LOCAL_KEY = 'human_tasks'

export interface HitlListParams extends PaginationParams {
  status?: HumanTaskStatus | ''
}

// ---- Local backend ----------------------------------------------------------

function localAll(): HumanTask[] {
  return readCollection<HumanTask>(LOCAL_KEY).sort((a, b) => b.updatedAt - a.updatedAt)
}

function localList(params?: HitlListParams): Page<HumanTask> {
  let all = localAll()
  const search = params?.search?.toLowerCase()
  if (search) all = all.filter((t) => t.title.toLowerCase().includes(search))
  if (params?.status) all = all.filter((t) => t.status === params.status)
  const perPage = params?.per_page ?? 12
  const page = Math.max(1, params?.page ?? 1)
  const start = (page - 1) * perPage
  return {
    list: all.slice(start, start + perPage),
    total: all.length,
    page,
    per_page: perPage,
    total_pages: Math.max(1, Math.ceil(all.length / perPage)),
  }
}

function localGet(id: string): HumanTask {
  const found = localAll().find((t) => t.id === id)
  if (!found) throw new Error(`Human task ${id} not found`)
  return found
}

function localMutate(id: string, fn: (t: HumanTask) => HumanTask): HumanTask {
  const all = readCollection<HumanTask>(LOCAL_KEY)
  const idx = all.findIndex((t) => t.id === id)
  if (idx < 0) throw new Error(`Human task ${id} not found`)
  const updated = fn(all[idx])
  updated.updatedAt = now()
  all[idx] = updated
  writeCollection(LOCAL_KEY, all)
  return updated
}

function allAnswered(t: HumanTask): boolean {
  return t.questions.every((q) => q.answer !== '')
}

// ---- Local conversation bot -------------------------------------------------
// In backend mode the bot runs server-side (POST /hitl/id/:id/chat|start) so the
// provider token never reaches the browser. In local (no-backend) mode there is
// no server to run it, so we resolve the node's provider profile from
// localStorage and call the model straight from the browser — the same providers
// as the settings schema, via lib/llmChat.

/** Resolve the conversation bot's provider config for a local task: its bound
 *  profile if it names one, else the first `hitl` profile that exists. */
async function localChatConfig(task: HumanTask) {
  let settings: Record<string, unknown> | undefined
  if (task.settingsId) {
    settings = (await nodeSettingsApi.get(task.settingsId).catch(() => null))?.settings
  }
  if (!settings) {
    const profiles = await nodeSettingsApi.listForNode('hitl')
    settings = profiles[0]?.settings
  }
  if (!settings) {
    throw new Error('No HITL chat provider profile found — create one on the Human-in-the-Loop node')
  }
  return chatConfigFromSettings(settings)
}

// Frames the bot's role and guardrails so it stays a Human-in-the-Loop
// facilitator (the node's prompt below is only the brief). Kept in step with the
// backend copy (flomorphic-api api/hitl/chat.go hitlSystemPrompt).
const HITL_SYSTEM_PROMPT = `You are a Human-in-the-Loop assistant inside an automated workflow. The workflow paused because it could not settle something on its own and needs a person's input before it can continue. Your only job is to help that person reach the answers the workflow needs — nothing else.

A brief follows describing what must be established and the context the workflow built up to this point. Work from it:
- Read the brief and context and identify the specific question(s) that must be answered for the workflow to continue.
- In plain language, tell the person what the workflow is stuck on and what you need from them.
- Ask focused questions, a few at a time, and keep every turn aimed at reaching those answers.
- Stay strictly on this task. Do not answer unrelated requests, do not invent facts, and do not make decisions that are the person's to make.
- When you have what the workflow needs, briefly restate the answer(s) so the person can confirm and close the session.

Be concise and clear. The brief follows.`

/** The model's message list for a local task: the fixed mission prompt, the
 *  node's prompt as the brief, the stored thread, then an optional transient
 *  (unsaved) user nudge. Mirrors the backend's buildMessages. */
function localMessages(task: HumanTask, transientUser?: string): ChatMessage[] {
  const msgs: ChatMessage[] = [{ role: 'system', text: HITL_SYSTEM_PROMPT }]
  if (task.prompt?.trim()) msgs.push({ role: 'system', text: `Brief for this session:\n\n${task.prompt}` })
  for (const m of task.messages) msgs.push({ role: m.role, text: m.text })
  if (transientUser?.trim()) msgs.push({ role: 'user', text: transientUser })
  return msgs
}

async function localChat(id: string, text: string): Promise<HumanTask> {
  const before = localGet(id)
  if (before.status === 'closed') throw new Error('this task is closed')
  const cfg = await localChatConfig(before)
  // Record the human turn first so it survives a model failure.
  const withHuman = localMutate(id, (t) => ({
    ...t,
    messages: [...t.messages, { id: createId('msg'), role: 'human', text, at: now() }],
  }))
  const reply = await llmChat(cfg, localMessages(withHuman))
  return localMutate(id, (t) => ({
    ...t,
    messages: [...t.messages, { id: createId('msg'), role: 'assistant', text: reply, at: now() }],
  }))
}

async function localStart(id: string): Promise<HumanTask> {
  const task = localGet(id)
  if (task.status === 'closed') throw new Error('this task is closed')
  if (task.messages.length > 0) return task
  const cfg = await localChatConfig(task)
  const reply = await llmChat(cfg, localMessages(task, 'Begin the conversation with me.'))
  return localMutate(id, (t) => ({
    ...t,
    messages: [...t.messages, { id: createId('msg'), role: 'assistant', text: reply, at: now() }],
  }))
}

// ---- Public API -------------------------------------------------------------

export const hitlApi = {
  isRemote: apiEnabled,

  list(params?: HitlListParams): Promise<Page<HumanTask>> {
    if (apiEnabled()) return list<HumanTask>('/hitl', params as Record<string, unknown>)
    return Promise.resolve(localList(params))
  },

  get(id: string): Promise<HumanTask> {
    if (apiEnabled()) return http.get<HumanTask>(`/hitl/id/${id}`)
    return Promise.resolve(localGet(id))
  },

  answer(id: string, questionId: string, answer: string): Promise<HumanTask> {
    if (apiEnabled()) return http.post<HumanTask>(`/hitl/id/${id}/answer`, { questionId, answer })
    return Promise.resolve(
      localMutate(id, (t) => {
        const questions = t.questions.map((q) =>
          q.id === questionId ? { ...q, answer, answeredAt: now() } : q,
        )
        const next = { ...t, questions }
        next.status = allAnswered(next) ? 'answered' : 'open'
        return next
      }),
    )
  },

  message(id: string, text: string, role: HumanTaskMessage['role'] = 'human'): Promise<HumanTask> {
    if (apiEnabled()) return http.post<HumanTask>(`/hitl/id/${id}/message`, { role, text })
    return Promise.resolve(
      localMutate(id, (t) => ({
        ...t,
        messages: [...t.messages, { id: createId('msg'), role, text, at: now() }],
      })),
    )
  },

  /** Open the session: have the bot produce its first turn from the node's
   *  prompt. Idempotent — a task that already has messages comes back unchanged. */
  start(id: string): Promise<HumanTask> {
    if (apiEnabled()) return http.post<HumanTask>(`/hitl/id/${id}/start`, {})
    return localStart(id)
  },

  /** Send a turn and get the bot's reply. Appends the human turn, runs the model
   *  against the whole thread, and appends the assistant turn. */
  chat(id: string, text: string): Promise<HumanTask> {
    if (apiEnabled()) return http.post<HumanTask>(`/hitl/id/${id}/chat`, { text })
    return localChat(id, text)
  },

  close(id: string): Promise<HumanTask> {
    if (apiEnabled()) return http.post<HumanTask>(`/hitl/id/${id}/close`, {})
    return Promise.resolve(localMutate(id, (t) => ({ ...t, status: 'closed', closedAt: now() })))
  },

  remove(id: string): Promise<void> {
    if (apiEnabled()) return http.delete<void>(`/hitl/id/${id}`)
    writeCollection(
      LOCAL_KEY,
      readCollection<HumanTask>(LOCAL_KEY).filter((t) => t.id !== id),
    )
    return Promise.resolve()
  },
}
