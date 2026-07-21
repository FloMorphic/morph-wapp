<script setup lang="ts">
import { ref } from 'vue'
import { nodeRegistryApi } from '@/api/nodeRegistry'
import type { PluginCredAccess, PluginCredResponse } from '@/types/api'
import Icon from '@/components/ui/Icon.vue'

/**
 * "Get credential" control for a plugin-backed node. It asks the backend to mint
 * a runtime credential for the node's `pluginId` (a hard-coded seed value for the
 * builtin llm/mcp/cast nodes, or the imported id for a user extension plugin) so
 * the plugin can be run to serve the node's functionality. The returned cred +
 * env block are shown inline with copy buttons.
 */
const props = withDefaults(
  defineProps<{
    pluginId: string
    /** Credential name (defaults to the plugin id). */
    name?: string
    /** Credential breadth; strict is scoped to this one plugin. */
    access?: PluginCredAccess
  }>(),
  { name: '', access: 'strict' },
)

const loading = ref(false)
const error = ref<string | null>(null)
const result = ref<PluginCredResponse | null>(null)
const copied = ref<'cred' | 'env' | null>(null)

async function fetchCred() {
  if (!props.pluginId.trim()) {
    error.value = 'This node has no plugin id.'
    return
  }
  loading.value = true
  error.value = null
  try {
    result.value = await nodeRegistryApi.pluginCred({
      pluginId: props.pluginId,
      name: props.name || props.pluginId,
      access: props.access,
    })
  } catch (err) {
    error.value = (err as Error).message
    result.value = null
  } finally {
    loading.value = false
  }
}

async function copy(which: 'cred' | 'env') {
  if (!result.value) return
  await navigator.clipboard.writeText(result.value[which])
  copied.value = which
  setTimeout(() => (copied.value = null), 1200)
}
</script>

<template>
  <div class="space-y-1.5">
    <button
      class="flex h-6 w-full items-center justify-center gap-1 rounded border px-1.5 text-[12px] text-accent hover:bg-accent-soft disabled:opacity-60"
      style="border-color: var(--line-strong)"
      :disabled="loading"
      title="Mint a runtime credential to run this plugin"
      @click="fetchCred"
    >
      <Icon name="key" :size="13" />
      {{ loading ? 'Requesting…' : 'Get credential' }}
    </button>

    <p v-if="error" class="text-[12px] text-danger">{{ error }}</p>

    <div v-if="result" class="space-y-1.5 rounded border p-2" style="border-color: var(--line-strong)">
      <div class="flex items-center justify-between gap-2">
        <span class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Credential</span>
        <button class="flex items-center gap-1 text-[12px] text-accent hover:underline" @click="copy('cred')">
          <Icon :name="copied === 'cred' ? 'check' : 'copy'" :size="12" />
          {{ copied === 'cred' ? 'Copied' : 'Copy' }}
        </button>
      </div>
      <p class="max-h-16 overflow-y-auto break-all font-mono text-[11px] text-fg-muted">{{ result.cred }}</p>

      <div class="flex items-center justify-between gap-2 border-t pt-1.5">
        <span class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Env</span>
        <button class="flex items-center gap-1 text-[12px] text-accent hover:underline" @click="copy('env')">
          <Icon :name="copied === 'env' ? 'check' : 'copy'" :size="12" />
          {{ copied === 'env' ? 'Copied' : 'Copy' }}
        </button>
      </div>
      <pre class="max-h-24 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] text-fg-muted">{{ result.env }}</pre>
    </div>
  </div>
</template>
