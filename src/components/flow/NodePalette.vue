<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { PALETTE_GROUPS, NODE_SPECS, NODE_LIST, type NodeSpec } from '@/data/nodeCatalog'
import { fetchNodeExtRefs, fetchPluginActions, type NodeExtRefMap, type PluginActionEntry } from '@/lib/nodeExtRefs'
import type { NodeExtRef } from '@/lib/nodeSettings'

/**
 * Floating, draggable node palette. Items are dragged onto the canvas; the
 * canvas reads the payload on drop. Double-click also adds a node at center.
 *
 * The listed nodes come from the backend extension table (`/extension`, builtins)
 * so the palette reflects what the server seeds. Each record is matched to its
 * front-end catalog spec by morphic `type` for icon / behaviour. When no backend
 * is connected (or nothing is seeded yet) it falls back to the full catalog so
 * the palette always works standalone.
 *
 * A dropped node is stamped with the backing extension row's identity
 * ({@link NodeExtRef}: `extensionId` + `pluginId`) so the compiler can register
 * plugin nodes under the exact id the extension table holds.
 */
const emit = defineEmits<{ (e: 'add', spec: NodeSpec, ext?: NodeExtRef): void }>()

// Extension row identity per morphic type (from the registry, cached for the
// session in lib/nodeExtRefs and shared with the AI importer). Null ⇒ fall back
// to the full catalog (no backend / nothing seeded), with no identity to stamp.
const refByType = ref<NodeExtRefMap | null>(null)

// Entries contributed by imported plugins — one per action of every plugin that
// has been synced. Unlike the builtins these are pure data: the same generic
// `plugin` spec backs all of them, and what a dropped node does comes from the
// pluginId + action stamped on it.
const pluginActions = ref<PluginActionEntry[]>([])
const PLUGIN_SPEC = NODE_SPECS.plugin

type Tab = 'nodes' | 'plugins'
const tab = ref<Tab>('nodes')
const search = ref('')

onMounted(async () => {
  refByType.value = await fetchNodeExtRefs()
  pluginActions.value = await fetchPluginActions()
})

const filteredActions = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return pluginActions.value
  return pluginActions.value.filter((e) =>
    [e.label, e.action, e.description, e.pluginName].some((s) => s?.toLowerCase().includes(q)),
  )
})

/** Actions grouped under the plugin that contributed them. */
const actionGroups = computed(() => {
  const byPlugin = new Map<string, { pluginId: string; pluginName: string; entries: PluginActionEntry[] }>()
  for (const entry of filteredActions.value) {
    const group = byPlugin.get(entry.pluginId) ?? { pluginId: entry.pluginId, pluginName: entry.pluginName, entries: [] }
    group.entries.push(entry)
    byPlugin.set(entry.pluginId, group)
  }
  return [...byPlugin.values()]
})

function onActionDragStart(e: DragEvent, entry: PluginActionEntry) {
  e.dataTransfer?.setData('application/flomorphic-node', PLUGIN_SPEC.kind)
  e.dataTransfer?.setData('application/flomorphic-ext', JSON.stringify(entry.ref))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function refFor(type: string): NodeExtRef | undefined {
  return refByType.value?.[type]
}

// Group the available specs under the catalog's palette groups. When the
// registry supplied a set, restrict to it (still grouped, preserving group order).
const groups = computed(() => {
  const allow = refByType.value ? new Set(Object.keys(refByType.value)) : null
  const available: NodeSpec[] = allow ? NODE_LIST.filter((s) => allow.has(s.type)) : NODE_LIST
  return PALETTE_GROUPS.map((g) => ({
    ...g,
    specs: g.kinds.map((k) => NODE_SPECS[k]).filter((s) => available.includes(s)),
  })).filter((g) => g.specs.length > 0)
})

const collapsed = ref(false)
const pos = ref({ x: 16, y: 16 })
const dragging = ref(false)
let offset = { x: 0, y: 0 }

function onHeaderDown(e: MouseEvent) {
  dragging.value = true
  offset = { x: e.clientX - pos.value.x, y: e.clientY - pos.value.y }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}
function onMove(e: MouseEvent) {
  if (!dragging.value) return
  pos.value = { x: Math.max(0, e.clientX - offset.x), y: Math.max(0, e.clientY - offset.y) }
}
function onUp() {
  dragging.value = false
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('mouseup', onUp)
}

function onItemDragStart(e: DragEvent, spec: NodeSpec) {
  e.dataTransfer?.setData('application/flomorphic-node', spec.kind)
  const ext = refFor(spec.type)
  if (ext) e.dataTransfer?.setData('application/flomorphic-ext', JSON.stringify(ext))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
</script>

<template>
  <div
    class="absolute z-20 w-[210px] select-none overflow-hidden rounded-xl border bg-surface"
    :style="{ left: pos.x + 'px', top: pos.y + 'px', boxShadow: 'var(--shadow-lg)' }"
    :class="{ 'shadow-2xl': dragging }"
  >
    <div
      class="flex cursor-grab items-center justify-between border-b px-3 py-2 active:cursor-grabbing"
      @mousedown="onHeaderDown"
    >
      <span class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-fg">
        <Icon name="grip-vertical" :size="13" class="text-fg-subtle" />
        Palette
      </span>
      <button class="text-fg-subtle hover:text-fg" @click.stop="collapsed = !collapsed">
        <Icon :name="collapsed ? 'chevron-down' : 'chevron-right'" :size="15" />
      </button>
    </div>

    <!-- Tabs. The Plugins tab only exists once something has been imported and
         synced, so a project with no plugins sees the palette it always had. -->
    <div v-show="!collapsed && pluginActions.length > 0" class="flex border-b text-[11px]">
      <button
        v-for="t in (['nodes', 'plugins'] as Tab[])"
        :key="t"
        class="flex-1 px-2 py-1.5 font-semibold uppercase tracking-wider transition-colors"
        :style="tab === t ? { color: 'var(--accent)', borderBottom: '2px solid var(--accent)' } : { color: 'var(--fg-subtle)' }"
        @click="tab = t"
      >
        {{ t }}
      </button>
    </div>

    <div v-show="!collapsed" class="max-h-[60vh] overflow-y-auto p-2">
      <template v-if="tab === 'nodes' || pluginActions.length === 0">
        <div v-for="group in groups" :key="group.id">
          <p class="px-1.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
            {{ group.label }}
          </p>
          <button
            v-for="spec in group.specs"
            :key="spec.kind"
            draggable="true"
            class="mb-0.5 flex w-full cursor-grab items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent-soft active:cursor-grabbing"
            :title="spec.description"
            @dragstart="onItemDragStart($event, spec)"
            @dblclick="emit('add', spec, refFor(spec.type))"
          >
            <span
              class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
              :style="{ background: `color-mix(in srgb, ${spec.color} 16%, transparent)`, color: spec.color }"
            >
              <Icon :name="spec.icon" :size="14" />
            </span>
            <span class="min-w-0">
              <span class="block truncate text-[12.5px] font-medium text-fg">{{ spec.label }}</span>
              <span class="block truncate text-[10.5px] text-fg-subtle">{{ spec.tagline }}</span>
            </span>
          </button>
        </div>
      </template>

      <!-- Plugin actions: one entry per method of every imported plugin. There
           can be a lot of them, hence the search. -->
      <template v-else>
        <div class="relative mb-2">
          <span class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-subtle">
            <Icon name="search" :size="13" />
          </span>
          <input
            v-model="search"
            class="input !py-1 !pl-7 text-[12px]"
            placeholder="Search actions"
            @mousedown.stop
          />
        </div>

        <p v-if="filteredActions.length === 0" class="px-1.5 py-3 text-center text-[11px] text-fg-subtle">
          No action matches “{{ search }}”.
        </p>

        <div v-for="group in actionGroups" :key="group.pluginId">
          <p class="truncate px-1.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
            {{ group.pluginName }}
          </p>
          <button
            v-for="entry in group.entries"
            :key="entry.ref.extensionId"
            draggable="true"
            class="mb-0.5 flex w-full cursor-grab items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent-soft active:cursor-grabbing"
            :title="entry.description || entry.action"
            @dragstart="onActionDragStart($event, entry)"
            @dblclick="emit('add', PLUGIN_SPEC, entry.ref)"
          >
            <span
              class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
              :style="{ background: `color-mix(in srgb, ${PLUGIN_SPEC.color} 16%, transparent)`, color: PLUGIN_SPEC.color }"
            >
              <Icon :name="entry.icon" :size="14" />
            </span>
            <span class="min-w-0">
              <span class="block truncate text-[12.5px] font-medium text-fg">{{ entry.label }}</span>
              <span class="block truncate font-mono text-[10.5px] text-fg-subtle">{{ entry.action }}</span>
            </span>
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
