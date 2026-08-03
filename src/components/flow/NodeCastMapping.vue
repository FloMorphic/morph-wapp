<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import type { GraphNode } from '@vue-flow/core'
import Icon from '@/components/ui/Icon.vue'
import { useMemoryStore } from '@/stores/memory'
import type { BaseNodeData } from '@/data/nodeCatalog'
import type { ColumnType, TableColumn } from '@/types/api'

/**
 * Field-mapping editor for the Cast node. A Cast builds one value by mapping
 * each target key to either a static literal the user types, or a JSONPath /
 * `{{$.path}}` template resolved against the run-time Context.
 *
 * The target keys come from the schema of the referenced Document store: pick a
 * store above and its columns become the rows to fill in (name → value). Keys
 * not in the schema can still be added by hand, so the Cast is never locked to
 * the schema it started from.
 *
 * The rows live on `data.mappings` as `{ key, mode, value }` — the shape the
 * node catalog's `cast` spec declares and its preview counts.
 */
const props = defineProps<{ node: GraphNode }>()

type Mode = 'static' | 'jsonpath'
interface MappingRow {
  key: string
  mode: Mode
  value: string
}

// The literal shown in help text; kept in script so its braces don't collide
// with Vue's own `{{ }}` interpolation in the template.
const PATH_HINT = '{{$.path}}'

const store = useMemoryStore()
onMounted(() => {
  if (store.items.length === 0) store.refresh()
})

function data(): BaseNodeData {
  return props.node.data as BaseNodeData
}

// The mappings array is the source of truth; normalise legacy / missing values
// in place so the editor binds to — and add/remove mutate — the real array on
// the node, not a mapped copy.
function rows(): MappingRow[] {
  const d = data() as Record<string, unknown>
  if (!Array.isArray(d.mappings)) d.mappings = []
  const arr = d.mappings as MappingRow[]
  for (const r of arr) {
    r.key ??= ''
    r.mode = r.mode === 'jsonpath' ? 'jsonpath' : 'static'
    r.value ??= ''
  }
  return arr
}

const storeId = computed(() => String((data() as Record<string, unknown>).storeId ?? ''))

const selectedStore = computed(() =>
  store.items.find((m) => m.id === storeId.value && m.type === 'document'),
)

// The schema columns of the selected store — the keys a Cast is meant to fill.
const columns = computed<TableColumn[]>(() => selectedStore.value?.document?.columns ?? [])

// The type badge for a mapped key, when it matches a schema column.
function columnType(key: string): ColumnType | null {
  return columns.value.find((c) => c.name === key)?.type ?? null
}

// Schema columns that have no mapping row yet — offered as one-click chips.
const unmappedColumns = computed<TableColumn[]>(() => {
  const taken = new Set(rows().map((r) => r.key.trim()).filter(Boolean))
  return columns.value.filter((c) => c.name.trim() && !taken.has(c.name.trim()))
})

function addRow(key = '', mode: Mode = 'jsonpath') {
  rows().push({ key, mode, value: '' })
}

function addColumn(col: TableColumn) {
  // A schema field defaults to a variable binding — the common case is wiring a
  // Context value into it; a literal is the exception the user switches to.
  addRow(col.name, 'jsonpath')
}

function loadSchema() {
  for (const col of unmappedColumns.value) addColumn(col)
}

function removeRow(i: number) {
  rows().splice(i, 1)
}

function setMode(row: MappingRow, mode: Mode) {
  row.mode = mode
}

// When a store is first chosen on an untouched Cast, seed the rows from its
// schema so the common path — pick a store, fill values — needs no extra click.
// An already-populated mapping is never disturbed.
watch(storeId, () => {
  if (rows().length === 0 && columns.value.length > 0) loadSchema()
})
watch(columns, () => {
  if (rows().length === 0 && columns.value.length > 0) loadSchema()
})
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between">
      <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Field mappings</label>
      <button class="flex items-center gap-1 text-[12px] text-accent hover:underline" @click="addRow()">
        <Icon name="plus" :size="13" /> Add field
      </button>
    </div>

    <p class="text-[11px] leading-relaxed text-fg-subtle">
      Map each field to a static value or a
      <span class="font-mono">{{ PATH_HINT }}</span> / JSONPath resolved against Context at run time.
      <template v-if="selectedStore">
        Keys come from the <span class="font-medium text-fg-muted">{{ selectedStore.name }}</span> schema.
      </template>
      <template v-else>Pick a store above to load its fields.</template>
    </p>

    <!-- Schema fields not yet mapped: one-click chips to add a row for each. -->
    <div v-if="unmappedColumns.length" class="flex flex-wrap items-center gap-1.5">
      <span class="text-[11px] text-fg-subtle">From schema:</span>
      <button
        v-for="col in unmappedColumns"
        :key="col.name"
        class="flex items-center gap-1 rounded-full border bg-surface-2 px-2 py-0.5 text-[11px] text-fg-muted hover:border-accent hover:text-accent"
        :title="`Add ${col.name} (${col.type})`"
        @click="addColumn(col)"
      >
        <Icon name="plus" :size="11" /> {{ col.name }}
      </button>
      <button
        v-if="unmappedColumns.length > 1"
        class="text-[11px] text-accent hover:underline"
        @click="loadSchema"
      >
        Add all
      </button>
    </div>

    <!-- The mapping rows. -->
    <div v-for="(row, i) in rows()" :key="i" class="space-y-1 rounded-lg border bg-surface-2 p-2">
      <div class="flex items-center gap-1.5">
        <input
          v-model="row.key"
          class="input flex-1 font-mono text-xs"
          placeholder="field name"
        />
        <span
          v-if="columnType(row.key)"
          class="shrink-0 rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-subtle"
          title="Type from the store schema"
        >
          {{ columnType(row.key) }}
        </span>
        <button
          class="shrink-0 rounded-lg p-1 text-fg-subtle hover:bg-danger-soft hover:text-danger"
          title="Remove field"
          @click="removeRow(i)"
        >
          <Icon name="x" :size="14" />
        </button>
      </div>

      <div class="flex items-center gap-1.5">
        <!-- Static literal vs. resolved variable. -->
        <div class="grid shrink-0 grid-cols-2 gap-0.5 rounded-lg border bg-surface p-0.5">
          <button
            type="button"
            class="rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors"
            :class="row.mode === 'jsonpath' ? 'bg-surface-2 text-fg shadow-sm' : 'text-fg-subtle hover:text-fg'"
            title="Resolve a Context value at run time"
            @click="setMode(row, 'jsonpath')"
          >
            Variable
          </button>
          <button
            type="button"
            class="rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors"
            :class="row.mode === 'static' ? 'bg-surface-2 text-fg shadow-sm' : 'text-fg-subtle hover:text-fg'"
            title="Use a fixed value"
            @click="setMode(row, 'static')"
          >
            Static
          </button>
        </div>
        <input
          v-model="row.value"
          class="input flex-1 text-xs"
          :class="row.mode === 'jsonpath' ? 'font-mono' : ''"
          :placeholder="row.mode === 'jsonpath' ? '{{$.data.user.name}}' : 'static value'"
        />
      </div>
    </div>

    <p v-if="rows().length === 0" class="text-[11px] text-fg-subtle">
      No fields yet — add one, or pick a store above to load its schema.
    </p>
  </div>
</template>
