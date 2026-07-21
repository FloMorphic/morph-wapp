<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { useMemoryStore } from '@/stores/memory'
import type {
  ColumnType,
  MemoryStore,
  MemoryType,
  TableColumn,
  VectorMetric,
} from '@/types/api'

/**
 * Store picker for store nodes (Doc / Vector / Cast). Replaces the raw
 * `storeId` text field: it lists the memory stores whose type matches the
 * node (`vector` for a Vector Store node, `document` for Doc / Cast), lets the
 * user pick one, and — inline — define a brand-new store without leaving the
 * drawer. The chosen store's id is written back to `data.storeId`.
 */
const props = defineProps<{
  /** Current store id held on the node (data.storeId). */
  modelValue: string
  /** Memory type the picker is scoped to. */
  memoryType: MemoryType
  /**
   * The node's reactive `data`. When it carries an `action` key (Doc / Vector
   * store nodes), a read/write selector is shown: `read` runs `query` against
   * the store, `write` sends the `input` JSONPath / scope as its payload. Cast
   * nodes pass no data, so the selector is hidden.
   */
  data?: Record<string, unknown>
}>()
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

// Doc / Vector store nodes carry a read/write `action`; Cast does not.
const hasAction = computed(() => !!props.data && 'action' in props.data)
const action = computed<'read' | 'write'>(() =>
  props.data?.action === 'write' ? 'write' : 'read',
)
function setAction(value: 'read' | 'write') {
  if (props.data) props.data.action = value
}

const store = useMemoryStore()
onMounted(() => {
  if (store.items.length === 0) store.refresh()
})

const options = computed<MemoryStore[]>(() =>
  store.items.filter((m) => m.type === props.memoryType),
)

// A selected id that no longer resolves to a store of this type (renamed,
// deleted, or a legacy free-text value) is still surfaced so it isn't lost.
const orphaned = computed(
  () => !!props.modelValue && !options.value.some((m) => m.id === props.modelValue),
)

const metrics: VectorMetric[] = ['cosine', 'dot', 'euclidean']
const columnTypes: ColumnType[] = ['string', 'text', 'number', 'boolean', 'object', 'array', 'timestamp']

const creating = ref(false)
const submitting = ref(false)
const formError = ref<string | null>(null)

const form = reactive({
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
  form.name = ''
  form.description = ''
  form.vector = {
    provider: 'openai',
    embeddingModel: 'text-embedding-3-small',
    token: '',
    dimensions: 1536,
    metric: 'cosine',
    namespace: 'default',
  }
  form.document = { table: '', columns: [{ name: 'id', type: 'string', primary: true }] }
  formError.value = null
}

function openCreate() {
  resetForm()
  creating.value = true
}
function cancelCreate() {
  creating.value = false
  formError.value = null
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
    formError.value = 'Give the store a name.'
    return
  }
  if (props.memoryType === 'vector' && !form.vector.embeddingModel.trim()) {
    formError.value = 'A vector store needs an embedding model.'
    return
  }
  if (props.memoryType === 'document') {
    if (!form.document.table.trim()) {
      formError.value = 'A document store needs a table name.'
      return
    }
    if (form.document.columns.filter((c) => c.name.trim()).length === 0) {
      formError.value = 'Define at least one column.'
      return
    }
  }
  const name = form.name.trim()
  submitting.value = true
  try {
    await store.add({
      name,
      type: props.memoryType,
      description: form.description.trim(),
      vector: props.memoryType === 'vector' ? { ...form.vector } : undefined,
      document:
        props.memoryType === 'document'
          ? { table: form.document.table.trim(), columns: form.document.columns.filter((c) => c.name.trim()) }
          : undefined,
    })
    // `add` refreshes the list; select the store we just made.
    const match = store.items.find((m) => m.name === name && m.type === props.memoryType)
    if (match) emit('update:modelValue', match.id)
    creating.value = false
  } catch (err) {
    formError.value = (err as Error).message
  } finally {
    submitting.value = false
  }
}

function onSelect(e: Event) {
  emit('update:modelValue', (e.target as HTMLSelectElement).value)
}
</script>

<template>
  <div class="space-y-2">
    <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Store</label>

    <div v-if="!creating" class="space-y-1.5">
      <select :value="modelValue" class="input" @change="onSelect">
        <option value="">— no store —</option>
        <option v-if="orphaned" :value="modelValue">{{ modelValue }} (missing)</option>
        <option v-for="m in options" :key="m.id" :value="m.id">{{ m.name }}</option>
      </select>

      <div class="flex items-center justify-between">
        <p class="text-[11px] text-fg-subtle">
          {{ options.length }} {{ memoryType }} store{{ options.length === 1 ? '' : 's' }}
        </p>
        <button class="flex items-center gap-1 text-[12px] text-accent hover:underline" @click="openCreate">
          <Icon name="plus" :size="13" /> New store
        </button>
      </div>

      <!-- Read / write selector (Doc / Vector store nodes). -->
      <div v-if="hasAction" class="space-y-2 pt-1">
        <div class="grid grid-cols-2 gap-1 rounded-lg border bg-surface-2 p-0.5">
          <button
            type="button"
            class="rounded-md px-2 py-1 text-xs font-medium transition-colors"
            :class="action === 'read' ? 'bg-surface text-fg shadow-sm' : 'text-fg-subtle hover:text-fg'"
            @click="setAction('read')"
          >
            Read
          </button>
          <button
            type="button"
            class="rounded-md px-2 py-1 text-xs font-medium transition-colors"
            :class="action === 'write' ? 'bg-surface text-fg shadow-sm' : 'text-fg-subtle hover:text-fg'"
            @click="setAction('write')"
          >
            Write
          </button>
        </div>

        <!-- Read: a query run against the selected store. -->
        <div v-if="action === 'read'" class="space-y-1">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Query</label>
          <textarea
            :value="(props.data!.query as string) ?? ''"
            rows="3"
            spellcheck="false"
            class="input resize-none font-mono text-xs leading-relaxed"
            :placeholder="memoryType === 'vector' ? 'Vector query — text or JSONPath to embed' : 'Query to run on the store'"
            @input="props.data!.query = ($event.target as HTMLTextAreaElement).value"
          />
        </div>

        <!-- Write: the payload, taken from a JSONPath / the node scope. -->
        <div v-else class="space-y-1">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Input</label>
          <input
            :value="(props.data!.input as string) ?? ''"
            class="input font-mono text-xs"
            placeholder="$"
            @input="props.data!.input = ($event.target as HTMLInputElement).value"
          />
          <p class="text-[11px] text-fg-subtle">JSONPath (or the node scope) of the value to write.</p>
        </div>
      </div>
    </div>

    <!-- Inline new-store form -->
    <div v-else class="space-y-3 rounded-lg border bg-surface-2 p-3">
      <div class="flex items-center justify-between">
        <p class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
          New {{ memoryType }} store
        </p>
        <button class="text-fg-subtle hover:text-fg" title="Cancel" @click="cancelCreate">
          <Icon name="x" :size="15" />
        </button>
      </div>

      <div class="space-y-1">
        <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Name</label>
        <input v-model="form.name" class="input" placeholder="e.g. product-docs" />
      </div>
      <div class="space-y-1">
        <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Description</label>
        <input v-model="form.description" class="input" placeholder="What it stores" />
      </div>

      <!-- Vector config -->
      <template v-if="memoryType === 'vector'">
        <div class="space-y-1">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Provider</label>
          <input v-model="form.vector.provider" class="input" placeholder="openai" />
        </div>
        <div class="space-y-1">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Embedding model</label>
          <input v-model="form.vector.embeddingModel" class="input font-mono text-xs" placeholder="text-embedding-3-small" />
        </div>
        <div class="space-y-1">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Token</label>
          <input v-model="form.vector.token" type="password" class="input font-mono text-xs" placeholder="embedding model API key" />
        </div>
        <div class="grid grid-cols-3 gap-2">
          <div class="space-y-1">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Dims</label>
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
      </template>

      <!-- Document config -->
      <template v-else>
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
          <div v-for="(col, i) in form.document.columns" :key="i" class="flex items-center gap-1.5">
            <input v-model="col.name" class="input flex-1 font-mono text-xs" placeholder="column_name" />
            <select v-model="col.type" class="input w-24 text-xs">
              <option v-for="t in columnTypes" :key="t" :value="t">{{ t }}</option>
            </select>
            <label class="flex shrink-0 items-center gap-1 text-[11px] text-fg-muted" title="Primary / lookup key">
              <input v-model="col.primary" type="checkbox" class="h-3.5 w-3.5 accent-[var(--accent)]" /> PK
            </label>
            <button class="shrink-0 rounded-lg p-1 text-fg-subtle hover:bg-danger-soft hover:text-danger" @click="removeColumn(i)">
              <Icon name="x" :size="14" />
            </button>
          </div>
        </div>
      </template>

      <p v-if="formError" class="text-sm text-danger">{{ formError }}</p>

      <div class="flex justify-end gap-2 pt-1">
        <button class="btn text-xs" @click="cancelCreate">Cancel</button>
        <button
          class="btn text-xs"
          style="background: var(--accent); color: #fff"
          :disabled="submitting"
          @click="submit"
        >
          {{ submitting ? 'Creating…' : 'Create & select' }}
        </button>
      </div>
    </div>
  </div>
</template>
