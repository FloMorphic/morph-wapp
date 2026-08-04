<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useHitlStore } from '@/stores/hitl'
import type { HumanTask, HumanTaskRef, HumanTaskStatus } from '@/types/api'
import PageShell from '@/components/ui/PageShell.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'

const store = useHitlStore()
onMounted(() => store.refresh())

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

async function send() {
  if (!task.value || !chatInput.value.trim()) return
  panelError.value = null
  busy.value = true
  const text = chatInput.value.trim()
  chatInput.value = ''
  try {
    await store.sendMessage(task.value.id, text)
    // The assistant reply is produced client-side (LLM wiring lands later);
    // for now the human's context questions are persisted to the thread.
  } catch (err) {
    panelError.value = (err as Error).message
  } finally {
    busy.value = false
  }
}

async function closeTask() {
  if (!task.value) return
  if (!window.confirm('Close this task? The workflow will finish at this step.')) return
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

/** A resolved reference's value, rendered readably (objects as pretty JSON). */
function refValue(r: HumanTaskRef): string {
  if (r.value === undefined || r.value === null) return '—'
  if (typeof r.value === 'string') return r.value
  try {
    return JSON.stringify(r.value, null, 2)
  } catch {
    return String(r.value)
  }
}

function formatTime(ms: number): string {
  if (!ms) return ''
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <PageShell
    title="Human Tasks"
    subtitle="Steps where a running workflow needs a person. Each task is a conversation: answer its questions to let the flow continue, or close it to finish the flow at this step."
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
        <!-- The opening turn: the node's prompt with its `{{$.path}}` variables
             filled in against the data the flow captured when it parked. The
             svc handler could not resolve them at run time, so the backend does
             it on read — `promptResolved` is that, `prompt` the raw template. -->
        <section v-if="task.promptResolved || task.prompt" class="space-y-2">
          <h4 class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Prompt</h4>
          <p class="whitespace-pre-wrap rounded-lg border bg-surface-2 p-3 text-[13px] leading-relaxed text-fg">
            {{ task.promptResolved || task.prompt }}
          </p>
        </section>

        <!-- Context the node pointed at by name, resolved the same way. -->
        <section v-if="task.refs?.length" class="space-y-2">
          <h4 class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Context</h4>
          <details v-for="r in task.refs" :key="r.name" class="rounded-lg border bg-surface-2 p-2">
            <summary class="cursor-pointer text-[12px] text-fg-muted">
              <span class="font-medium text-fg">{{ r.name }}</span>
              <span class="ml-1.5 font-mono text-[11px] text-fg-subtle">{{ r.path }}</span>
            </summary>
            <pre class="mt-2 max-h-40 overflow-auto rounded-md bg-surface p-2 font-mono text-[11px] leading-relaxed">{{ refValue(r) }}</pre>
          </details>
        </section>

        <!-- Questions -->
        <section class="space-y-3">
          <h4 class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Questions</h4>
          <p v-if="task.questions.length === 0" class="text-[13px] text-fg-muted">
            This task has no explicit questions — review the context and close it when done.
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

        <!-- Chat: understand the context -->
        <section class="space-y-2">
          <h4 class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Discuss context</h4>
          <div v-if="task.messages.length" class="max-h-56 space-y-2 overflow-y-auto rounded-lg border bg-surface-2 p-3">
            <div v-for="m in task.messages" :key="m.id" class="flex" :class="m.role === 'human' ? 'justify-end' : 'justify-start'">
              <div
                class="max-w-[80%] rounded-lg px-3 py-1.5 text-[13px]"
                :class="m.role === 'human' ? 'bg-accent text-white' : 'bg-surface text-fg'"
              >
                <p class="whitespace-pre-wrap">{{ m.text }}</p>
                <p class="mt-0.5 text-[10px] opacity-70">{{ formatTime(m.at) }}</p>
              </div>
            </div>
          </div>
          <p v-else class="text-[12px] text-fg-subtle">
            Ask a question here to reason about the task before you answer. Replies from the assistant are wired on the
            client (coming soon); your notes are saved to the task.
          </p>
          <div v-if="!isClosed" class="flex items-end gap-2">
            <textarea
              v-model="chatInput"
              rows="1"
              class="input text-[13px]"
              placeholder="Ask about this task…"
              @keydown.enter.exact.prevent="send"
            />
            <Button variant="outline" icon="chevron-right" :disabled="busy || !chatInput.trim()" @click="send">Send</Button>
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
