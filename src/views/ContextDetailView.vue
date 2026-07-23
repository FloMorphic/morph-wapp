<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { contextsApi } from '@/api/contexts'
import type { ContextRecord } from '@/types/api'
import { useNotificationsStore } from '@/stores/notifications'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import CodeEditor from '@/components/ui/CodeEditor.vue'
import JsonTreeNode from '@/components/ui/JsonTreeNode.vue'

/**
 * Full-page context inspector/editor (replaces the old cramped modal). Two
 * synced views over the same document: an expandable Tree for reading and a
 * CodeMirror JSON editor for editing. The optional `header` metadata opens as
 * a second panel side by side. Reached from the Contexts list, the Processes
 * table and the workflow editor's "open context" affordances — `/contexts/:id`
 * is a stable address an operator can land on right after a run.
 */
const props = defineProps<{ id?: string }>()

const router = useRouter()
const notifications = useNotificationsStore()

const isNew = computed(() => !props.id)

const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)

const record = ref<ContextRecord | null>(null)
const title = ref('')
const rawContext = ref('{\n  \n}')
const rawHeader = ref('{}')

const activeView = ref<'tree' | 'json'>('json')
const showHeader = ref(false)
/** Soft-wrap long lines in the JSON editors. */
const wrapLines = ref(false)

// ---- Validation -------------------------------------------------------------

function tryParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function jsonProblem(raw: string): string | null {
  try {
    JSON.parse(raw)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid JSON'
  }
}

const contextProblem = computed(() => jsonProblem(rawContext.value))
const headerProblem = computed(() => (rawHeader.value.trim() ? jsonProblem(rawHeader.value) : null))
const hasProblem = computed(() => !!contextProblem.value || !!headerProblem.value)

/** Parsed context for the tree view; null while the JSON is broken. */
const parsedContext = computed<Record<string, unknown> | null>(() => {
  const parsed = tryParse(rawContext.value)
  if (parsed === undefined) return null
  return isPlainObject(parsed) ? parsed : { value: parsed }
})

const parsedHeader = computed<Record<string, unknown> | null>(() => {
  const parsed = tryParse(rawHeader.value || '{}')
  if (parsed === undefined) return null
  return isPlainObject(parsed) ? parsed : { value: parsed }
})

// ---- Load -------------------------------------------------------------------

async function fetchContext() {
  if (!props.id) return
  loading.value = true
  error.value = null
  try {
    const rec = await contextsApi.get(props.id)
    record.value = rec
    title.value = rec.title
    const parsed = tryParse(rec.context)
    rawContext.value = parsed === undefined ? rec.context : JSON.stringify(parsed, null, 2)
    rawHeader.value =
      rec.header && Object.keys(rec.header).length ? JSON.stringify(rec.header, null, 2) : '{}'
    if (rec.header && Object.keys(rec.header).length) showHeader.value = true
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

onMounted(fetchContext)
// Same component instance is reused when navigating between context ids.
watch(
  () => props.id,
  () => {
    if (props.id) fetchContext()
  },
)

// ---- Actions ----------------------------------------------------------------

function formatDocuments() {
  const ctx = tryParse(rawContext.value)
  if (ctx !== undefined) rawContext.value = JSON.stringify(ctx, null, 2)
  const hdr = tryParse(rawHeader.value)
  if (hdr !== undefined) rawHeader.value = JSON.stringify(hdr, null, 2)
}

async function copyContext() {
  try {
    await navigator.clipboard.writeText(rawContext.value)
    notifications.notify({ level: 'success', message: 'Context JSON copied to clipboard.' })
  } catch {
    notifications.notify({ level: 'error', message: 'Could not access the clipboard.' })
  }
}

async function save() {
  error.value = null
  if (!title.value.trim()) {
    error.value = 'Give the context a title.'
    return
  }
  const context = tryParse(rawContext.value)
  if (!isPlainObject(context)) {
    error.value = 'The context must be a valid JSON object.'
    return
  }
  let header: Record<string, unknown> = {}
  if (rawHeader.value.trim()) {
    const parsedHdr = tryParse(rawHeader.value)
    if (!isPlainObject(parsedHdr)) {
      error.value = 'Header must be a valid JSON object (or empty).'
      return
    }
    header = parsedHdr
  }
  saving.value = true
  try {
    const rec = await contextsApi.save({
      id: props.id,
      title: title.value.trim(),
      // Compact, canonical serialization — the backend re-validates.
      context: JSON.stringify(context),
      header,
    })
    notifications.notify({ level: 'success', message: `Context "${rec.title}" saved.` })
    if (isNew.value) {
      router.replace({ name: 'context-detail', params: { id: rec.id } })
    } else {
      await fetchContext()
    }
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    saving.value = false
  }
}

function goBack() {
  router.push({ name: 'contexts' })
}

function formatTime(ms: number | undefined): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <div class="flex h-full flex-col gap-4 overflow-hidden px-6 py-5">
    <!-- Header: back · title · actions -->
    <header class="flex flex-wrap items-center gap-3">
      <Button icon="arrow-left" title="Back to contexts" @click="goBack">
        <span class="hidden sm:inline">Contexts</span>
      </Button>
      <input
        v-model="title"
        class="input min-w-0 flex-1 !text-lg font-semibold"
        :placeholder="isNew ? 'New context title…' : 'Context title'"
      />
      <Button icon="copy" title="Copy context JSON" @click="copyContext">
        <span class="hidden md:inline">Copy</span>
      </Button>
      <Button variant="primary" icon="save" :disabled="saving || loading || hasProblem" @click="save">
        {{ saving ? 'Saving…' : isNew ? 'Create' : 'Save' }}
      </Button>
    </header>

    <!-- Meta line -->
    <p v-if="record" class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-fg-subtle">
      <span class="font-mono">{{ record.id }}</span>
      <span>Updated {{ formatTime(record.updatedAt) }}</span>
      <span v-if="record.updatedBy?.by" class="chip">
        {{ record.updatedBy.by === 'flow' ? 'written by flow' : 'manual edit' }}
      </span>
    </p>

    <!-- Loading / fatal error -->
    <div v-if="loading" class="flex flex-1 items-center justify-center text-sm text-fg-muted">
      Loading context…
    </div>
    <div v-else-if="error && !record && !isNew" class="flex flex-1 flex-col items-center justify-center gap-3">
      <p class="text-sm text-danger">{{ error }}</p>
      <Button icon="refresh" @click="fetchContext">Retry</Button>
    </div>

    <template v-else>
      <!-- View tabs -->
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex items-center gap-1 rounded-lg bg-surface-2 p-1">
          <button
            class="rounded-md px-3 py-1 text-[13px] font-medium transition-colors"
            :class="activeView === 'tree' ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg'"
            @click="activeView = 'tree'"
          >
            Tree
          </button>
          <button
            class="rounded-md px-3 py-1 text-[13px] font-medium transition-colors"
            :class="activeView === 'json' ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg'"
            @click="activeView = 'json'"
          >
            JSON editor
          </button>
        </div>

        <button
          v-if="activeView === 'json'"
          class="flex items-center gap-1 text-[12px] text-accent hover:underline"
          @click="formatDocuments"
        >
          <Icon name="refresh" :size="13" /> Format
        </button>

        <button
          v-if="activeView === 'json'"
          class="flex h-7 w-7 items-center justify-center rounded-lg border transition-colors"
          :class="wrapLines ? 'border-accent-border bg-accent-soft text-accent' : 'border-line text-fg-muted hover:text-fg'"
          :title="wrapLines ? 'Unwrap long lines' : 'Wrap long lines'"
          @click="wrapLines = !wrapLines"
        >
          <Icon name="wrap-text" :size="14" />
        </button>

        <span
          v-if="hasProblem"
          class="rounded bg-danger-soft px-2 py-0.5 text-[11px] font-semibold text-danger"
        >
          Invalid JSON
        </span>
        <span
          v-else
          class="rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400"
        >
          Valid JSON
        </span>

        <button
          class="ml-auto flex items-center gap-1 text-[12px] font-medium transition-colors"
          :class="showHeader ? 'text-accent' : 'text-fg-muted hover:text-fg'"
          @click="showHeader = !showHeader"
        >
          <Icon name="chevron-right" :size="13" class="transition-transform" :class="showHeader ? 'rotate-90' : ''" />
          Header metadata
        </button>
      </div>

      <p v-if="error" class="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{{ error }}</p>

      <!-- Panels: context, plus the header document when opened -->
      <div class="flex min-h-0 flex-1 gap-4" :class="showHeader ? 'flex-row' : 'flex-col'">
        <!-- Context panel -->
        <section class="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5">
          <h4 v-if="showHeader" class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Context</h4>
          <div class="min-h-0 flex-1 overflow-hidden rounded-xl border bg-surface">
            <div v-if="activeView === 'tree'" class="h-full overflow-auto py-2">
              <template v-if="parsedContext">
                <p v-if="Object.keys(parsedContext).length === 0" class="px-4 py-6 text-center font-sans text-[13px] text-fg-muted">
                  Empty document — nodes fill it at run time.
                </p>
                <JsonTreeNode
                  v-for="[k, v] in Object.entries(parsedContext)"
                  :key="k"
                  :field="k"
                  :value="v"
                  :depth="0"
                />
              </template>
              <p v-else class="px-4 py-6 text-center text-[13px] text-fg-muted">
                Invalid JSON — switch to the JSON editor to fix it.
              </p>
            </div>
            <CodeEditor v-else v-model="rawContext" :wrap="wrapLines" />
          </div>
          <p v-if="contextProblem" class="text-[12px] text-danger">{{ contextProblem }}</p>
        </section>

        <!-- Header panel -->
        <section v-if="showHeader" class="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5">
          <h4 class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Header</h4>
          <div class="min-h-0 flex-1 overflow-hidden rounded-xl border bg-surface">
            <div v-if="activeView === 'tree'" class="h-full overflow-auto py-2">
              <template v-if="parsedHeader">
                <p v-if="Object.keys(parsedHeader).length === 0" class="px-4 py-6 text-center font-sans text-[13px] text-fg-muted">
                  No header metadata.
                </p>
                <JsonTreeNode
                  v-for="[k, v] in Object.entries(parsedHeader)"
                  :key="k"
                  :field="k"
                  :value="v"
                  :depth="0"
                />
              </template>
              <p v-else class="px-4 py-6 text-center text-[13px] text-fg-muted">
                Invalid JSON — switch to the JSON editor to fix it.
              </p>
            </div>
            <CodeEditor v-else v-model="rawHeader" :wrap="wrapLines" />
          </div>
          <p v-if="headerProblem" class="text-[12px] text-danger">{{ headerProblem }}</p>
        </section>
      </div>
    </template>
  </div>
</template>
