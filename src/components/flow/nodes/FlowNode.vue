<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import Icon from '@/components/ui/Icon.vue'
import { specForType, type BaseNodeData } from '@/data/nodeCatalog'
import { createId } from '@/lib/id'

/**
 * A single generic node renderer, driven entirely by the node catalog. Vue Flow
 * registers this component for every FloMorphic node `type`, so the visual
 * language stays uniform and a new node kind is a catalog entry — not a new
 * component. The "compiles to" line shows the Inflowenger primitive it lowers to.
 *
 * Nodes whose spec derives `ports()` (LLM functions, Rule handlers) render one
 * output handle per port along the bottom edge instead of a single right handle,
 * mirroring the Inflowenger inspector's routing nodes.
 */
const props = defineProps<{
  id: string
  type: string
  data: BaseNodeData
  selected?: boolean
}>()

const { updateNodeInternals, addNodes, getNodes, findNode } = useVueFlow()

const spec = computed(() => specForType(props.type))
const accent = computed(() => spec.value?.color ?? 'var(--fg-subtle)')
const title = computed(() => props.data?.title || spec.value?.label || 'Node')
const preview = computed(() => spec.value?.preview?.(props.data) ?? spec.value?.tagline ?? '')
// The selected settings profile, denormalized onto node data by the drawer.
const settingsName = computed(() => {
  const name = (props.data as Record<string, unknown>)?.settingsName
  return typeof name === 'string' ? name.trim() : ''
})

const hasTarget = computed(() => !spec.value?.entry)
// Entry nodes (Start) are bare markers with no settings, so there's nothing
// worth copying — hide the duplicate button for them.
const canCopy = computed(() => !spec.value?.entry)
// Derived output ports (e.g. LLM functions, Rule handlers).
const ports = computed(() => spec.value?.ports?.(props.data) ?? [])
// A single default source handle only when there are no derived ports.
const hasSource = computed(() => !spec.value?.terminal && ports.value.length === 0)

/** Spread N bottom handles evenly across the node width (20% → 80%). */
function portLeft(index: number, total: number): string {
  if (total <= 1) return '50%'
  const start = 20
  const end = 80
  return `${start + ((end - start) / (total - 1)) * index}%`
}

// Recalculate handle bounds after the port count changes so new edges anchor
// correctly (Vue Flow caches handle geometry). Wait a frame + a tick for layout.
watch(
  () => ports.value.length,
  () => {
    if (!props.id) return
    requestAnimationFrame(() => setTimeout(() => updateNodeInternals([props.id]), 50))
  },
  { immediate: true },
)

// ---- On-node identity editing (title / key / scope) ------------------------
// Mirrors the Inflowenger inspector: title is edited inline on the node, and
// key / scope through small popovers on the node itself — so the drawer no
// longer has to spend its height on these universal fields. We mutate the
// reactive `data` object in place (same object Vue Flow tracks), so the canvas
// and the inspector stay in sync live.
const hasKey = computed(() => !!props.data?.key)
const hasScope = computed(() => !!props.data?.scope)

// Flow-control kinds with no result binding (Start / Continue After / Wait-for-All
// / Goto) have meaningless key / scope, so their on-node quick-edit buttons are
// hidden — matching NO_BINDING_KINDS in NodeSettingDetails / WorkflowCanvas.
const NO_BINDING_KINDS = new Set(['startNode', 'until', 'promissall', 'goto'])
const showBinding = computed(() => !NO_BINDING_KINDS.has(props.type))

const editingTitle = ref(false)
const titleDraft = ref('')
const titleInput = ref<HTMLInputElement | null>(null)

function startTitleEdit() {
  titleDraft.value = props.data?.title ?? ''
  editingTitle.value = true
  nextTick(() => {
    titleInput.value?.focus()
    titleInput.value?.select()
  })
}
function saveTitle() {
  if (!editingTitle.value) return
  props.data.title = titleDraft.value.trim() || (spec.value?.label ?? 'Node')
  editingTitle.value = false
}
function cancelTitle() {
  editingTitle.value = false
}

// ---- Duplicate (copy) this node -------------------------------------------
// Adds a sibling node carrying the exact same config/settings, offset slightly
// so it doesn't sit right on top of the original. The title (name) is kept as
// is, but the result `key` is made unique — two nodes writing to the same
// context key would clobber each other — while a fresh node id keeps the graph
// consistent.
function uniqueKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  if (!taken.has(`${base}_copy`)) return `${base}_copy`
  let n = 2
  while (taken.has(`${base}_copy${n}`)) n++
  return `${base}_copy${n}`
}

function duplicateNode() {
  const src = findNode(props.id)
  const taken = new Set(
    getNodes.value
      .map((n) => (n.data as Record<string, unknown>)?.key)
      .filter((k): k is string => typeof k === 'string' && k.length > 0),
  )
  // Structured deep copy of the node data (config + settings + bindings).
  const data = JSON.parse(JSON.stringify(props.data ?? {})) as Record<string, unknown>
  if (typeof data.key === 'string' && data.key) data.key = uniqueKey(data.key, taken)
  const base = src?.position ?? { x: 0, y: 0 }
  addNodes([
    { id: createId('n'), type: props.type, position: { x: base.x + 40, y: base.y + 40 }, data },
  ])
}

// key / scope popovers ------------------------------------------------------
type Pop = 'key' | 'scope' | null
const openPop = ref<Pop>(null)
const popDraft = ref('')

function togglePop(which: Exclude<Pop, null>) {
  if (openPop.value === which) {
    closePop()
    return
  }
  popDraft.value = String(props.data?.[which] ?? '')
  openPop.value = which
}
function savePop() {
  if (!openPop.value) return
  props.data[openPop.value] = popDraft.value.trim()
  closePop()
}
function closePop() {
  openPop.value = null
}

// Close an open popover when clicking anywhere outside this node.
const rootEl = ref<HTMLElement | null>(null)
function onDocPointer(e: MouseEvent) {
  if (!openPop.value) return
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) closePop()
}
onMounted(() => document.addEventListener('mousedown', onDocPointer))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocPointer))
</script>

<template>
  <div
    ref="rootEl"
    class="flow-node group relative rounded-xl border bg-elevated transition-shadow"
    :class="{ 'has-ports': ports.length > 0 }"
    :style="{
      borderColor: selected ? accent : 'var(--line)',
      boxShadow: selected ? `0 0 0 1px ${accent}, var(--shadow-md)` : 'var(--shadow-sm)',
    }"
  >
    <Handle v-if="hasTarget" type="target" :position="Position.Left" />

    <div class="flex items-center gap-2.5 px-3 py-2">
      <span
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
        :style="{ background: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent }"
      >
        <Icon :name="spec?.icon ?? 'info'" :size="16" />
      </span>
      <div class="min-w-0 flex-1">
        <!-- Inline-editable title (click to rename, on-node). -->
        <input
          v-if="editingTitle"
          ref="titleInput"
          v-model="titleDraft"
          class="nodrag w-full rounded border bg-surface px-1 py-0.5 text-[13px] font-semibold leading-tight text-fg outline-none"
          :style="{ borderColor: accent }"
          spellcheck="false"
          @keydown.enter.prevent="saveTitle"
          @keydown.esc.prevent="cancelTitle"
          @blur="saveTitle"
          @click.stop
        />
        <p
          v-else
          class="nodrag cursor-text truncate rounded text-[13px] font-semibold leading-tight text-fg hover:text-[color:var(--accent)]"
          title="Click to rename"
          @click.stop="startTitleEdit"
        >
          {{ title }}
        </p>
        <p class="truncate text-[11px] leading-tight text-fg-subtle">{{ spec?.label }}</p>
      </div>

      <!-- On-node actions: copy the node (always) + Key / Scope quick-edit
           (inspector-style; hidden for flow-control nodes with no binding). -->
      <div class="flex shrink-0 items-center gap-1">
        <!-- Duplicate: clones config/settings under a fresh id + unique key. -->
        <button
          v-if="canCopy"
          class="nodrag flex h-5 w-5 items-center justify-center rounded border opacity-0 transition-colors group-hover:opacity-100"
          :style="{ color: 'var(--fg-subtle)', borderColor: 'var(--line-strong)' }"
          title="Copy this node (same settings, new key)"
          @click.stop="duplicateNode"
        >
          <Icon name="copy" :size="11" />
        </button>
        <template v-if="showBinding">
        <button
          class="nodrag flex h-5 w-5 items-center justify-center rounded border transition-colors"
          :class="hasKey ? '' : 'opacity-0 group-hover:opacity-100'"
          :style="hasKey
            ? { background: accent, color: 'var(--accent-fg)', borderColor: accent }
            : { color: 'var(--fg-subtle)', borderColor: 'var(--line-strong)' }"
          :title="hasKey ? `Key: ${data.key}` : 'Set result key'"
          @click.stop="togglePop('key')"
        >
          <Icon name="key" :size="11" />
        </button>
        <button
          class="nodrag flex h-5 w-5 items-center justify-center rounded border transition-colors"
          :class="hasScope ? '' : 'opacity-0 group-hover:opacity-100'"
          :style="hasScope
            ? { background: accent, color: 'var(--accent-fg)', borderColor: accent }
            : { color: 'var(--fg-subtle)', borderColor: 'var(--line-strong)' }"
          :title="hasScope ? `Scope: ${data.scope}` : 'Set scope (JSONPath)'"
          @click.stop="togglePop('scope')"
        >
          <Icon name="scope" :size="11" />
        </button>
        </template>
      </div>

      <span
        v-if="settingsName"
        class="flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-semibold"
        :style="{ background: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent, maxWidth: '80px' }"
        :title="`Settings: ${settingsName}`"
      >
        <Icon name="settings" :size="10" />
        <span class="truncate">{{ settingsName }}</span>
      </span>
    </div>

    <!-- Key / Scope popover. -->
    <div
      v-if="openPop"
      class="nodrag absolute right-2 top-full z-20 mt-1 flex items-center gap-1.5 rounded-lg border bg-elevated p-1.5 shadow-md"
      @click.stop
      @mousedown.stop
    >
      <input
        v-model="popDraft"
        class="w-32 rounded border bg-surface px-2 py-1 font-mono text-[11px] text-fg outline-none"
        :style="{ borderColor: 'var(--line-strong)' }"
        :placeholder="openPop === 'key' ? 'result key' : 'JSONPath, e.g. $'"
        spellcheck="false"
        autofocus
        @keydown.enter.prevent="savePop"
        @keydown.esc.prevent="closePop"
      />
      <button
        class="shrink-0 rounded px-2 py-1 text-[11px] font-semibold"
        :style="{ background: accent, color: 'var(--accent-fg)' }"
        @click="savePop"
      >
        Set
      </button>
    </div>

    <div class="flex items-center justify-between gap-2 border-t px-3 py-1.5">
      <span class="truncate font-mono text-[10.5px] text-fg-muted">{{ preview }}</span>
      <span
        v-if="spec"
        class="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
        :style="{ background: `color-mix(in srgb, ${accent} 12%, transparent)`, color: accent }"
        :title="`Compiles to ${spec.primitives}`"
      >
        {{ spec.primitives }}
      </span>
    </div>

    <!-- Labels for the derived output ports (aligned above their handles). -->
    <div v-if="ports.length" class="relative h-5 border-t">
      <span
        v-for="(port, i) in ports"
        :key="port.id"
        class="absolute -translate-x-1/2 truncate text-[9px] font-medium text-fg-subtle"
        :style="{ left: portLeft(i, ports.length), maxWidth: '46px', top: '3px' }"
        :title="port.label"
      >
        {{ port.label }}
      </span>
    </div>

    <Handle v-if="hasSource" type="source" :position="Position.Right" />

    <!-- Derived output handles along the bottom edge. -->
    <Handle
      v-for="(port, i) in ports"
      :key="port.id"
      :id="port.id"
      type="source"
      :position="Position.Bottom"
      :style="{ left: portLeft(i, ports.length), background: accent, borderColor: accent }"
      :title="port.label"
    />
  </div>
</template>

<style scoped>
.flow-node {
  width: 194px;
}
</style>
