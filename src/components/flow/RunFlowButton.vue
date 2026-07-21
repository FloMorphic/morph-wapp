<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { ContextRecord, Process } from '@/types/api'
import { contextsApi } from '@/api/contexts'
import { processesApi } from '@/api/processes'
import { processStatusClass, formatProcessTime } from '@/lib/process'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'

/**
 * "Run" affordance for the workflow editor toolbar. Every run binds a workflow to
 * a context, so opening this picks the context to launch against: the contexts
 * already used on this flow are grouped first (from its recent processes), then
 * all other contexts. A new context can be created inline with just a name and
 * launched in one step. Launching posts to `/process` (POST /process assembles
 * the engine request meta server-side, so only { flowId, contextId } is sent).
 *
 * Only meaningful against a connected backend with a saved flow — there is no
 * engine to run anything in local (no-backend) mode, and an unsaved flow has no
 * id to bind a run to.
 */
const props = defineProps<{ flowId?: string; dirty?: boolean }>()

const router = useRouter()
const remote = processesApi.isRemote()

const open = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)

const contexts = ref<ContextRecord[]>([])
/** contextId → the most recent run on this flow that used it, newest-first order. */
const recentIds = ref<string[]>([])
const recentRun = ref<Record<string, Process>>({})

const search = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined

// Inline "create a context by name" then launch.
const newTitle = ref('')
const creating = ref(false)

// Which context id is mid-launch, and the last successfully launched run.
const runningId = ref<string | null>(null)
const launched = ref<Process | null>(null)

const canRun = computed(() => remote && !!props.flowId)

/** Contexts already used on this flow (recent runs), newest-used first. */
const recentContexts = computed(() => {
  const byId = new Map(contexts.value.map((c) => [c.id, c]))
  return recentIds.value.map((id) => byId.get(id)).filter((c): c is ContextRecord => !!c)
})

/**
 * The context this flow ran against most recently — the default for the next
 * run. Empty until the flow has been run at least once. After each launch
 * {@link load} refreshes the recent order, so the just-used context becomes the
 * new default.
 */
const defaultId = computed(() => recentIds.value[0] ?? '')

/** Every other context, minus the ones surfaced in the recent group. */
const otherContexts = computed(() => {
  const seen = new Set(recentIds.value)
  return contexts.value.filter((c) => !seen.has(c.id))
})

async function load() {
  if (!canRun.value) return
  loading.value = true
  error.value = null
  try {
    const [ctxPage, runs] = await Promise.all([
      contextsApi.list({ per_page: 100, search: search.value }),
      // All statuses, newest-first, to learn which contexts this flow has used.
      processesApi.list({ flowId: props.flowId, per_page: 50 }),
    ])
    contexts.value = ctxPage.list
    const order: string[] = []
    const runMap: Record<string, Process> = {}
    for (const run of runs.list) {
      if (!run.contextId || runMap[run.contextId]) continue
      runMap[run.contextId] = run
      order.push(run.contextId)
    }
    recentIds.value = order
    recentRun.value = runMap
  } catch (err) {
    error.value = (err as Error).message
    contexts.value = []
    recentIds.value = []
    recentRun.value = {}
  } finally {
    loading.value = false
  }
}

function openPicker() {
  if (!canRun.value) return
  open.value = true
  launched.value = null
  error.value = null
  newTitle.value = ''
  load()
}

function onSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(load, 250)
}

async function run(context: ContextRecord) {
  if (!props.flowId || runningId.value) return
  runningId.value = context.id
  error.value = null
  try {
    const rec = await processesApi.start({ flowId: props.flowId, contextId: context.id })
    launched.value = rec
    // Reflect the just-launched run in the "recent" grouping.
    await load()
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    runningId.value = null
  }
}

async function createAndRun() {
  const title = newTitle.value.trim()
  if (!title || creating.value) return
  creating.value = true
  error.value = null
  try {
    // A brand-new context starts as an empty JSON document; nodes fill it at run time.
    const rec = await contextsApi.save({ title, context: '{}' })
    newTitle.value = ''
    contexts.value = [rec, ...contexts.value]
    await run(rec)
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    creating.value = false
  }
}

function viewRun() {
  open.value = false
  router.push({ name: 'processes' })
}

/** One-line, top-level-key summary of a context document. */
function summary(c: ContextRecord): string {
  try {
    const parsed = JSON.parse(c.context)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const keys = Object.keys(parsed)
      return keys.length ? `${keys.length} key${keys.length === 1 ? '' : 's'}` : 'empty document'
    }
  } catch {
    /* fall through */
  }
  return 'document'
}
</script>

<template>
  <!-- Only meaningful against a backend; disabled (with a hint) until the flow is saved. -->
  <div v-if="remote">
    <Button
      variant="primary"
      icon="play"
      :disabled="!flowId"
      :title="flowId ? 'Run this workflow against a context' : 'Save the workflow before running it'"
      @click="openPicker"
    >
      Run
    </Button>

    <Modal
      :open="open"
      title="Run workflow"
      subtitle="Pick the context to bind this run to, or create one."
      @close="open = false"
    >
      <div class="space-y-4">
        <p v-if="dirty" class="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-600 dark:text-amber-400">
          <Icon name="alert-triangle" :size="14" />
          Unsaved changes — the run uses the last saved version of this flow.
        </p>

        <!-- Launch success -->
        <div
          v-if="launched"
          class="flex items-center gap-3 rounded-lg bg-emerald-500/10 px-3 py-2.5 text-[13px] text-emerald-700 dark:text-emerald-400"
        >
          <Icon name="check" :size="16" />
          <span>Launched run <span class="font-mono font-semibold">#{{ launched.indexId }}</span>.</span>
          <button class="ml-auto flex items-center gap-1 font-medium hover:underline" @click="viewRun">
            View <Icon name="chevron-right" :size="14" />
          </button>
        </div>

        <!-- Quick create: a context from just a name, launched immediately. -->
        <div class="space-y-1.5">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">New context</label>
          <div class="flex items-center gap-2">
            <input
              v-model="newTitle"
              class="input min-w-0 flex-1"
              placeholder="Name a new context…"
              @keydown.enter.prevent="createAndRun"
            />
            <Button
              variant="primary"
              icon="play"
              :disabled="!newTitle.trim() || creating || !!runningId"
              @click="createAndRun"
            >
              {{ creating ? 'Creating…' : 'Create & run' }}
            </Button>
          </div>
        </div>

        <!-- Search over existing contexts -->
        <div class="relative">
          <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle">
            <Icon name="search" :size="15" />
          </span>
          <input v-model="search" class="input pl-9" placeholder="Search contexts…" @input="onSearch" />
        </div>

        <p v-if="error" class="text-sm text-danger">{{ error }}</p>

        <div v-if="loading" class="py-8 text-center text-sm text-fg-muted">Loading contexts…</div>

        <div
          v-else-if="contexts.length === 0"
          class="rounded-lg border border-dashed px-4 py-8 text-center text-[13px] text-fg-muted"
        >
          No contexts yet. Name one above to create and run it.
        </div>

        <div v-else class="max-h-[42vh] space-y-4 overflow-y-auto pr-0.5">
          <!-- Contexts already used on this flow -->
          <section v-if="recentContexts.length" class="space-y-1.5">
            <h4 class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Recently used on this flow</h4>
            <div class="divide-y rounded-lg border">
              <div
                v-for="c in recentContexts"
                :key="c.id"
                class="flex items-center gap-3 px-3 py-2.5"
                :class="c.id === defaultId ? 'bg-accent-soft/40' : ''"
              >
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <Icon name="context" :size="16" />
                </span>
                <div class="min-w-0 flex-1">
                  <p class="flex items-center gap-1.5 truncate text-[13px] font-medium text-fg">
                    <span class="truncate">{{ c.title }}</span>
                    <span
                      v-if="c.id === defaultId"
                      class="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent"
                    >Default</span>
                  </p>
                  <p class="flex items-center gap-1.5 text-[11px] text-fg-subtle">
                    <span
                      v-if="recentRun[c.id]"
                      class="rounded-full px-1.5 py-0.5 font-semibold capitalize"
                      :class="processStatusClass(recentRun[c.id].status)"
                    >{{ recentRun[c.id].status }}</span>
                    <span>{{ formatProcessTime(recentRun[c.id]?.startedAt) || summary(c) }}</span>
                  </p>
                </div>
                <Button
                  :variant="c.id === defaultId ? 'primary' : 'outline'"
                  icon="play"
                  :disabled="!!runningId"
                  :title="`Run against ${c.title}`"
                  @click="run(c)"
                >
                  {{ runningId === c.id ? 'Running…' : 'Run' }}
                </Button>
              </div>
            </div>
          </section>

          <!-- Everything else -->
          <section v-if="otherContexts.length" class="space-y-1.5">
            <h4 v-if="recentContexts.length" class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">All contexts</h4>
            <div class="divide-y rounded-lg border">
              <div
                v-for="c in otherContexts"
                :key="c.id"
                class="flex items-center gap-3 px-3 py-2.5"
              >
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-fg-muted">
                  <Icon name="context" :size="16" />
                </span>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-[13px] font-medium text-fg">{{ c.title }}</p>
                  <p class="truncate text-[11px] text-fg-subtle">{{ summary(c) }}</p>
                </div>
                <Button
                  icon="play"
                  :disabled="!!runningId"
                  :title="`Run against ${c.title}`"
                  @click="run(c)"
                >
                  {{ runningId === c.id ? 'Running…' : 'Run' }}
                </Button>
              </div>
            </div>
          </section>
        </div>
      </div>

      <template #footer>
        <Button variant="ghost" @click="open = false">Close</Button>
      </template>
    </Modal>
  </div>
</template>
