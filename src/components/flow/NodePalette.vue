<script setup lang="ts">
import { ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { PALETTE_GROUPS, NODE_SPECS, type NodeSpec } from '@/data/nodeCatalog'

/**
 * Floating, draggable node palette. Items are dragged onto the canvas; the
 * canvas reads the payload on drop. Double-click also adds a node at center.
 */
const emit = defineEmits<{ (e: 'add', spec: NodeSpec): void }>()

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
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

const groups = PALETTE_GROUPS.map((g) => ({ ...g, specs: g.kinds.map((k) => NODE_SPECS[k]) }))
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

    <div v-show="!collapsed" class="max-h-[60vh] overflow-y-auto p-2">
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
          @dblclick="emit('add', spec)"
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
    </div>
  </div>
</template>
