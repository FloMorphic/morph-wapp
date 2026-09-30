import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ContextRecord, Process } from '@/types/api'
import { contextsApi } from '@/api/contexts'
import { processesApi } from '@/api/processes'

/**
 * The context a flow last ran against, per flow.
 *
 * Every run binds a workflow to one context (see RunFlowButton), so the newest
 * `/process` row of a flow names the document its nodes last read and wrote.
 * That document is the only honest thing to resolve a node's `scope` JSONPath
 * against while designing — which is what the on-node scope peek does — so it is
 * resolved once here and shared, rather than refetched by every node that asks.
 *
 * Cached per flow for the session and invalidated after a launch (the run just
 * started makes its context the new last one). Runtime-only, like processes: in
 * local (no-backend) mode there is no engine and therefore no last run, which
 * the entry reports as `run: null` rather than as an error.
 */

export interface LastRunContext {
  loading: boolean
  error: string | null
  /** The newest run on this flow; null when the flow has never been run. */
  run: Process | null
  /** The context that run was bound to, as the document stands *now*. */
  context: ContextRecord | null
  /** `context.context` parsed, or null while it isn't valid JSON. */
  document: unknown
  /** Epoch millis the entry was resolved at — what "as of" reads from. */
  fetchedAt: number
}

function blank(): LastRunContext {
  return { loading: false, error: null, run: null, context: null, document: null, fetchedAt: 0 }
}

export const useLastRunContextStore = defineStore('lastRunContext', () => {
  const byFlow = ref<Record<string, LastRunContext>>({})

  const isRemote = processesApi.isRemote()

  /** The entry for a flow, or null when nothing has been resolved for it yet. */
  function entry(flowId?: string): LastRunContext | null {
    return flowId ? (byFlow.value[flowId] ?? null) : null
  }

  /**
   * Resolve (once) the newest run of `flowId` and the context it bound. Already
   * resolved entries are returned as they are unless `force` — the document is a
   * snapshot, and a refresh is an explicit act in the UI.
   */
  async function ensure(flowId: string, force = false): Promise<LastRunContext> {
    if (!flowId) return blank()
    const existing = byFlow.value[flowId]
    if (existing && !force && (existing.loading || existing.fetchedAt)) return existing

    const state: LastRunContext = { ...(existing ?? blank()), loading: true, error: null }
    byFlow.value[flowId] = state

    try {
      // Newest-first, so one row is the last run.
      const runs = await processesApi.list({ flowId, per_page: 1 })
      const run = runs.list[0] ?? null
      if (!run?.contextId) {
        byFlow.value[flowId] = { ...blank(), run, fetchedAt: Date.now() }
        return byFlow.value[flowId]
      }
      const context = await contextsApi.get(run.contextId)
      let document: unknown = null
      try {
        document = JSON.parse(context.context)
      } catch {
        document = null
      }
      byFlow.value[flowId] = { loading: false, error: null, run, context, document, fetchedAt: Date.now() }
    } catch (err) {
      byFlow.value[flowId] = { ...blank(), error: (err as Error).message, fetchedAt: Date.now() }
    }
    return byFlow.value[flowId]
  }

  /** Drop a flow's entry (or every entry) — called after a run is launched. */
  function invalidate(flowId?: string): void {
    if (!flowId) {
      byFlow.value = {}
      return
    }
    delete byFlow.value[flowId]
  }

  return { byFlow, isRemote, entry, ensure, invalidate }
})
