<script setup lang="ts">
import { ref } from 'vue'
import { nodeRegistryApi } from '@/api/nodeRegistry'
import Icon from '@/components/ui/Icon.vue'

/**
 * "Is this plugin live?" probe for a builtin plugin-backed node (llm / mcp / cast
 * / …, the ones that carry a `pluginId` and a "Get credential" button).
 *
 * A FloMorphic instance can take a couple of seconds to compile and start its
 * plugins, so this asks — on demand — whether the plugin has actually come up.
 * It fetches the plugin's `@intro` live through the morph-api inflow-fusion
 * proxy (`/extension/id/:id/intro`); a plugin that answers is genuinely running
 * and returns its identity (name / author / version).
 *
 * Self-contained: the Node Registry admin panel isn't backed by the extensions
 * store, so this keeps its own probe state per card.
 */
const props = defineProps<{
  /** Extension row id — what the proxy resolves to the plugin's inflow address. */
  extensionId: string
  /** The plugin's inflow id, shown in the tooltip for context. */
  pluginId?: string
}>()

type Status = 'unknown' | 'checking' | 'up' | 'down'

const STATUS: Record<Status, { label: string; color: string }> = {
  unknown: { label: 'Check', color: 'var(--fg-subtle)' },
  checking: { label: 'Checking…', color: 'var(--warning)' },
  up: { label: 'Live', color: 'var(--success)' },
  down: { label: 'Not reachable', color: 'var(--danger)' },
}

const status = ref<Status>('unknown')
const error = ref<string | null>(null)

async function probe() {
  if (!nodeRegistryApi.isRemote()) {
    status.value = 'down'
    error.value = 'No backend configured — liveness needs a connected morph-api.'
    return
  }
  status.value = 'checking'
  error.value = null
  try {
    // A plugin that answers @intro is up and serving.
    await nodeRegistryApi.intro(props.extensionId)
    status.value = 'up'
  } catch (err) {
    status.value = 'down'
    error.value = (err as Error).message
  }
}
</script>

<template>
  <button
    class="flex h-6 w-full items-center justify-center gap-1.5 rounded border px-1.5 text-[12px] hover:bg-accent-soft disabled:opacity-60"
    style="border-color: var(--line-strong)"
    :style="{ color: STATUS[status].color }"
    :disabled="status === 'checking'"
    :title="error ?? (pluginId ? `Ping ${pluginId} — is it up and serving?` : 'Ping the plugin — is it up and serving?')"
    @click="probe"
  >
    <span class="h-1.5 w-1.5 shrink-0 rounded-full" :style="{ background: STATUS[status].color }" />
    <Icon name="activity" :size="13" />
    {{ STATUS[status].label }}
  </button>
</template>
