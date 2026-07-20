<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import PageShell from '@/components/ui/PageShell.vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import { useUiStore, type ThemePreference } from '@/stores/ui'
import { flowsApi } from '@/api/flows'

const ui = useUiStore()
const remote = flowsApi.isRemote()
const apiBase = import.meta.env.VITE_API_BASE_URL || ''

const themes: { value: ThemePreference; label: string; icon: string }[] = [
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'system', label: 'System', icon: 'monitor' },
]

const cleared = ref(false)
function clearLocal() {
  if (!window.confirm('Delete all locally-stored workflows? This cannot be undone.')) return
  Object.keys(localStorage)
    .filter((k) => k.startsWith('flomorphic:flows'))
    .forEach((k) => localStorage.removeItem(k))
  cleared.value = true
}
</script>

<template>
  <PageShell title="Settings" subtitle="Preferences and workspace configuration.">
    <div class="max-w-2xl space-y-6">
      <!-- Appearance -->
      <section class="card p-5">
        <h2 class="text-sm font-semibold text-fg">Appearance</h2>
        <p class="mb-4 mt-1 text-[13px] text-fg-muted">Choose how FloMorphic looks. System follows your OS.</p>
        <div class="flex gap-2">
          <button
            v-for="t in themes"
            :key="t.value"
            class="flex flex-1 flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-sm transition-colors"
            :style="ui.theme === t.value ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)' } : {}"
            @click="ui.setTheme(t.value)"
          >
            <Icon :name="t.icon" :size="18" />
            {{ t.label }}
          </button>
        </div>
      </section>

      <!-- Backend -->
      <section class="card p-5">
        <h2 class="text-sm font-semibold text-fg">Backend</h2>
        <p class="mb-4 mt-1 text-[13px] text-fg-muted">
          FloMorphic talks to the Inflowenger <code class="font-mono text-xs text-accent">inspector-api</code>.
          Set <code class="font-mono text-xs">VITE_API_BASE_URL</code> to connect; otherwise it runs standalone with
          browser-local persistence.
        </p>
        <div class="flex items-center justify-between rounded-lg border bg-surface-2 px-4 py-3">
          <div class="flex items-center gap-2.5">
            <span class="h-2 w-2 rounded-full" :style="{ background: remote ? 'var(--success)' : 'var(--fg-subtle)' }" />
            <span class="text-sm font-medium text-fg">{{ remote ? 'Connected' : 'Standalone (local)' }}</span>
          </div>
          <code class="max-w-[50%] truncate font-mono text-xs text-fg-muted">{{ apiBase || 'no backend configured' }}</code>
        </div>
      </section>

      <!-- Node registry -->
      <section class="card p-5">
        <h2 class="text-sm font-semibold text-fg">Node registry</h2>
        <p class="mb-4 mt-1 text-[13px] text-fg-muted">
          Define the nodes that make up the canvas palette — admin-managed builtins (seeded on first run) and
          user-imported inflowv1 plugin extensions.
        </p>
        <RouterLink
          :to="{ name: 'node-registry' }"
          class="flex items-center justify-between rounded-lg border bg-surface-2 px-4 py-3 transition-colors hover:border-accent-border"
        >
          <div class="flex items-center gap-2.5">
            <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <Icon name="node-plugin" :size="16" />
            </span>
            <span class="text-sm font-medium text-fg">Manage builtin &amp; extension nodes</span>
          </div>
          <Icon name="chevron-right" :size="18" class="text-fg-subtle" />
        </RouterLink>
      </section>

      <!-- Local data -->
      <section class="card p-5">
        <h2 class="text-sm font-semibold text-fg">Local data</h2>
        <p class="mb-4 mt-1 text-[13px] text-fg-muted">Workflows saved in this browser when no backend is connected.</p>
        <div class="flex items-center gap-3">
          <Button icon="trash" @click="clearLocal">Clear local workflows</Button>
          <span v-if="cleared" class="text-xs text-success">Cleared.</span>
        </div>
      </section>

      <p class="text-center text-xs text-fg-subtle">FloMorphic v0.1.0 · part of the Inflowenger platform</p>
    </div>
  </PageShell>
</template>
