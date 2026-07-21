<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMemoryStore } from '@/stores/memory'
import { memoryRecordsApi } from '@/api/memoryRecords'
import type { DocumentRecord, MemoryStore, VectorMatch } from '@/types/api'
import PageShell from '@/components/ui/PageShell.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'

const props = defineProps<{ id: string }>()
const router = useRouter()
const memory = useMemoryStore()

/* ---- Resolve the store this view browses ---- */
const store = ref<MemoryStore | null>(null)
const resolving = ref(true)
const notFound = ref(false)

onMounted(async () => {
  if (!memory.items.length) await memory.refresh()
  store.value = memory.items.find((m) => m.id === props.id) ?? null
  notFound.value = !store.value
  resolving.value = false
  if (remote && store.value?.type === 'document') void loadRecords()
})

const isDocument = computed(() => store.value?.type === 'document')
const isVector = computed(() => store.value?.type === 'vector')
const remote = memoryRecordsApi.isRemote()

function back() {
  router.push({ name: 'memory' })
}

/* ---- Shared JSON helpers ---- */
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
function prettify(value: unknown): string {
  return JSON.stringify(value, null, 2)
}
/** Render a single cell value compactly for the table view. */
function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
function formatTime(ms: number): string {
  if (!ms) return ''
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/* ============================================================
 * DOCUMENT STORE — table ⇄ JSON browser with CRUD
 * ============================================================ */
const records = ref<DocumentRecord[]>([])
const recLoading = ref(false)
const recError = ref<string | null>(null)
const viewMode = ref<'table' | 'json'>('table')
const pageSize = 50
const offset = ref(0)
const hasMore = ref(false)

const columns = computed(() => store.value?.document?.columns ?? [])

async function loadRecords() {
  if (!store.value) return
  recLoading.value = true
  recError.value = null
  try {
    const res = await memoryRecordsApi.listRecords(store.value.id, { limit: pageSize, offset: offset.value })
    records.value = res.items
    hasMore.value = res.items.length === pageSize
  } catch (err) {
    recError.value = (err as Error).message
    records.value = []
  } finally {
    recLoading.value = false
  }
}

function nextPage() {
  offset.value += pageSize
  void loadRecords()
}
function prevPage() {
  offset.value = Math.max(0, offset.value - pageSize)
  void loadRecords()
}

/* ---- Document editor (insert / edit), JSON-based like the Context editor ---- */
const showEditor = ref(false)
const editing = ref<DocumentRecord | null>(null)
const editorText = ref('{\n  \n}')
const editorError = ref<string | null>(null)
const saving = ref(false)

/** A blank document pre-seeded with the schema's column keys, for insert. */
function blankDoc(): string {
  const seed: Record<string, unknown> = {}
  for (const col of columns.value) {
    if (col.primary) continue // the row id is assigned by the store
    seed[col.name] = ''
  }
  return Object.keys(seed).length ? prettify(seed) : '{\n  \n}'
}

function openInsert() {
  editing.value = null
  editorText.value = blankDoc()
  editorError.value = null
  showEditor.value = true
}
function openEdit(rec: DocumentRecord) {
  editing.value = rec
  editorText.value = prettify(rec.data)
  editorError.value = null
  showEditor.value = true
}
function formatEditor() {
  const parsed = tryParse(editorText.value)
  if (parsed !== undefined) editorText.value = prettify(parsed)
}

async function saveRecord() {
  if (!store.value) return
  editorError.value = null
  const parsed = tryParse(editorText.value)
  if (!isPlainObject(parsed)) {
    editorError.value = 'The document must be a valid JSON object.'
    return
  }
  saving.value = true
  try {
    if (editing.value) {
      await memoryRecordsApi.updateRecord(store.value.id, editing.value.id, parsed)
    } else {
      await memoryRecordsApi.createRecord(store.value.id, parsed)
      offset.value = 0
    }
    showEditor.value = false
    await loadRecords()
  } catch (err) {
    editorError.value = (err as Error).message
  } finally {
    saving.value = false
  }
}

async function removeRecord(rec: DocumentRecord, e?: Event) {
  e?.stopPropagation()
  if (!store.value) return
  if (!window.confirm(`Delete record ${rec.id}?`)) return
  try {
    await memoryRecordsApi.deleteRecord(store.value.id, rec.id)
    await loadRecords()
  } catch (err) {
    recError.value = (err as Error).message
  }
}

/* ============================================================
 * VECTOR STORE — similarity search + embed-and-insert
 * ============================================================ */
const query = ref('')
const topK = ref(5)
const matches = ref<VectorMatch[]>([])
const searching = ref(false)
const searchError = ref<string | null>(null)
const searched = ref(false)
const openMatch = ref<VectorMatch | null>(null)

async function runSearch() {
  if (!store.value || !query.value.trim()) return
  searching.value = true
  searchError.value = null
  try {
    const res = await memoryRecordsApi.search(store.value.id, query.value.trim(), topK.value)
    matches.value = res.items
    searched.value = true
  } catch (err) {
    searchError.value = (err as Error).message
    matches.value = []
  } finally {
    searching.value = false
  }
}

/* ---- Vector insert: text to embed + key/value metadata ---- */
const showVecInsert = ref(false)
const vecText = ref('')
const vecMeta = reactive<{ rows: { key: string; value: string }[] }>({ rows: [{ key: '', value: '' }] })
const vecError = ref<string | null>(null)
const vecInfo = ref<string | null>(null)
const indexing = ref(false)

function openVecInsert() {
  vecText.value = ''
  vecMeta.rows = [{ key: '', value: '' }]
  vecError.value = null
  vecInfo.value = null
  showVecInsert.value = true
}
function addMetaRow() {
  vecMeta.rows.push({ key: '', value: '' })
}
function removeMetaRow(i: number) {
  vecMeta.rows.splice(i, 1)
}

async function saveVector() {
  if (!store.value) return
  vecError.value = null
  if (!vecText.value.trim()) {
    vecError.value = 'Enter the text to embed and store.'
    return
  }
  const metadata: Record<string, unknown> = {}
  for (const row of vecMeta.rows) {
    const key = row.key.trim()
    if (!key) continue
    // Store a parsed JSON value when it looks like one (number/bool/object),
    // otherwise the raw string — so `42` and `"note"` both round-trip sensibly.
    const parsed = tryParse(row.value)
    metadata[key] = parsed === undefined ? row.value : parsed
  }
  indexing.value = true
  try {
    await memoryRecordsApi.indexVector(store.value.id, vecText.value.trim(), metadata)
    showVecInsert.value = false
    vecInfo.value = null
    // Re-run the current search so the new record can surface immediately.
    if (searched.value) await runSearch()
  } catch (err) {
    vecError.value = (err as Error).message
  } finally {
    indexing.value = false
  }
}

function metaEntries(m: Record<string, unknown> | undefined): [string, unknown][] {
  return m ? Object.entries(m) : []
}
</script>

<template>
  <PageShell :title="store?.name ?? 'Store'" :subtitle="store?.description || undefined">
    <template #actions>
      <Button icon="arrow-left" @click="back">Back</Button>
      <Button
        v-if="store"
        variant="primary"
        icon="plus"
        @click="isVector ? openVecInsert() : openInsert()"
      >
        {{ isVector ? 'Add record' : 'Insert record' }}
      </Button>
    </template>

    <!-- Loading / not found / no backend gates -->
    <div v-if="resolving" class="py-16 text-center text-sm text-fg-muted">Loading store…</div>

    <EmptyState
      v-else-if="notFound"
      icon="memory"
      title="Store not found"
      description="This memory store no longer exists or hasn't loaded."
    >
      <Button icon="arrow-left" @click="back">Back to Memory</Button>
    </EmptyState>

    <div
      v-else-if="!remote"
      class="rounded-xl border border-dashed px-6 py-12 text-center"
    >
      <p class="text-sm text-fg-muted">
        Store data lives in the backend. Set <code class="font-mono text-fg">VITE_API_BASE_URL</code> to browse and edit records.
      </p>
    </div>

    <!-- ============ DOCUMENT STORE ============ -->
    <template v-else-if="isDocument">
      <div class="mb-4 flex flex-wrap items-center gap-3">
        <span class="chip"><Icon name="table" :size="13" /> {{ store?.document?.table }}</span>
        <span class="chip">{{ columns.length }} column{{ columns.length === 1 ? '' : 's' }}</span>
        <div class="ml-auto flex items-center overflow-hidden rounded-lg border">
          <button
            class="flex items-center gap-1 px-3 py-1.5 text-[13px] font-medium transition-colors"
            :class="viewMode === 'table' ? 'bg-accent-soft text-accent' : 'text-fg-muted hover:text-fg'"
            @click="viewMode = 'table'"
          >
            <Icon name="table" :size="14" /> Table
          </button>
          <button
            class="flex items-center gap-1 border-l px-3 py-1.5 text-[13px] font-medium transition-colors"
            :class="viewMode === 'json' ? 'bg-accent-soft text-accent' : 'text-fg-muted hover:text-fg'"
            @click="viewMode = 'json'"
          >
            <Icon name="node-code" :size="14" /> JSON
          </button>
        </div>
        <Button icon="refresh" icon-only title="Reload" @click="loadRecords" />
      </div>

      <div v-if="recLoading" class="py-16 text-center text-sm text-fg-muted">Loading records…</div>

      <div v-else-if="recError" class="rounded-xl border border-dashed px-6 py-12 text-center">
        <p class="text-sm text-danger">{{ recError }}</p>
        <Button class="mt-4" icon="refresh" @click="loadRecords">Retry</Button>
      </div>

      <EmptyState
        v-else-if="records.length === 0"
        icon="table"
        title="No records yet"
        description="Insert a JSON document to start populating this store's table."
      >
        <Button variant="primary" icon="plus" @click="openInsert">Insert record</Button>
      </EmptyState>

      <!-- Table view -->
      <div v-else-if="viewMode === 'table'" class="overflow-x-auto rounded-xl border">
        <table class="w-full border-collapse text-sm">
          <thead>
            <tr class="border-b bg-surface-2 text-left text-[11px] uppercase tracking-wide text-fg-subtle">
              <th class="px-3 py-2 font-semibold">id</th>
              <th v-for="col in columns" :key="col.name" class="px-3 py-2 font-semibold">
                {{ col.name }}<span class="ml-1 font-normal normal-case text-fg-subtle">· {{ col.type }}</span>
              </th>
              <th class="px-3 py-2 font-semibold">updated</th>
              <th class="w-16 px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="rec in records"
              :key="rec.id"
              class="group cursor-pointer border-b last:border-0 hover:bg-surface-2"
              @click="openEdit(rec)"
            >
              <td class="max-w-[10rem] truncate px-3 py-2 font-mono text-[11px] text-fg-subtle">{{ rec.id }}</td>
              <td v-for="col in columns" :key="col.name" class="max-w-[16rem] truncate px-3 py-2 text-fg">
                {{ cellText(rec.data[col.name]) }}
              </td>
              <td class="whitespace-nowrap px-3 py-2 text-[12px] text-fg-subtle">{{ formatTime(rec.updatedAt) }}</td>
              <td class="px-3 py-2 text-right">
                <span
                  class="inline-flex rounded-lg p-1.5 text-fg-subtle opacity-0 transition hover:bg-danger-soft hover:text-danger group-hover:opacity-100"
                  title="Delete"
                  @click="removeRecord(rec, $event)"
                >
                  <Icon name="trash" :size="14" />
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- JSON view (Compass-style document cards) -->
      <div v-else class="space-y-3">
        <div
          v-for="rec in records"
          :key="rec.id"
          class="group rounded-xl border bg-surface p-3"
        >
          <div class="mb-2 flex items-center gap-2">
            <span class="font-mono text-[11px] text-fg-subtle">{{ rec.id }}</span>
            <span class="text-[11px] text-fg-subtle">· {{ formatTime(rec.updatedAt) }}</span>
            <div class="ml-auto flex items-center gap-1">
              <button class="rounded-lg p-1.5 text-fg-subtle hover:bg-surface-2 hover:text-fg" title="Edit" @click="openEdit(rec)">
                <Icon name="settings" :size="14" />
              </button>
              <button class="rounded-lg p-1.5 text-fg-subtle hover:bg-danger-soft hover:text-danger" title="Delete" @click="removeRecord(rec, $event)">
                <Icon name="trash" :size="14" />
              </button>
            </div>
          </div>
          <pre class="overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-fg">{{ prettify(rec.data) }}</pre>
        </div>
      </div>

      <div v-if="!recLoading && (records.length || offset > 0)" class="mt-6 flex items-center justify-center gap-3">
        <Button icon="chevron-left" :disabled="offset === 0" @click="prevPage">Previous</Button>
        <span class="text-xs text-fg-subtle">Rows {{ offset + 1 }}–{{ offset + records.length }}</span>
        <Button :disabled="!hasMore" @click="nextPage">Next <Icon name="chevron-right" :size="15" /></Button>
      </div>
    </template>

    <!-- ============ VECTOR STORE ============ -->
    <template v-else-if="isVector">
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <span class="chip"><Icon name="vector" :size="13" /> {{ store?.vector?.embeddingModel }}</span>
        <span class="chip">{{ store?.vector?.dimensions }}d · {{ store?.vector?.metric }}</span>
      </div>

      <!-- Similarity search bar -->
      <form class="mb-5 flex flex-wrap items-end gap-3" @submit.prevent="runSearch">
        <div class="min-w-[16rem] flex-1 space-y-1">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Search by meaning</label>
          <div class="relative">
            <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"><Icon name="search" :size="16" /></span>
            <input v-model="query" class="input pl-9" placeholder="Describe what you're looking for…" />
          </div>
        </div>
        <div class="w-24 space-y-1">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Top K</label>
          <input v-model.number="topK" type="number" min="1" max="50" class="input" />
        </div>
        <Button type="submit" variant="primary" icon="search" :disabled="searching || !query.trim()">
          {{ searching ? 'Searching…' : 'Search' }}
        </Button>
      </form>

      <div v-if="searchError" class="rounded-xl border border-dashed px-6 py-8 text-center">
        <p class="text-sm text-danger">{{ searchError }}</p>
      </div>

      <EmptyState
        v-else-if="!searched"
        icon="vector"
        title="Search this vector store"
        description="Type a query above to embed it and find the nearest stored records — or add a record to grow the index."
      >
        <Button variant="primary" icon="plus" @click="openVecInsert">Add record</Button>
      </EmptyState>

      <EmptyState
        v-else-if="matches.length === 0"
        icon="search"
        title="No matches"
        description="Nothing similar in the index yet. Try a different query or add records."
      />

      <!-- Results -->
      <div v-else class="overflow-x-auto rounded-xl border">
        <table class="w-full border-collapse text-sm">
          <thead>
            <tr class="border-b bg-surface-2 text-left text-[11px] uppercase tracking-wide text-fg-subtle">
              <th class="px-3 py-2 font-semibold">content</th>
              <th class="px-3 py-2 font-semibold">metadata</th>
              <th class="w-24 px-3 py-2 font-semibold">distance</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="m in matches"
              :key="m.docId"
              class="cursor-pointer border-b last:border-0 hover:bg-surface-2"
              @click="openMatch = m"
            >
              <td class="max-w-[28rem] px-3 py-2 text-fg"><span class="line-clamp-2">{{ m.content }}</span></td>
              <td class="px-3 py-2">
                <div class="flex flex-wrap gap-1">
                  <span v-for="[k, v] in metaEntries(m.metadata)" :key="k" class="chip">{{ k }}: {{ cellText(v) }}</span>
                  <span v-if="!metaEntries(m.metadata).length" class="text-[12px] text-fg-subtle">—</span>
                </div>
              </td>
              <td class="whitespace-nowrap px-3 py-2 font-mono text-[12px] text-fg-subtle">{{ m.distance.toFixed(4) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- ===== Document editor modal ===== -->
    <Modal
      :open="showEditor"
      :title="editing ? 'Edit record' : 'Insert record'"
      :subtitle="store?.document?.table"
      @close="showEditor = false"
    >
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Document (JSON)</label>
          <button class="flex items-center gap-1 text-[12px] text-accent hover:underline" @click="formatEditor">
            <Icon name="refresh" :size="13" /> Format
          </button>
        </div>
        <textarea
          v-model="editorText"
          rows="14"
          spellcheck="false"
          class="input font-mono text-xs leading-relaxed"
          placeholder='{ "name": "", "value": 0 }'
        />
        <p v-if="editing" class="font-mono text-[11px] text-fg-subtle">id: {{ editing.id }}</p>
        <p v-if="editorError" class="text-sm text-danger">{{ editorError }}</p>
      </div>
      <template #footer>
        <Button @click="showEditor = false">Cancel</Button>
        <Button variant="primary" :icon="editing ? 'save' : 'plus'" :disabled="saving" @click="saveRecord">
          {{ saving ? 'Saving…' : editing ? 'Save record' : 'Insert record' }}
        </Button>
      </template>
    </Modal>

    <!-- ===== Vector insert modal ===== -->
    <Modal :open="showVecInsert" title="Add record" subtitle="Text is embedded and stored with its metadata." @close="showVecInsert = false">
      <div class="space-y-4">
        <div class="space-y-1">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Text to embed</label>
          <textarea v-model="vecText" rows="6" spellcheck="false" class="input text-sm leading-relaxed" placeholder="The content to index…" />
          <p class="text-[11px] text-fg-subtle">Embedded with {{ store?.vector?.embeddingModel }} ({{ store?.vector?.dimensions }}d).</p>
        </div>
        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Metadata</label>
            <button class="flex items-center gap-1 text-[12px] text-accent hover:underline" @click="addMetaRow">
              <Icon name="plus" :size="13" /> Add field
            </button>
          </div>
          <div v-for="(row, i) in vecMeta.rows" :key="i" class="flex items-center gap-2">
            <input v-model="row.key" class="input flex-1 font-mono text-xs" placeholder="key" />
            <input v-model="row.value" class="input flex-1 text-xs" placeholder="value" />
            <button class="shrink-0 rounded-lg p-1.5 text-fg-subtle hover:bg-danger-soft hover:text-danger" @click="removeMetaRow(i)">
              <Icon name="x" :size="15" />
            </button>
          </div>
          <p class="text-[11px] text-fg-subtle">Stored alongside the vector so a search can return the origin. Numbers/JSON values are parsed.</p>
        </div>
        <p v-if="vecError" class="text-sm text-danger">{{ vecError }}</p>
      </div>
      <template #footer>
        <Button @click="showVecInsert = false">Cancel</Button>
        <Button variant="primary" icon="plus" :disabled="indexing" @click="saveVector">
          {{ indexing ? 'Embedding…' : 'Add record' }}
        </Button>
      </template>
    </Modal>

    <!-- ===== Vector match detail modal ===== -->
    <Modal :open="!!openMatch" title="Record" :subtitle="openMatch ? `distance ${openMatch.distance.toFixed(4)}` : ''" @close="openMatch = null">
      <div v-if="openMatch" class="space-y-3">
        <div class="space-y-1">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Content</label>
          <pre class="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm leading-relaxed text-fg">{{ openMatch.content }}</pre>
        </div>
        <div class="space-y-1">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Metadata</label>
          <pre class="overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-[11px] text-fg">{{ prettify(openMatch.metadata ?? {}) }}</pre>
        </div>
      </div>
      <template #footer>
        <Button @click="openMatch = null">Close</Button>
      </template>
    </Modal>
  </PageShell>
</template>
