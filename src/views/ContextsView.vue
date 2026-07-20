<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useContextsStore } from '@/stores/contexts'
import type { ContextRecord } from '@/types/api'
import PageShell from '@/components/ui/PageShell.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'

const store = useContextsStore()
onMounted(() => store.refresh())

const searchInput = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
function onSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => store.setSearch(searchInput.value), 250)
}

const showModal = ref(false)
const submitting = ref(false)
const formError = ref<string | null>(null)

const form = reactive({
  id: undefined as string | undefined,
  title: '',
  context: '{\n  \n}',
  header: '{}',
})

function resetForm() {
  form.id = undefined
  form.title = ''
  form.context = '{\n  \n}'
  form.header = '{}'
  formError.value = null
}

function openAdd() {
  resetForm()
  showModal.value = true
}

function openEdit(c: ContextRecord) {
  form.id = c.id
  form.title = c.title
  form.context = prettify(c.context) ?? c.context
  form.header = c.header && Object.keys(c.header).length ? JSON.stringify(c.header, null, 2) : '{}'
  formError.value = null
  showModal.value = true
}

/** Parse a JSON string, returning the value or undefined when invalid. */
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

/** Pretty-print a JSON string, or undefined if it doesn't parse. */
function prettify(raw: string): string | undefined {
  const parsed = tryParse(raw)
  return parsed === undefined ? undefined : JSON.stringify(parsed, null, 2)
}

function formatDocuments() {
  const pretty = prettify(form.context)
  if (pretty !== undefined) form.context = pretty
  const prettyHeader = prettify(form.header)
  if (prettyHeader !== undefined) form.header = prettyHeader
}

async function submit() {
  formError.value = null
  if (!form.title.trim()) {
    formError.value = 'Give the context a title.'
    return
  }
  const context = tryParse(form.context)
  if (!isPlainObject(context)) {
    formError.value = 'The context must be a valid JSON object.'
    return
  }
  let header: Record<string, unknown> = {}
  if (form.header.trim()) {
    const parsedHeader = tryParse(form.header)
    if (!isPlainObject(parsedHeader)) {
      formError.value = 'Header must be a valid JSON object (or empty).'
      return
    }
    header = parsedHeader
  }
  submitting.value = true
  try {
    await store.save({
      id: form.id,
      title: form.title.trim(),
      // Send a compact, canonical serialization the backend re-validates.
      context: JSON.stringify(context),
      header,
    })
    showModal.value = false
  } catch (err) {
    formError.value = (err as Error).message
  } finally {
    submitting.value = false
  }
}

async function remove(c: ContextRecord, e: Event) {
  e.stopPropagation()
  if (!window.confirm(`Delete context "${c.title}"?`)) return
  await store.remove(c.id)
}

/** One-line preview of the context document. */
function preview(c: ContextRecord): string {
  const parsed = tryParse(c.context)
  const text = parsed === undefined ? c.context : JSON.stringify(parsed)
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > 140 ? `${compact.slice(0, 140)}…` : compact || '{}'
}

/** Number of top-level keys in the context document. */
function keyCount(c: ContextRecord): number {
  const parsed = tryParse(c.context)
  return isPlainObject(parsed) ? Object.keys(parsed).length : 0
}

function formatTime(ms: number): string {
  if (!ms) return ''
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
</script>

<template>
  <PageShell
    title="Contexts"
    subtitle="The living state that flows through a workflow — a JSON document nodes read from and write to at runtime. Define reusable seed contexts here."
  >
    <template #actions>
      <Button variant="primary" icon="plus" @click="openAdd">New context</Button>
    </template>

    <div class="mb-5 flex items-center gap-3">
      <div class="relative max-w-xs flex-1">
        <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle">
          <Icon name="search" :size="16" />
        </span>
        <input v-model="searchInput" class="input pl-9" placeholder="Search contexts…" @input="onSearch" />
      </div>
      <span class="text-xs text-fg-subtle">{{ store.isRemote ? 'morph-api' : 'local storage' }}</span>
    </div>

    <div v-if="store.loading" class="py-16 text-center text-sm text-fg-muted">Loading contexts…</div>

    <div v-else-if="store.error" class="rounded-xl border border-dashed px-6 py-12 text-center">
      <p class="text-sm text-danger">{{ store.error }}</p>
      <Button class="mt-4" icon="refresh" @click="store.refresh()">Retry</Button>
    </div>

    <EmptyState
      v-else-if="store.items.length === 0"
      icon="context"
      title="No contexts yet"
      description="Create a JSON context document to seed a workflow run. Nodes read from and write back to it as the process executes."
    >
      <Button variant="primary" icon="plus" @click="openAdd">New context</Button>
    </EmptyState>

    <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <button
        v-for="c in store.items"
        :key="c.id"
        class="card group flex flex-col p-4 text-left transition-colors hover:border-accent-border"
        @click="openEdit(c)"
      >
        <div class="flex items-start justify-between gap-2">
          <span class="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Icon name="context" :size="18" />
          </span>
          <span
            class="rounded-lg p-1.5 text-fg-subtle opacity-0 transition hover:bg-danger-soft hover:text-danger group-hover:opacity-100"
            title="Delete"
            @click="remove(c, $event)"
          >
            <Icon name="trash" :size="15" />
          </span>
        </div>
        <h3 class="mt-3 truncate font-semibold text-fg">{{ c.title }}</h3>
        <p class="mt-2 line-clamp-3 rounded-lg bg-surface-2 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-fg-subtle">
          {{ preview(c) }}
        </p>
        <div class="mt-3 flex flex-wrap items-center gap-1.5">
          <span class="chip">{{ keyCount(c) }} key{{ keyCount(c) === 1 ? '' : 's' }}</span>
          <span v-if="c.updatedBy?.by" class="chip">{{ c.updatedBy.by === 'flow' ? 'by flow' : 'manual' }}</span>
          <span v-if="c.updatedAt" class="ml-auto text-[11px] text-fg-subtle">{{ formatTime(c.updatedAt) }}</span>
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

    <!-- Create / edit modal -->
    <Modal
      :open="showModal"
      :title="form.id ? 'Edit context' : 'New context'"
      subtitle="A JSON document that seeds a workflow run."
      @close="showModal = false"
    >
      <div class="space-y-4">
        <div class="space-y-1">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Title</label>
          <input v-model="form.title" class="input" placeholder="e.g. onboarding-seed" />
        </div>

        <div class="space-y-1">
          <div class="flex items-center justify-between">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Context document</label>
            <button class="flex items-center gap-1 text-[12px] text-accent hover:underline" @click="formatDocuments">
              <Icon name="refresh" :size="13" /> Format JSON
            </button>
          </div>
          <textarea
            v-model="form.context"
            rows="10"
            spellcheck="false"
            class="input font-mono text-xs leading-relaxed"
            placeholder='{ "user": { "name": "" }, "messages": [] }'
          />
          <p class="text-[11px] text-fg-subtle">Must be a JSON object. Nodes read/write slices of this at runtime.</p>
        </div>

        <details class="rounded-lg border bg-surface-2 px-3 py-2">
          <summary class="cursor-pointer text-[12px] font-medium text-fg-muted">Header metadata (optional)</summary>
          <div class="mt-2 space-y-1">
            <textarea
              v-model="form.header"
              rows="4"
              spellcheck="false"
              class="input font-mono text-xs leading-relaxed"
              placeholder="{}"
            />
            <p class="text-[11px] text-fg-subtle">Free-form JSON metadata attached to the context.</p>
          </div>
        </details>

        <p v-if="formError" class="text-sm text-danger">{{ formError }}</p>
      </div>

      <template #footer>
        <Button @click="showModal = false">Cancel</Button>
        <Button variant="primary" :icon="form.id ? 'save' : 'plus'" :disabled="submitting" @click="submit">
          {{ submitting ? 'Saving…' : form.id ? 'Save context' : 'Create context' }}
        </Button>
      </template>
    </Modal>
  </PageShell>
</template>
