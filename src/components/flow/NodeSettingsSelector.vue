<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { GraphNode } from '@vue-flow/core'
import type { NodeSetting } from '@/types/api'
import { nodeSettingsApi } from '@/api/nodeSettings'
import { nodeUniqId as computeNodeUniqId } from '@/lib/nodeSettings'
import Icon from '@/components/ui/Icon.vue'
import NodeSettingsModal from '@/components/settings/NodeSettingsModal.vue'

/**
 * The settings-profile box shown at the top of the node drawer. It lists the
 * profiles bound to this node (its kind / plugin identity), lets the user pick
 * the one this node instance uses, and shows / edits the selected profile's
 * values. The selection is stored on the node's `data.settingsId` (+ a
 * denormalized `data.settingsName` so the canvas tag can render without a fetch).
 */
const props = defineProps<{ node: GraphNode }>()

const uniqId = computed(() => computeNodeUniqId(props.node.type, props.node.data as Record<string, unknown>))

const profiles = ref<NodeSetting[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const showModal = ref(false)
const editing = ref<NodeSetting | null>(null)
// The selected profile's values are collapsed by default to keep the head compact.
const expanded = ref(false)

function data(): Record<string, unknown> {
  return props.node.data as Record<string, unknown>
}
const selectedId = computed<string>(() => String(data().settingsId ?? ''))
const selected = computed(() => profiles.value.find((p) => p.id === selectedId.value) ?? null)

async function load() {
  loading.value = true
  error.value = null
  try {
    profiles.value = await nodeSettingsApi.listForNode(uniqId.value)
    // Keep the denormalized name in sync (or clear a dangling reference).
    if (selectedId.value) {
      const match = profiles.value.find((p) => p.id === selectedId.value)
      data().settingsName = match ? match.title : ''
    }
  } catch (err) {
    error.value = (err as Error).message
    profiles.value = []
  } finally {
    loading.value = false
  }
}

// Reload whenever the drawer switches to another node.
watch(uniqId, load, { immediate: true })

function onPick(id: string) {
  const match = profiles.value.find((p) => p.id === id)
  data().settingsId = id
  data().settingsName = match?.title ?? ''
}

function clearSelection() {
  data().settingsId = ''
  data().settingsName = ''
}

function openNew() {
  editing.value = null
  showModal.value = true
}
function openEdit() {
  if (!selected.value) return
  editing.value = selected.value
  showModal.value = true
}

async function onSaved(record: NodeSetting) {
  await load()
  onPick(record.id) // select the just-created / just-edited profile
}
</script>

<template>
  <div>
    <!-- Compact single-row profile picker. -->
    <div class="flex items-center gap-1.5">
      <Icon name="settings" :size="13" class="shrink-0 text-fg-subtle" />
      <select
        class="input min-w-0 flex-1 py-1 text-xs"
        :value="selectedId"
        :disabled="loading"
        title="Settings profile"
        @change="onPick(($event.target as HTMLSelectElement).value)"
      >
        <option value="">{{ loading ? 'Loading…' : 'No profile' }}</option>
        <option v-for="p in profiles" :key="p.id" :value="p.id">{{ p.title }}</option>
      </select>
      <button
        v-if="selected"
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded border text-fg-subtle hover:text-fg"
        style="border-color: var(--line-strong)"
        :title="expanded ? 'Hide values' : 'Show values'"
        @click="expanded = !expanded"
      >
        <Icon :name="expanded ? 'chevron-down' : 'chevron-right'" :size="14" />
      </button>
      <button
        v-if="selected"
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded border text-fg-subtle hover:text-fg"
        style="border-color: var(--line-strong)"
        title="Edit this profile"
        @click="openEdit"
      >
        <Icon name="settings" :size="13" />
      </button>
      <button
        class="flex h-6 shrink-0 items-center gap-0.5 rounded border px-1.5 text-[12px] text-accent hover:bg-accent-soft"
        style="border-color: var(--line-strong)"
        title="New profile"
        @click="openNew"
      >
        <Icon name="plus" :size="13" />
      </button>
    </div>

    <p v-if="error" class="mt-1.5 text-[12px] text-danger">{{ error }}</p>

    <!-- Configured values of the selected profile (collapsed by default). -->
    <div v-if="selected && expanded" class="mt-2 space-y-1 border-t pt-2">
      <div
        v-for="(value, key) in selected.settings"
        :key="key"
        class="flex items-baseline gap-2 text-[12px]"
      >
        <span class="shrink-0 font-mono text-fg-subtle">{{ key }}</span>
        <span class="min-w-0 flex-1 truncate text-right font-mono text-fg-muted">{{
          typeof value === 'string' ? value : JSON.stringify(value)
        }}</span>
      </div>
      <div v-if="Object.keys(selected.settings).length === 0" class="text-[12px] text-fg-subtle">
        No fields configured.
      </div>
      <button class="mt-1 text-[12px] text-fg-subtle hover:text-danger" @click="clearSelection">
        Clear selection
      </button>
    </div>

    <NodeSettingsModal
      :open="showModal"
      :record="editing"
      :node-uniq-id="uniqId"
      :node-type="node.type"
      lock-node
      @close="showModal = false"
      @saved="onSaved"
    />
  </div>
</template>
