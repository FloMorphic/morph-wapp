<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useMemoryStore } from '@/stores/memory'
import type { ColumnType, MemoryStore, MemoryType, TableColumn, VectorMetric } from '@/types/api'
import PageShell from '@/components/ui/PageShell.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'

const store = useMemoryStore()
onMounted(() => store.refresh())

const showAdd = ref(false)
const submitting = ref(false)
const formError = ref<string | null>(null)

const metrics: VectorMetric[] = ['cosine', 'dot', 'euclidean']
const columnTypes: ColumnType[] = ['string', 'text', 'number', 'boolean', 'object', 'array', 'timestamp']

const typeInfo: Record<MemoryType, { icon: string; label: string; blurb: string }> = {
  vector: { icon: 'vector', label: 'Vector', blurb: 'Semantic search over embeddings. Needs an embedding model + token.' },
  document: { icon: 'table', label: 'Document', blurb: 'Structured records. Needs a table definition (columns + types).' },
}

const form = reactive({
  type: 'vector' as MemoryType,
  name: '',
  description: '',
  vector: {
    provider: 'openai',
    embeddingModel: 'text-embedding-3-small',
    token: '',
    dimensions: 1536,
    metric: 'cosine' as VectorMetric,
    namespace: 'default',
  },
  document: {
    table: '',
    columns: [{ name: 'id', type: 'string' as ColumnType, primary: true }] as TableColumn[],
  },
})

function resetForm() {
  form.type = 'vector'
  form.name = ''
  form.description = ''
  form.vector = { provider: 'openai', embeddingModel: 'text-embedding-3-small', token: '', dimensions: 1536, metric: 'cosine', namespace: 'default' }
  form.document = { table: '', columns: [{ name: 'id', type: 'string', primary: true }] }
  formError.value = null
}

function openAdd() {
  resetForm()
  showAdd.value = true
}

function addColumn() {
  form.document.columns.push({ name: '', type: 'string', primary: false })
}
function removeColumn(i: number) {
  form.document.columns.splice(i, 1)
}

async function submit() {
  formError.value = null
  if (!form.name.trim()) {
    formError.value = 'Give the memory store a name.'
    return
  }
  if (form.type === 'vector' && !form.vector.embeddingModel.trim()) {
    formError.value = 'A vector store needs an embedding model.'
    return
  }
  if (form.type === 'document') {
    if (!form.document.table.trim()) {
      formError.value = 'A document store needs a table name.'
      return
    }
    if (form.document.columns.filter((c) => c.name.trim()).length === 0) {
      formError.value = 'Define at least one column.'
      return
    }
  }
  submitting.value = true
  try {
    await store.add({
      name: form.name.trim(),
      type: form.type,
      description: form.description.trim(),
      vector: form.type === 'vector' ? { ...form.vector } : undefined,
      document:
        form.type === 'document'
          ? { table: form.document.table.trim(), columns: form.document.columns.filter((c) => c.name.trim()) }
          : undefined,
    })
    showAdd.value = false
  } catch (err) {
    formError.value = (err as Error).message
  } finally {
    submitting.value = false
  }
}

async function remove(m: MemoryStore) {
  if (!window.confirm(`Delete memory store "${m.name}"?`)) return
  await store.remove(m.id)
}

function summary(m: MemoryStore): string {
  if (m.type === 'vector' && m.vector) return `${m.vector.embeddingModel} · ${m.vector.dimensions}d · ${m.vector.metric}`
  if (m.type === 'document' && m.document) return `${m.document.table} · ${m.document.columns.length} column${m.document.columns.length === 1 ? '' : 's'}`
  return ''
}

const isVector = computed(() => form.type === 'vector')
</script>

<template>
  <PageShell
    title="Memory"
    subtitle="Named, reusable stores the Memory node references anywhere in a workflow. Define a store once; use it across flows."
  >
    <template #actions>
      <Button variant="primary" icon="plus" @click="openAdd">Add memory</Button>
    </template>

    <div class="mb-6 grid gap-3 sm:grid-cols-2">
      <div class="flex items-start gap-3 rounded-xl border bg-surface px-4 py-3">
        <span class="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent"><Icon name="vector" :size="16" /></span>
        <div>
          <p class="text-sm font-semibold text-fg">Vector</p>
          <p class="text-[13px] text-fg-muted">Embeddings for semantic search — needs an embedding model, token, dimensions and a distance metric.</p>
        </div>
      </div>
      <div class="flex items-start gap-3 rounded-xl border bg-surface px-4 py-3">
        <span class="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent"><Icon name="table" :size="16" /></span>
        <div>
          <p class="text-sm font-semibold text-fg">Document</p>
          <p class="text-[13px] text-fg-muted">Structured records — a table definition (columns + types) compatible with the store.</p>
        </div>
      </div>
    </div>

    <div v-if="store.loading" class="py-16 text-center text-sm text-fg-muted">Loading memory stores…</div>

    <div v-else-if="store.error" class="rounded-xl border border-dashed px-6 py-12 text-center">
      <p class="text-sm text-danger">{{ store.error }}</p>
      <Button class="mt-4" icon="refresh" @click="store.refresh()">Retry</Button>
    </div>

    <EmptyState
      v-else-if="store.items.length === 0"
      icon="memory"
      title="No memory stores yet"
      description="Create a vector or document store, then reference it from a Memory node in your workflows."
    >
      <Button variant="primary" icon="plus" @click="openAdd">Add memory</Button>
    </EmptyState>

    <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div v-for="m in store.items" :key="m.id" class="card flex flex-col p-4">
        <div class="flex items-start justify-between gap-2">
          <div class="flex min-w-0 items-center gap-2.5">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <Icon :name="typeInfo[m.type].icon" :size="18" />
            </span>
            <div class="min-w-0">
              <h3 class="truncate font-semibold text-fg">{{ m.name }}</h3>
              <span class="chip">{{ typeInfo[m.type].label }}</span>
            </div>
          </div>
          <button class="rounded-lg p-1.5 text-fg-subtle hover:bg-danger-soft hover:text-danger" title="Delete" @click="remove(m)">
            <Icon name="trash" :size="15" />
          </button>
        </div>
        <p v-if="m.description" class="mt-3 line-clamp-2 text-[13px] text-fg-muted">{{ m.description }}</p>
        <div class="mt-3 truncate font-mono text-[11px] text-fg-subtle">{{ summary(m) }}</div>
      </div>
    </div>

    <!-- Add memory modal -->
    <Modal :open="showAdd" title="Add memory store" subtitle="Referenced by Memory nodes in your workflows." @close="showAdd = false">
      <div class="space-y-4">
        <!-- Type selector -->
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="(info, key) in typeInfo"
            :key="key"
            class="flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors"
            :style="form.type === key ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)' } : {}"
            @click="form.type = key as MemoryType"
          >
            <span class="flex items-center gap-2 text-sm font-semibold text-fg">
              <Icon :name="info.icon" :size="16" :style="{ color: 'var(--accent)' }" /> {{ info.label }}
            </span>
            <span class="text-[11.5px] leading-snug text-fg-muted">{{ info.blurb }}</span>
          </button>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Name</label>
            <input v-model="form.name" class="input" placeholder="e.g. product-docs" />
          </div>
          <div class="space-y-1">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Description</label>
            <input v-model="form.description" class="input" placeholder="What it stores" />
          </div>
        </div>

        <!-- Vector config -->
        <div v-if="isVector" class="space-y-3 rounded-lg border bg-surface-2 p-3">
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1">
              <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Provider</label>
              <input v-model="form.vector.provider" class="input" placeholder="openai" />
            </div>
            <div class="space-y-1">
              <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Embedding model</label>
              <input v-model="form.vector.embeddingModel" class="input font-mono text-xs" placeholder="text-embedding-3-small" />
            </div>
          </div>
          <div class="space-y-1">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Token</label>
            <input v-model="form.vector.token" type="password" class="input font-mono text-xs" placeholder="embedding model API key" />
          </div>
          <div class="grid grid-cols-3 gap-3">
            <div class="space-y-1">
              <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Dimensions</label>
              <input v-model.number="form.vector.dimensions" type="number" class="input" />
            </div>
            <div class="space-y-1">
              <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Metric</label>
              <select v-model="form.vector.metric" class="input">
                <option v-for="mtr in metrics" :key="mtr" :value="mtr">{{ mtr }}</option>
              </select>
            </div>
            <div class="space-y-1">
              <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Namespace</label>
              <input v-model="form.vector.namespace" class="input" placeholder="default" />
            </div>
          </div>
        </div>

        <!-- Document config -->
        <div v-else class="space-y-3 rounded-lg border bg-surface-2 p-3">
          <div class="space-y-1">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Table name</label>
            <input v-model="form.document.table" class="input font-mono text-xs" placeholder="e.g. customers" />
          </div>
          <div class="space-y-1.5">
            <div class="flex items-center justify-between">
              <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Columns</label>
              <button class="flex items-center gap-1 text-[12px] text-accent hover:underline" @click="addColumn">
                <Icon name="plus" :size="13" /> Add column
              </button>
            </div>
            <div v-for="(col, i) in form.document.columns" :key="i" class="flex items-center gap-2">
              <input v-model="col.name" class="input flex-1 font-mono text-xs" placeholder="column_name" />
              <select v-model="col.type" class="input w-32 text-xs">
                <option v-for="t in columnTypes" :key="t" :value="t">{{ t }}</option>
              </select>
              <label class="flex shrink-0 items-center gap-1 text-[11px] text-fg-muted" title="Primary / lookup key">
                <input v-model="col.primary" type="checkbox" class="h-3.5 w-3.5 accent-[var(--accent)]" /> PK
              </label>
              <button class="shrink-0 rounded-lg p-1.5 text-fg-subtle hover:bg-danger-soft hover:text-danger" @click="removeColumn(i)">
                <Icon name="x" :size="15" />
              </button>
            </div>
          </div>
        </div>

        <p v-if="formError" class="text-sm text-danger">{{ formError }}</p>
      </div>

      <template #footer>
        <Button @click="showAdd = false">Cancel</Button>
        <Button variant="primary" icon="plus" :disabled="submitting" @click="submit">
          {{ submitting ? 'Adding…' : 'Add memory' }}
        </Button>
      </template>
    </Modal>
  </PageShell>
</template>
