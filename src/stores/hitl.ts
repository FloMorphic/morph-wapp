import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { HumanTask, HumanTaskStatus } from '@/types/api'
import { hitlApi } from '@/api/hitl'

/**
 * Human-in-the-Loop task list + the currently open conversation. Page-based
 * pagination matching the morph-api `/hitl` endpoints, plus a status filter
 * (open / answered / closed). There is no create path — tasks are born from a
 * running workflow's `humanInLoop` node.
 */
export const useHitlStore = defineStore('hitl', () => {
  const items = ref<HumanTask[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const search = ref('')
  const status = ref<HumanTaskStatus | ''>('')

  const page = ref(1)
  const totalPages = ref(1)
  const total = ref(0)
  const perPage = ref(12)

  // The task open in the conversation panel.
  const active = ref<HumanTask | null>(null)

  // Live assistant reply being streamed over the `hitl.stream` socket event,
  // accumulated per task id. Cleared when the turn completes (a `done` marker or
  // the final persisted task applied), at which point the stored message shows.
  const streaming = ref<Record<string, string>>({})

  const isRemote = hitlApi.isRemote()

  async function fetchPage(target = 1): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const res = await hitlApi.list({
        page: target,
        per_page: perPage.value,
        search: search.value,
        status: status.value,
      })
      items.value = res.list
      page.value = res.page
      totalPages.value = res.total_pages
      total.value = res.total
    } catch (err) {
      error.value = (err as Error).message
      items.value = []
    } finally {
      loading.value = false
    }
  }

  async function refresh(): Promise<void> {
    await fetchPage(1)
  }

  async function next(): Promise<void> {
    if (page.value >= totalPages.value) return
    await fetchPage(page.value + 1)
  }

  async function prev(): Promise<void> {
    if (page.value <= 1) return
    await fetchPage(page.value - 1)
  }

  async function setSearch(value: string): Promise<void> {
    search.value = value
    await refresh()
  }

  async function setStatus(value: HumanTaskStatus | ''): Promise<void> {
    status.value = value
    await refresh()
  }

  // Sync the active task and its row in the current page after an action.
  function apply(task: HumanTask): void {
    active.value = task
    const idx = items.value.findIndex((t) => t.id === task.id)
    if (idx >= 0) items.value[idx] = task
    // The persisted turn is now on the task — drop any live stream buffer for it.
    clearStream(task.id)
  }

  function clearStream(taskId: string): void {
    if (streaming.value[taskId] === undefined) return
    const next = { ...streaming.value }
    delete next[taskId]
    streaming.value = next
  }

  async function open(id: string): Promise<void> {
    active.value = await hitlApi.get(id)
  }

  function close(): void {
    active.value = null
    streaming.value = {}
  }

  async function answer(id: string, questionId: string, value: string): Promise<void> {
    apply(await hitlApi.answer(id, questionId, value))
  }

  async function sendMessage(id: string, text: string): Promise<void> {
    apply(await hitlApi.message(id, text, 'human'))
  }

  // The conversation bot: `chat` sends a turn and applies the task carrying the
  // bot's reply; `start` opens the session with the bot's first turn from the
  // node's prompt. Both go through the backend chat service (token stays
  // server-side) or the local client-side fallback (see api/hitl).
  async function chat(id: string, text: string): Promise<void> {
    apply(await hitlApi.chat(id, text))
  }

  async function startSession(id: string): Promise<void> {
    apply(await hitlApi.start(id))
  }

  /** Apply a task pushed on the `hitl.message` socket event (backend mode), so an
   *  open panel reflects a turn delivered out of band — a reply the bot produced,
   *  or, later, a message that arrived over a messenger channel. Ignored when it
   *  is not about a task this store is currently showing. */
  function ingestSocketTask(payload: unknown): void {
    const task = payload as HumanTask | null
    if (!task || typeof task.id !== 'string') return
    const known = active.value?.id === task.id || items.value.some((t) => t.id === task.id)
    if (known) apply(task)
  }

  /** Accumulate a `hitl.stream` delta for the open task, or clear its buffer on
   *  the turn's `done` marker. Only the active task's stream is tracked — the
   *  panel is the only place a live reply is shown. */
  function ingestStreamChunk(payload: unknown): void {
    const p = payload as { taskId?: string; delta?: string; done?: boolean } | null
    if (!p || typeof p.taskId !== 'string') return
    if (active.value?.id !== p.taskId) return
    if (p.done) {
      clearStream(p.taskId)
      return
    }
    if (p.delta) {
      streaming.value = { ...streaming.value, [p.taskId]: (streaming.value[p.taskId] ?? '') + p.delta }
    }
  }

  async function closeTask(id: string): Promise<void> {
    apply(await hitlApi.close(id))
  }

  async function remove(id: string): Promise<void> {
    await hitlApi.remove(id)
    if (active.value?.id === id) active.value = null
    const targetPage = items.value.length === 1 && page.value > 1 ? page.value - 1 : page.value
    await fetchPage(targetPage)
  }

  return {
    items,
    loading,
    error,
    search,
    status,
    isRemote,
    page,
    total,
    totalPages,
    active,
    streaming,
    hasPrev: () => page.value > 1,
    hasNext: () => page.value < totalPages.value,
    fetchPage,
    refresh,
    next,
    prev,
    setSearch,
    setStatus,
    open,
    close,
    answer,
    sendMessage,
    chat,
    startSession,
    ingestSocketTask,
    ingestStreamChunk,
    closeTask,
    remove,
  }
})
