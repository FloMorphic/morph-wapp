import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * App-wide toast notifications.
 *
 * Two sources feed the same stack:
 *   - the backend's `notification` socket event (scheduler launches, action
 *     outcomes) — see flowLogs.connect(), which forwards payloads to ingest();
 *   - local calls to notify() from views/stores after an API action succeeds
 *     or fails.
 *
 * Toasts auto-dismiss after a level-dependent delay; errors stick around
 * longer. ToastHost.vue renders the stack.
 */

export type NotificationLevel = 'success' | 'error' | 'warning' | 'info'

export interface ToastNotification {
  id: string
  level: NotificationLevel
  title?: string
  message: string
  /** Epoch millis — backend `ts` when remote, Date.now() when local. */
  ts: number
}

/** Auto-dismiss delay per level; errors linger so they can be read. */
const DISMISS_MS: Record<NotificationLevel, number> = {
  success: 4000,
  info: 4000,
  warning: 6000,
  error: 8000,
}

/** Keep the stack short — older toasts drop off the bottom. */
const MAX_TOASTS = 5

const LEVELS: NotificationLevel[] = ['success', 'error', 'warning', 'info']

export const useNotificationsStore = defineStore('notifications', () => {
  const toasts = ref<ToastNotification[]>([])
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  }

  function dismiss(id: string): void {
    const t = timers.get(id)
    if (t) {
      clearTimeout(t)
      timers.delete(id)
    }
    toasts.value = toasts.value.filter((n) => n.id !== id)
  }

  /** Show a toast. Local API actions call this directly. */
  function notify(input: {
    level: NotificationLevel
    message: string
    title?: string
    ts?: number
  }): void {
    const toast: ToastNotification = {
      id: generateId(),
      level: input.level,
      title: input.title,
      message: input.message,
      ts: input.ts ?? Date.now(),
    }
    toasts.value.push(toast)
    while (toasts.value.length > MAX_TOASTS) {
      dismiss(toasts.value[0].id)
    }
    timers.set(
      toast.id,
      setTimeout(() => dismiss(toast.id), DISMISS_MS[toast.level]),
    )
  }

  /** Feed a raw `notification` socket payload; anything unusable is dropped. */
  function ingest(payload: unknown): void {
    const raw = typeof payload === 'string' ? safeParse(payload) : payload
    if (!raw || typeof raw !== 'object') return
    const n = raw as { level?: unknown; title?: unknown; message?: unknown; ts?: unknown }
    if (typeof n.message !== 'string' || n.message.length === 0) return
    const level = LEVELS.includes(n.level as NotificationLevel)
      ? (n.level as NotificationLevel)
      : 'info'
    notify({
      level,
      message: n.message,
      title: typeof n.title === 'string' && n.title ? n.title : undefined,
      ts: typeof n.ts === 'number' ? n.ts : undefined,
    })
  }

  function clear(): void {
    for (const id of [...timers.keys()]) dismiss(id)
    toasts.value = []
  }

  return { toasts, notify, ingest, dismiss, clear }
})

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
