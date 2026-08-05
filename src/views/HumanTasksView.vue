<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useHitlStore } from '@/stores/hitl'
import { useFlowLogsStore } from '@/stores/flowLogs'
import type { HumanTask, HumanTaskStatus } from '@/types/api'
import PageShell from '@/components/ui/PageShell.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'

const store = useHitlStore()
// The bot's reply streams over the shared runtime socket (`hitl.stream`); connect
// it while this page is open so the live tokens arrive. The chat still works
// without it — the reply also comes back on the HTTP response.
const logs = useFlowLogsStore()
onMounted(() => {
  store.refresh()
  if (store.isRemote) logs.connect()
})

// The assistant reply currently streaming for the open task, if any.
const liveStream = computed(() => (store.active ? store.streaming[store.active.id] ?? '' : ''))

const searchInput = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
function onSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => store.setSearch(searchInput.value), 250)
}

const filters: { label: string; value: HumanTaskStatus | '' }[] = [
  { label: 'All', value: '' },
  { label: 'Open', value: 'open' },
  { label: 'Answered', value: 'answered' },
  { label: 'Closed', value: 'closed' },
]

// ---- Conversation panel ----------------------------------------------------

const task = computed(() => store.active)
// Per-question answer drafts, re-seeded whenever a task is opened.
const drafts = reactive<Record<string, string>>({})
const chatInput = ref('')
const busy = ref(false)
const panelError = ref<string | null>(null)

watch(
  () => store.active?.id,
  () => {
    for (const k of Object.keys(drafts)) delete drafts[k]
    if (store.active) {
      for (const q of store.active.questions) drafts[q.id] = q.answer
    }
    chatInput.value = ''
    panelError.value = null
  },
)

const answeredCount = computed(() => task.value?.questions.filter((q) => q.answer !== '').length ?? 0)
const isClosed = computed(() => task.value?.status === 'closed')
// The bot is producing a turn (start / reply). Drives the input lock + indicator.
const thinking = ref(false)
const canConverse = computed(() => !!task.value && !isClosed.value)

async function openTask(t: HumanTask) {
  await store.open(t.id)
}

async function saveAnswer(questionId: string) {
  if (!task.value) return
  panelError.value = null
  busy.value = true
  try {
    await store.answer(task.value.id, questionId, drafts[questionId] ?? '')
  } catch (err) {
    panelError.value = (err as Error).message
  } finally {
    busy.value = false
  }
}

// Open the session: the bot produces its first turn from the node's prompt.
async function startSession() {
  if (!task.value || thinking.value) return
  panelError.value = null
  thinking.value = true
  try {
    await store.startSession(task.value.id)
  } catch (err) {
    panelError.value = (err as Error).message
  } finally {
    thinking.value = false
  }
}

// Send a turn to the conversation bot and apply its reply. The human turn is
// recorded server-side (or client-side in local mode) before the model runs, so
// it survives a provider failure — the error just surfaces here.
async function send() {
  if (!task.value || !chatInput.value.trim() || thinking.value) return
  panelError.value = null
  thinking.value = true
  const text = chatInput.value.trim()
  chatInput.value = ''
  try {
    await store.chat(task.value.id, text)
  } catch (err) {
    panelError.value = (err as Error).message
  } finally {
    thinking.value = false
  }
}

async function closeTask() {
  if (!task.value) return
  if (!window.confirm('Close this task? A parked workflow continues from here.')) return
  busy.value = true
  try {
    await store.closeTask(task.value.id)
  } catch (err) {
    panelError.value = (err as Error).message
  } finally {
    busy.value = false
  }
}

async function removeActive() {
  if (!task.value) return
  if (!window.confirm(`Delete task "${task.value.title}"?`)) return
  await store.remove(task.value.id)
}

async function removeRow(t: HumanTask, e: Event) {
  e.stopPropagation()
  if (!window.confirm(`Delete task "${t.title}"?`)) return
  await store.remove(t.id)
}

// ---- presentation helpers --------------------------------------------------

function statusClass(s: HumanTaskStatus): string {
  return {
    open: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    answered: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    closed: 'bg-slate-500/15 text-fg-muted',
  }[s]
}

function progress(t: HumanTask): string {
  const done = t.questions.filter((q) => q.answer !== '').length
  return `${done}/${t.questions.length}`
}

function formatTime(ms: number): string {
  if (!ms) return ''
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <PageShell
    title="Human Tasks"
    subtitle="Steps where a running workflow could not decide on its own. Each task is a conversation: work out what is being asked, answer it, then close the task — a workflow parked at this step continues from where it stopped."
  >
    <div class="mb-5 flex flex-wrap items-center gap-3">
      <div class="flex items-center gap-1 rounded-lg bg-surface-2 p-1">
        <button
          v-for="f in filters"
          :key="f.value"
          class="rounded-md px-3 py-1 text-[13px] font-medium transition-colors"
          :class="store.status === f.value ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg'"
          @click="store.setStatus(f.value)"
        >
          {{ f.label }}
        </button>
      </div>
      <div class="relative max-w-xs flex-1">
        <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle">
          <Icon name="search" :size="16" />
        </span>
        <input v-model="searchInput" class="input pl-9" placeholder="Search tasks…" @input="onSearch" />
      </div>
      <span class="text-xs text-fg-subtle">{{ store.isRemote ? 'morph-api' : 'local storage' }}</span>
    </div>

    <div v-if="store.loading" class="py-16 text-center text-sm text-fg-muted">Loading tasks…</div>

    <div v-else-if="store.error" class="rounded-xl border border-dashed px-6 py-12 text-center">
      <p class="text-sm text-danger">{{ store.error }}</p>
      <Button class="mt-4" icon="refresh" @click="store.refresh()">Retry</Button>
    </div>

    <EmptyState
      v-else-if="store.items.length === 0"
      icon="node-human"
      title="No human tasks"
      description="Human tasks appear here when a workflow hits a Human-in-the-Loop node and needs a person to answer before it can proceed."
    />

    <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <button
        v-for="t in store.items"
        :key="t.id"
        class="card group flex flex-col p-4 text-left transition-colors hover:border-accent-border"
        @click="openTask(t)"
      >
        <div class="flex items-start justify-between gap-2">
          <span class="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Icon name="node-human" :size="18" />
          </span>
          <div class="flex items-center gap-2">
            <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize" :class="statusClass(t.status)">
              {{ t.status }}
            </span>
            <span
              class="rounded-lg p-1.5 text-fg-subtle opacity-0 transition hover:bg-danger-soft hover:text-danger group-hover:opacity-100"
              title="Delete"
              @click="removeRow(t, $event)"
            >
              <Icon name="trash" :size="15" />
            </span>
          </div>
        </div>
        <h3 class="mt-3 truncate font-semibold text-fg">{{ t.title }}</h3>
        <p class="mt-1 text-[12px] text-fg-subtle">
          {{ t.questions.length }} question{{ t.questions.length === 1 ? '' : 's' }} · {{ progress(t) }} answered
        </p>
        <div class="mt-3 flex flex-wrap items-center gap-1.5">
          <span v-if="t.messages.length" class="chip">{{ t.messages.length }} msg</span>
          <span v-if="t.flowId" class="chip font-mono">flow {{ t.flowId.slice(0, 8) }}</span>
          <span v-if="t.updatedAt" class="ml-auto text-[11px] text-fg-subtle">{{ formatTime(t.updatedAt) }}</span>
        </div>
      </button>
    </div>

    <div v-if="!store.loading && store.items.length" class="mt-6 flex items-center justify-center gap-3">
      <Button icon="chevron-left" :disabled="!store.hasPrev()" @click="store.prev()">Previous</Button>
      <span class="text-xs text-fg-subtle">Page {{ store.page }} of {{ store.totalPages }} · {{ store.total }} total</span>
      <Button :disabled="!store.hasNext()" @click="store.next()">
        Next <Icon name="chevron-right" :size="15" />
      </Button>
    </div>

    <!-- Conversation panel -->
    <Modal
      :open="!!task"
      :title="task?.title ?? 'Human task'"
      :subtitle="task ? `${answeredCount}/${task.questions.length} answered · ${task.status}` : ''"
      @close="store.close()"
    >
      <div v-if="task" class="space-y-5">
        <!-- The opening turn: the node's prompt, already carrying whatever the
             flow built up to the point it parked — the runtime resolved its
             `{{$.path}}` variables before the task was recorded. -->
        <section v-if="task.prompt" class="space-y-2">
          <h4 class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Prompt</h4>
          <p class="whitespace-pre-wrap rounded-lg border bg-surface-2 p-3 text-[13px] leading-relaxed text-fg">
            {{ task.prompt }}
          </p>
        </section>

        <!-- Questions -->
        <section class="space-y-3">
          <h4 class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Questions</h4>
          <p v-if="task.questions.length === 0" class="text-[13px] text-fg-muted">
            No questions yet — they are raised in the conversation below as the subject gets pinned down. Close the task
            when you are done.
          </p>
          <div v-for="(q, i) in task.questions" :key="q.id" class="rounded-lg border bg-surface-2 p-3">
            <div class="flex items-start gap-2">
              <span
                class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                :class="q.answer ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-surface text-fg-subtle'"
              >
                <Icon v-if="q.answer" name="check" :size="12" />
                <template v-else>{{ i + 1 }}</template>
              </span>
              <p class="text-[13px] font-medium text-fg">{{ q.text }}</p>
            </div>
            <div class="mt-2 pl-7">
              <textarea
                v-model="drafts[q.id]"
                rows="2"
                :disabled="isClosed"
                class="input text-[13px]"
                placeholder="Type your answer…"
              />
              <div class="mt-1.5 flex items-center justify-between">
                <span v-if="q.answeredAt" class="text-[11px] text-fg-subtle">answered {{ formatTime(q.answeredAt) }}</span>
                <span v-else />
                <Button
                  variant="primary"
                  icon="save"
                  :disabled="busy || isClosed || (drafts[q.id] ?? '') === q.answer"
                  @click="saveAnswer(q.id)"
                >
                  Save answer
                </Button>
              </div>
            </div>
          </div>
        </section>

        <!-- Conversation: the bot works out what to ask, the person answers, and
             the whole thread is saved on the task until it is closed. -->
        <section class="space-y-2">
          <h4 class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Conversation</h4>
          <div
            v-if="task.messages.length || thinking || liveStream"
            class="max-h-72 space-y-2 overflow-y-auto rounded-lg border bg-surface-2 p-3"
          >
            <div v-for="m in task.messages" :key="m.id" class="flex" :class="m.role === 'human' ? 'justify-end' : 'justify-start'">
              <div
                class="max-w-[80%] rounded-lg px-3 py-1.5 text-[13px]"
                :class="m.role === 'human' ? 'bg-accent text-white' : 'bg-surface text-fg'"
              >
                <p class="whitespace-pre-wrap">{{ m.text }}</p>
                <p class="mt-0.5 text-[10px] opacity-70">{{ formatTime(m.at) }}</p>
              </div>
            </div>
            <!-- Bot is producing a turn: the reply streams in token by token, or
                 a spinner until the first token arrives. -->
            <div v-if="thinking || liveStream" class="flex justify-start">
              <div class="max-w-[80%] rounded-lg bg-surface px-3 py-1.5 text-[13px] text-fg">
                <p v-if="liveStream" class="whitespace-pre-wrap">{{ liveStream }}<span class="animate-pulse">▋</span></p>
                <div v-else class="flex items-center gap-1.5 text-fg-muted">
                  <Icon name="refresh" :size="14" class="animate-spin" />
                  <span>Assistant is thinking…</span>
                </div>
              </div>
            </div>
          </div>

          <!-- No thread yet: offer to open the session from the node's prompt. -->
          <div v-else class="rounded-lg border border-dashed bg-surface-2 p-4 text-center">
            <p class="text-[12px] text-fg-subtle">
              Start the session to have the assistant read the task and begin the conversation. It works out the
              questions with you; answer them, then close the task.
            </p>
            <Button
              v-if="canConverse"
              class="mt-3"
              variant="primary"
              icon="prompt"
              :disabled="thinking"
              @click="startSession"
            >
              Start session
            </Button>
          </div>

          <div v-if="canConverse && task.messages.length" class="flex items-end gap-2">
            <textarea
              v-model="chatInput"
              rows="1"
              class="input text-[13px]"
              placeholder="Reply to the assistant…"
              :disabled="thinking"
              @keydown.enter.exact.prevent="send"
            />
            <Button variant="outline" icon="chevron-right" :disabled="thinking || !chatInput.trim()" @click="send">Send</Button>
          </div>
        </section>

        <p v-if="panelError" class="text-sm text-danger">{{ panelError }}</p>
      </div>

      <template #footer>
        <Button icon="trash" :disabled="busy" @click="removeActive">Delete</Button>
        <Button variant="ghost" @click="store.close()">Close panel</Button>
        <Button variant="primary" icon="check" :disabled="busy || isClosed" @click="closeTask">
          {{ isClosed ? 'Closed' : 'Close task' }}
        </Button>
      </template>
    </Modal>
  </PageShell>
</template>
