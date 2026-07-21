<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { GraphNode } from '@vue-flow/core'
import Icon from '@/components/ui/Icon.vue'
import NodeSettingsSelector from '@/components/flow/NodeSettingsSelector.vue'
import NodeConfig from '@/components/flow/NodeConfig.vue'
import NodeStoreField from '@/components/flow/NodeStoreField.vue'
import { specForType, type BaseNodeData } from '@/data/nodeCatalog'
import { SETTINGS_DATA_KEYS, NODE_REF_DATA_KEYS, usesSettingsProfile } from '@/lib/nodeSettings'
import type { MemoryType } from '@/types/api'

// Kinds with a bespoke editor (NodeConfig). Their kind-specific data keys are
// managed there, so the generic field list drops to the universal fields only.
const CUSTOM_EDITOR_KINDS = new Set(['js', 'opa', 'rule', 'llm', 'goto', 'until'])

/**
 * Generic, catalog-driven property panel. It edits the selected node's `data`
 * in place (Vue Flow node data is reactive, so the canvas updates live). Fields
 * are inferred from the value type, with known long-text keys shown as code
 * areas — so every node kind is editable without a bespoke form.
 */
const props = defineProps<{ node: GraphNode | null }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'delete', node: GraphNode): void }>()

const spec = computed(() => (props.node ? specForType(props.node.type) : undefined))

const UNIVERSAL = ['title', 'key', 'scope']
// Flow-control kinds that carry no result binding: key / scope are meaningless
// for them (Start is a bare entry marker, Continue After just parks/resumes the
// flow, Wait-for-All is a pure join), so they are hidden in the drawer and sent
// empty.
const NO_BINDING_KINDS = new Set(['startNode', 'until', 'promissall'])
const MULTILINE = new Set(['source', 'instructions', 'prompt', 'template', 'payload'])
// `storeId` is rendered with a bespoke store picker (NodeStoreField), so it is
// kept out of the generic field list — along with the read/write action fields
// (`action` + its `query` / `input`) that NodeStoreField also edits.
const STORE_FIELD = 'storeId'
const STORE_ACTION_KEYS = ['action', 'query', 'input'] as const
// Plugin runtime wiring for builtin plugin nodes (llm / mcp / cast). These are
// configured on the backend, not by hand — so they stay out of the drawer.
const BACKEND_PLUGIN_KEYS = ['subject_prefix', 'idle_min', 'request'] as const
// hitl carries its key/value payload in `operationData`, edited by a bespoke
// row editor below — so it is dropped from the generic field list.
const OPERATION_DATA_KEY = 'operationData'
// Managed by the settings selector / stamped from the backing extension row —
// not editable as generic fields.
const HIDDEN = new Set<string>([
  ...SETTINGS_DATA_KEYS,
  ...NODE_REF_DATA_KEYS,
  ...BACKEND_PLUGIN_KEYS,
  ...STORE_ACTION_KEYS,
  STORE_FIELD,
  OPERATION_DATA_KEY,
])

// Store node kinds → the memory-store type their picker is scoped to.
const STORE_MEMORY_TYPE: Record<string, MemoryType> = {
  vecstore: 'vector',
  docstore: 'document',
  cast: 'document',
}

type FieldType = 'text' | 'number' | 'boolean' | 'code' | 'json'

interface Field {
  name: string
  label: string
  type: FieldType
}

function fieldType(name: string, value: unknown): FieldType {
  if (MULTILINE.has(name)) return 'code'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (value !== null && typeof value === 'object') return 'json'
  return 'text'
}

function humanize(name: string): string {
  return name.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
}

const isCustom = computed(() => !!props.node && CUSTOM_EDITOR_KINDS.has(props.node.type))

// Only Plugin nodes (llm / mcp / cast, and user extension plugins) take their
// config from a settings profile — so the picker is shown only for them.
const showSettingsProfile = computed(
  () => !!props.node && usesSettingsProfile(props.node.type, props.node.data as Record<string, unknown>),
)

// A store picker is shown when the node carries a `storeId` and its kind maps
// to a memory-store type.
const storeMemoryType = computed<MemoryType | null>(() => {
  if (!props.node) return null
  const data = props.node.data as BaseNodeData
  if (!(STORE_FIELD in data)) return null
  return STORE_MEMORY_TYPE[props.node.type] ?? null
})

// Title / key / scope are edited inline on the node (see FlowNode) and shown
// here as a compact identity strip — so the drawer's height goes to the config.
const identityFields = computed<Field[]>(() => {
  const hideBinding = !!props.node && NO_BINDING_KINDS.has(props.node.type)
  const names = hideBinding ? UNIVERSAL.filter((n) => n === 'title') : UNIVERSAL
  return names.map((name) => ({ name, label: humanize(name), type: 'text' as FieldType }))
})

const fields = computed<Field[]>(() => {
  if (!props.node) return []
  const data = props.node.data as BaseNodeData
  // Bespoke-editor nodes manage their own kind-specific fields; universal
  // fields are handled by the identity strip above.
  const extra = isCustom.value
    ? []
    : Object.keys(data).filter((k) => !UNIVERSAL.includes(k) && !HIDDEN.has(k))
  return extra.map((name) => ({ name, label: humanize(name), type: fieldType(name, data[name]) }))
})

function data(): BaseNodeData {
  return props.node!.data as BaseNodeData
}

// --- hitl operation data ---------------------------------------------------
// Human-in-the-Loop nodes carry a list of key/value fields in
// `data.operationData`, edited with an add/remove row list.
interface OpRow {
  key: string
  value: string
}

const isHitl = computed(() => props.node?.type === 'hitl')

function opRows(): OpRow[] {
  const d = data() as Record<string, unknown>
  if (!Array.isArray(d[OPERATION_DATA_KEY])) d[OPERATION_DATA_KEY] = []
  return d[OPERATION_DATA_KEY] as OpRow[]
}

function addOpRow() {
  opRows().push({ key: '', value: '' })
}

function removeOpRow(i: number) {
  opRows().splice(i, 1)
}

function jsonText(name: string): string {
  try {
    return JSON.stringify(data()[name] ?? null, null, 2)
  } catch {
    return ''
  }
}

function onJsonInput(name: string, raw: string) {
  try {
    data()[name] = JSON.parse(raw)
  } catch {
    /* keep last valid value until JSON parses */
  }
}

// --- Drawer resizing -------------------------------------------------------
// The drawer sits on the right with its resize grip on the left edge, so
// dragging left widens it. Width is clamped and persisted across sessions.
const MIN_WIDTH = 300
const MAX_WIDTH = 720
const WIDTH_KEY = 'nodeSettings.width'

function loadWidth(): number {
  const saved = Number(localStorage.getItem(WIDTH_KEY))
  return Number.isFinite(saved) && saved > 0 ? clampWidth(saved) : 340
}

function clampWidth(w: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w))
}

const width = ref(loadWidth())
const resizing = ref(false)
let startX = 0
let startWidth = 0

function onResizeMove(e: MouseEvent) {
  // Grip is on the left edge; dragging left (negative delta) widens the drawer.
  width.value = clampWidth(startWidth + (startX - e.clientX))
}

function stopResize() {
  resizing.value = false
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', stopResize)
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
  localStorage.setItem(WIDTH_KEY, String(width.value))
}

function startResize(e: MouseEvent) {
  e.preventDefault()
  resizing.value = true
  startX = e.clientX
  startWidth = width.value
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', stopResize)
  // Suppress text selection / flicker while dragging.
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
}

onBeforeUnmount(stopResize)
</script>

<template>
  <aside
    v-if="node && spec"
    class="relative flex shrink-0 flex-col border-l bg-surface"
    :style="{ width: `${width}px` }"
  >
    <!-- Resize grip on the left edge; drag to change the drawer width. -->
    <div
      class="absolute left-0 top-0 z-10 h-full w-1.5 -translate-x-1/2 cursor-col-resize"
      :class="resizing ? 'bg-[var(--accent)]' : 'hover:bg-[var(--accent)]/40'"
      title="Drag to resize"
      @mousedown="startResize"
    />

    <div class="flex items-center justify-between gap-2 border-b px-4 py-3">
      <div class="flex min-w-0 items-center gap-2.5">
        <span
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          :style="{ background: `color-mix(in srgb, ${spec.color} 16%, transparent)`, color: spec.color }"
        >
          <Icon :name="spec.icon" :size="16" />
        </span>
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold text-fg">{{ spec.label }}</p>
          <p class="truncate text-[11px] text-fg-subtle">Compiles to {{ spec.primitives }}</p>
        </div>
      </div>
      <button class="text-fg-subtle hover:text-fg" title="Close" @click="emit('close')">
        <Icon name="x" :size="18" />
      </button>
    </div>

    <!-- Compact settings-profile picker, in the drawer head. Plugin nodes only. -->
    <div v-if="showSettingsProfile" class="border-b px-4 py-2">
      <NodeSettingsSelector :key="node.id" :node="node" />
    </div>

    <div class="flex-1 space-y-4 overflow-y-auto p-4">
      <p class="text-xs leading-relaxed text-fg-muted">{{ spec.description }}</p>

      <!-- Identity strip: compact rows for title / key / scope. These are also
           editable inline on the node itself. -->
      <div class="space-y-1.5 rounded-lg border p-2.5">
        <div v-for="field in identityFields" :key="field.name" class="flex items-center gap-2">
          <label class="w-12 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
            {{ field.label }}
          </label>
          <input
            v-model="(data() as any)[field.name]"
            class="input flex-1 px-2 py-1 text-xs"
            :placeholder="field.name === 'scope' ? '$' : ''"
          />
        </div>
      </div>

      <!-- Store picker (Doc / Vector / Cast nodes) in place of a raw store id.
           For Doc / Vector stores it also hosts the read/write action editor. -->
      <NodeStoreField
        v-if="storeMemoryType"
        v-model="(data() as any).storeId"
        :memory-type="storeMemoryType"
        :data="node.data as any"
      />

      <!-- Human-in-the-Loop: key/value operation data. -->
      <div v-if="isHitl" class="space-y-1.5">
        <div class="flex items-center justify-between">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Operation data</label>
          <button class="flex items-center gap-1 text-[12px] text-accent hover:underline" @click="addOpRow">
            <Icon name="plus" :size="13" /> Add
          </button>
        </div>
        <div v-for="(row, i) in opRows()" :key="i" class="flex items-center gap-2">
          <input v-model="row.key" class="input w-32 font-mono text-xs" placeholder="key" />
          <input v-model="row.value" class="input flex-1 font-mono text-xs" placeholder="value" />
          <button
            class="shrink-0 rounded-lg p-1.5 text-fg-subtle hover:bg-danger-soft hover:text-danger"
            @click="removeOpRow(i)"
          >
            <Icon name="x" :size="15" />
          </button>
        </div>
        <p v-if="opRows().length === 0" class="text-[11px] text-fg-subtle">No fields yet — add one to collect from the human.</p>
      </div>

      <div v-for="field in fields" :key="field.name" class="space-y-1">
        <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{{ field.label }}</label>

        <input
          v-if="field.type === 'text'"
          v-model="(data() as any)[field.name]"
          class="input"
          :placeholder="field.name === 'scope' ? '$' : ''"
        />
        <input
          v-else-if="field.type === 'number'"
          v-model.number="(data() as any)[field.name]"
          type="number"
          class="input"
        />
        <label v-else-if="field.type === 'boolean'" class="flex items-center gap-2 text-sm text-fg">
          <input v-model="(data() as any)[field.name]" type="checkbox" class="h-4 w-4 accent-[var(--accent)]" />
          <span>{{ (data() as any)[field.name] ? 'Enabled' : 'Disabled' }}</span>
        </label>
        <textarea
          v-else-if="field.type === 'code'"
          v-model="(data() as any)[field.name]"
          rows="5"
          spellcheck="false"
          class="input resize-none font-mono text-xs leading-relaxed"
        />
        <textarea
          v-else
          :value="jsonText(field.name)"
          rows="4"
          spellcheck="false"
          class="input resize-none font-mono text-xs leading-relaxed"
          @input="onJsonInput(field.name, ($event.target as HTMLTextAreaElement).value)"
        />
      </div>

      <!-- Bespoke editor for code / rule / llm nodes. -->
      <div v-if="isCustom" class="border-t pt-4">
        <NodeConfig :key="node.id" :node="node" />
      </div>
    </div>

    <div class="border-t p-3">
      <button
        class="btn w-full text-danger"
        style="border: 1px solid var(--line-strong)"
        @click="emit('delete', node)"
      >
        <Icon name="trash" :size="15" />
        Delete node
      </button>
    </div>
  </aside>
</template>
