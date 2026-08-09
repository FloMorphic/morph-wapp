<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import PageShell from '@/components/ui/PageShell.vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import { useUiStore, type ThemePreference } from '@/stores/ui'
import { flowsApi } from '@/api/flows'
import { nodeRegistryApi } from '@/api/nodeRegistry'
import type { PluginCredResponse } from '@/types/api'
import { APP_VERSION } from '@/version'

const ui = useUiStore()
const remote = flowsApi.isRemote()
const apiBase = import.meta.env.VITE_API_BASE_URL || ''
const appVersion = APP_VERSION

// --- MultiPlugin (open) credential ----------------------------------------
// Mint an open, multi-access runtime credential: not scoped to a single
// plugin's inflowv1 subjects like the per-node "strict" credential, but an
// open account credential usable by any plugin. Only a name is required.
const credForm = ref({ name: '' })
const credLoading = ref(false)
const credError = ref<string | null>(null)
const credResult = ref<PluginCredResponse | null>(null)
const credCopied = ref<'cred' | 'env' | null>(null)

async function generateMultiCred() {
  const name = credForm.value.name.trim()
  if (!name) {
    credError.value = 'Name is required.'
    return
  }
  credLoading.value = true
  credError.value = null
  try {
    credResult.value = await nodeRegistryApi.pluginCred({
      name,
      access: 'multi',
    })
  } catch (err) {
    credError.value = (err as Error).message
    credResult.value = null
  } finally {
    credLoading.value = false
  }
}

async function copyCred(which: 'cred' | 'env') {
  if (!credResult.value) return
  await navigator.clipboard.writeText(credResult.value[which])
  credCopied.value = which
  setTimeout(() => (credCopied.value = null), 1200)
}

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
              <Icon name="plugin" :size="16" />
            </span>
            <span class="text-sm font-medium text-fg">Manage builtin &amp; extension nodes</span>
          </div>
          <Icon name="chevron-right" :size="18" class="text-fg-subtle" />
        </RouterLink>
      </section>

      <!-- MultiPlugin credential -->
      <section class="card p-5">
        <div class="flex items-center gap-2">
          <h2 class="text-sm font-semibold text-fg">MultiPlugin Credential</h2>
          <span class="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">open</span>
        </div>
        <p class="mb-4 mt-1 text-[13px] text-fg-muted">
          Mint an open, multi-access runtime credential usable by any plugin — unlike the per-node
          <span class="font-medium">strict</span> credential that is scoped to a single plugin's inflowv1 subjects.
          Only a name is required; the minted cred is not bound to any plugin.
        </p>

        <div v-if="!remote" class="rounded-lg border bg-surface-2 px-4 py-3 text-[13px] text-fg-muted">
          Connect a backend to mint credentials.
        </div>

        <template v-else>
          <label class="block max-w-sm">
            <span class="mb-1 block text-xs font-medium text-fg-muted">Name</span>
            <input v-model="credForm.name" class="input" placeholder="e.g. my-open-cred" @keyup.enter="generateMultiCred" />
          </label>

          <div class="mt-3 flex items-center gap-3">
            <Button icon="key" variant="primary" :disabled="credLoading" @click="generateMultiCred">
              {{ credLoading ? 'Requesting…' : 'Generate credential' }}
            </Button>
            <span v-if="credError" class="text-xs text-danger">{{ credError }}</span>
          </div>

          <div v-if="credResult" class="mt-4 space-y-2 rounded-lg border p-3" style="border-color: var(--line-strong)">
            <div class="flex items-center justify-between gap-2">
              <span class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Credential</span>
              <button class="flex items-center gap-1 text-[12px] text-accent hover:underline" @click="copyCred('cred')">
                <Icon :name="credCopied === 'cred' ? 'check' : 'copy'" :size="12" />
                {{ credCopied === 'cred' ? 'Copied' : 'Copy' }}
              </button>
            </div>
            <p class="max-h-24 overflow-y-auto break-all font-mono text-[11px] text-fg-muted">{{ credResult.cred }}</p>

            <div class="flex items-center justify-between gap-2 border-t pt-2">
              <span class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Env</span>
              <button class="flex items-center gap-1 text-[12px] text-accent hover:underline" @click="copyCred('env')">
                <Icon :name="credCopied === 'env' ? 'check' : 'copy'" :size="12" />
                {{ credCopied === 'env' ? 'Copied' : 'Copy' }}
              </button>
            </div>
            <pre class="max-h-32 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] text-fg-muted">{{ credResult.env }}</pre>
          </div>
        </template>
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

      <p class="text-center text-xs text-fg-subtle">FloMorphic {{ appVersion }} · part of the Inflowenger platform</p>
    </div>
  </PageShell>
</template>
