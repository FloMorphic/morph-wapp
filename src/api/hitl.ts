import type { HumanTask, HumanTaskMessage, HumanTaskStatus, Page, PaginationParams } from '@/types/api'
import { apiEnabled, http, list } from './client'
import { readCollection, writeCollection } from '@/lib/localStore'
import { createId, now } from '@/lib/id'

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
