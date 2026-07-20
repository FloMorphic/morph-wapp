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
  <div class="rounded-xl border bg-surface-2 p-3">
    <div class="flex items-center justify-between gap-2">
      <label class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
        <Icon name="settings" :size="13" /> Settings profile
      </label>
      <button class="flex items-center gap-1 text-[12px] text-accent hover:underline" @click="openNew">
        <Icon name="plus" :size="13" /> New
      </button>
    </div>

    <div class="mt-2 flex items-center gap-2">
      <select
        class="input flex-1"
        :value="selectedId"
        :disabled="loading"
        @change="onPick(($event.target as HTMLSelectElement).value)"
      >
        <option value="">{{ loading ? 'Loading…' : 'None' }}</option>
        <option v-for="p in profiles" :key="p.id" :value="p.id">{{ p.title }}</option>
      </select>
      <button
        v-if="selected"
        class="btn shrink-0"
        style="border: 1px solid var(--line-strong)"
        title="Edit this profile"
        @click="openEdit"
      >
        <Icon name="settings" :size="14" />
      </button>
    </div>

    <p v-if="error" class="mt-2 text-[12px] text-danger">{{ error }}</p>

    <!-- Configured values of the selected profile -->
    <div v-if="selected" class="mt-2.5 space-y-1 border-t pt-2.5">
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
    <p v-else-if="!loading && profiles.length === 0" class="mt-2 text-[12px] text-fg-subtle">
      No profiles for this node yet. Create one to reuse its config across instances.
    </p>

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
