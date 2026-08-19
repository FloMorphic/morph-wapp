<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import PageShell from '@/components/ui/PageShell.vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import { useUiStore, type ThemePreference } from '@/stores/ui'
import { flowsApi } from '@/api/flows'
import { nodeRegistryApi } from '@/api/nodeRegistry'
import { resourcesApi } from '@/api/resources'
import type { InflowResourcePool, PluginCredResponse } from '@/types/api'
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

// --- Engine resources (inflow dispatch pool) -------------------------------
// The engine instances a workflow run can be dispatched to. The pool is runtime
// state owned by the inflow-fusion SDK on the backend, so this panel only works
// with a backend connected. Pinning one resource ("use just this one") routes
// every dispatch to it and skips the round-robin.
const pool = ref<InflowResourcePool | null>(null)
const poolLoading = ref(false)
const poolError = ref<string | null>(null)
// resourceBusy holds the url of the row whose pin/unpin is in flight, or a
// sentinel while add/reload runs, so only the acting control shows a spinner.
const resourceBusy = ref<string | null>(null)
const addForm = ref({ name: '', url: '', token: '', pin: false })

async function loadPool() {
  if (!remote) return
  poolLoading.value = true
  poolError.value = null
  try {
    pool.value = await resourcesApi.list()
  } catch (err) {
    poolError.value = (err as Error).message
  } finally {
    poolLoading.value = false
  }
}

async function runResourceAction(busyKey: string, action: () => Promise<InflowResourcePool>) {
  resourceBusy.value = busyKey
  poolError.value = null
  try {
    pool.value = await action()
  } catch (err) {
    poolError.value = (err as Error).message
  } finally {
    resourceBusy.value = null
  }
}

async function addResource() {
  const url = addForm.value.url.trim()
  if (!url) {
    poolError.value = 'Resource URL is required.'
    return
  }
  await runResourceAction('__add__', () =>
    resourcesApi.add({
      name: addForm.value.name.trim() || undefined,
      url,
      token: addForm.value.token.trim() || undefined,
      pin: addForm.value.pin,
    }),
  )
  if (!poolError.value) addForm.value = { name: '', url: '', token: '', pin: false }
}

const pinResource = (r: { name: string; url: string }) =>
  runResourceAction(r.url, () => resourcesApi.pin(r.name || r.url))
const unpinResource = (url: string) => runResourceAction(url, () => resourcesApi.unpin())
const reloadPool = () => runResourceAction('__reload__', () => resourcesApi.reload())

onMounted(loadPool)

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
          FloMorphic talks to the Inflowenger <code class="font-mono text-xs text-accent">flomorphic-api</code>.
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

      <!-- Engine resources (inflow dispatch pool) -->
      <section class="card p-5">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <h2 class="text-sm font-semibold text-fg">Engine resources</h2>
            <span
              v-if="pool"
              class="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              :style="pool.pinned
                ? { background: 'var(--accent-soft)', color: 'var(--accent)' }
                : { background: 'var(--surface-2)', color: 'var(--fg-muted)' }"
            >
              {{ pool.pinned ? 'Pinned' : 'Round-robin' }}
            </span>
          </div>
          <button
            v-if="remote"
            class="flex items-center gap-1 text-[12px] text-fg-muted transition-colors hover:text-fg disabled:opacity-50"
            :disabled="!!resourceBusy || poolLoading"
            title="Re-read the pool from infra"
            @click="reloadPool"
          >
            <Icon name="refresh" :size="13" :class="{ 'animate-spin': resourceBusy === '__reload__' }" />
            Reload
          </button>
        </div>
        <p class="mb-4 mt-1 text-[13px] text-fg-muted">
          The engine instances a workflow run is dispatched to. Dispatch round-robins across the pool;
          <span class="font-medium">pin</span> one to send every run to just that resource.
        </p>

        <div v-if="!remote" class="rounded-lg border bg-surface-2 px-4 py-3 text-[13px] text-fg-muted">
          Connect a backend to manage engine resources.
        </div>

        <template v-else>
          <div v-if="poolLoading && !pool" class="rounded-lg border bg-surface-2 px-4 py-3 text-[13px] text-fg-muted">
            Loading resources…
          </div>

          <div
            v-else-if="pool && pool.list.length === 0"
            class="rounded-lg border bg-surface-2 px-4 py-3 text-[13px] text-fg-muted"
          >
            No live engine resources. Add one below or reload from infra.
          </div>

          <ul v-else-if="pool" class="space-y-2">
            <li
              v-for="r in pool.list"
              :key="r.url"
              class="flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5"
              :style="r.pinned ? { borderColor: 'var(--accent-border)', background: 'var(--accent-soft)' } : {}"
            >
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <span class="truncate text-sm font-medium text-fg">{{ r.name || r.url }}</span>
                  <span
                    v-if="r.pinned"
                    class="flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
                  >
                    <Icon name="zap" :size="10" /> In use
                  </span>
                </div>
                <p class="truncate font-mono text-[11px] text-fg-muted">{{ r.url }}</p>
              </div>
              <button
                v-if="r.pinned"
                class="shrink-0 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium text-fg-muted transition-colors hover:text-fg disabled:opacity-50"
                :disabled="!!resourceBusy"
                @click="unpinResource(r.url)"
              >
                {{ resourceBusy === r.url ? 'Unpinning…' : 'Unpin' }}
              </button>
              <button
                v-else
                class="flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium text-accent transition-colors hover:border-accent-border disabled:opacity-50"
                :disabled="!!resourceBusy"
                @click="pinResource(r)"
              >
                <Icon name="zap" :size="12" />
                {{ resourceBusy === r.url ? 'Pinning…' : 'Use just this' }}
              </button>
            </li>
          </ul>

          <!-- Add a resource by hand -->
          <div class="mt-4 space-y-2 rounded-lg border p-3" style="border-color: var(--line-strong)">
            <p class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Add a resource</p>
            <div class="grid gap-2 sm:grid-cols-2">
              <input v-model="addForm.name" class="input" placeholder="Name (optional)" />
              <input v-model="addForm.url" class="input" placeholder="URL — e.g. http://engine-host:3002" @keyup.enter="addResource" />
            </div>
            <input v-model="addForm.token" class="input" placeholder="Bearer token (optional — blank uses the infra bearer)" />
            <div class="flex items-center justify-between gap-3 pt-1">
              <label class="flex cursor-pointer items-center gap-2 text-[13px] text-fg-muted">
                <input v-model="addForm.pin" type="checkbox" class="h-3.5 w-3.5" />
                Use just this one (pin all dispatch to it)
              </label>
              <Button icon="plus" variant="primary" :disabled="resourceBusy === '__add__'" @click="addResource">
                {{ resourceBusy === '__add__' ? 'Adding…' : 'Add resource' }}
              </Button>
            </div>
          </div>

          <p v-if="poolError" class="mt-3 text-xs text-danger">{{ poolError }}</p>
        </template>
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
