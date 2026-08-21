<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import PageShell from '@/components/ui/PageShell.vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import { connectApi } from '@/api/connect'
import ProvidersPanel from '@/components/connect/ProvidersPanel.vue'
import type { ConnectConnection } from '@/types/api'

// The hosted API host is connector.oomol.com — the console at console.oomol.com
// only serves the web UI and would 404 the /v1 and /api calls.
const HOSTED_BASE = 'https://connector.oomol.com'
const CONSOLE_URL = 'https://console.oomol.com'

const remote = connectApi.isRemote()

// --- Connections ------------------------------------------------------------
const connections = ref<ConnectConnection[]>([])
const listLoading = ref(false)
const listError = ref<string | null>(null)
// busy holds the id of the row whose action is in flight (or a sentinel).
const busy = ref<string | null>(null)
// probe results keyed by connection id: 'ok' | error string | 'testing'.
const probe = ref<Record<string, string>>({})

async function loadConnections() {
  if (!remote) return
  listLoading.value = true
  listError.value = null
  try {
    connections.value = await connectApi.list()
  } catch (err) {
    listError.value = (err as Error).message
  } finally {
    listLoading.value = false
  }
}

onMounted(loadConnections)

// The connection the Apps panel runs against. Prefer the default; prefer one
// with an admin token (enables the full catalog + in-app connect) over a
// runtime-only one (which still lists connected apps via /v1).
const activeConnection = computed(
  () =>
    connections.value.find((c) => c.isDefault && (c.tokenSet || c.adminTokenSet)) ??
    connections.value.find((c) => c.adminTokenSet) ??
    connections.value.find((c) => c.tokenSet),
)

// --- Add / edit form --------------------------------------------------------
type FormState = { id: string; label: string; kind: string; baseUrl: string; token: string; adminToken: string }
const blankForm = (): FormState => ({ id: '', label: '', kind: 'hosted', baseUrl: HOSTED_BASE, token: '', adminToken: '' })
const form = ref<FormState>(blankForm())
const formOpen = ref(false)
const saving = ref(false)
const formError = ref<string | null>(null)
const inlineProbe = ref<string | null>(null)

const editing = computed(() => form.value.id !== '')

function openAdd() {
  form.value = blankForm()
  formOpen.value = true
  formError.value = null
  inlineProbe.value = null
}

function openEdit(c: ConnectConnection) {
  form.value = { id: c.id, label: c.label, kind: c.kind || 'hosted', baseUrl: c.baseUrl, token: '', adminToken: '' }
  formOpen.value = true
  formError.value = null
  inlineProbe.value = null
}

// The admin token only applies to a self-hosted gateway (the operator's
// OOMOL_CONNECT_ADMIN_TOKEN); hosted oomol protects /api with the account
// session, so the field is hidden there.
const showAdminToken = computed(() => form.value.kind === 'selfhosted')

// The web console host is a common wrong value — its /v1 and /api calls 404.
const usesConsoleHost = computed(() => /console\.oomol\.com/i.test(form.value.baseUrl))

function onKindChange() {
  // Hosted always points at the oomol console; self-hosted starts blank so the
  // user fills in their own gateway origin.
  if (form.value.kind === 'hosted' && (!form.value.baseUrl || form.value.baseUrl === '')) {
    form.value.baseUrl = HOSTED_BASE
  }
  if (form.value.kind === 'hosted' && form.value.baseUrl.trim() === '') form.value.baseUrl = HOSTED_BASE
}

async function testForm() {
  const token = form.value.token.trim()
  if (!token && !editing.value) {
    inlineProbe.value = 'Enter a token to test.'
    return
  }
  inlineProbe.value = 'testing'
  try {
    const adminToken = form.value.adminToken.trim()
    // For an edit with no new token, probe the stored connection instead.
    const res = token || adminToken
      ? await connectApi.testInline(form.value.baseUrl.trim() || HOSTED_BASE, token, adminToken || undefined)
      : await connectApi.testStored(form.value.id)
    inlineProbe.value = res.ok ? 'ok' : 'The gateway did not confirm the token.'
  } catch (err) {
    inlineProbe.value = (err as Error).message
  }
}

async function saveForm() {
  formError.value = null
  const label = form.value.label.trim()
  const token = form.value.token.trim()
  if (!editing.value && !token) {
    formError.value = 'An access token is required to create a connection.'
    return
  }
  saving.value = true
  try {
    const payload: Partial<ConnectConnection> = {
      id: form.value.id || undefined,
      label: label || undefined,
      kind: form.value.kind,
      baseUrl: form.value.baseUrl.trim() || HOSTED_BASE,
    }
    // Only send a token when the user typed one (empty keeps the stored value).
    if (token) payload.token = token
    // Admin token applies to self-hosted only; send it only when typed.
    if (form.value.kind === 'selfhosted') {
      const admin = form.value.adminToken.trim()
      if (admin) payload.adminToken = admin
    }
    await connectApi.save(payload)
    formOpen.value = false
    await loadConnections()
  } catch (err) {
    formError.value = (err as Error).message
  } finally {
    saving.value = false
  }
}

async function makeDefault(c: ConnectConnection) {
  busy.value = c.id
  try {
    await connectApi.setDefault(c.id)
    await loadConnections()
  } catch (err) {
    listError.value = (err as Error).message
  } finally {
    busy.value = null
  }
}

async function testStored(c: ConnectConnection) {
  probe.value = { ...probe.value, [c.id]: 'testing' }
  try {
    const res = await connectApi.testStored(c.id)
    probe.value = { ...probe.value, [c.id]: res.ok ? 'ok' : 'no confirm' }
  } catch (err) {
    probe.value = { ...probe.value, [c.id]: (err as Error).message }
  }
}

async function removeConnection(c: ConnectConnection) {
  if (!window.confirm(`Delete the "${c.label}" connection? Plugins using it will lose access.`)) return
  busy.value = c.id
  try {
    await connectApi.remove(c.id)
    await loadConnections()
  } catch (err) {
    listError.value = (err as Error).message
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <PageShell
    title="Connect"
    subtitle="One gateway for every external service. FloMorphic reaches 1,000+ SaaS providers through OpenConnector — it holds the OAuth handshakes, token refresh and API keys so your workflows and plugins never touch a provider credential."
  >
    <div class="max-w-3xl space-y-6">
      <!-- No backend guard -->
      <section v-if="!remote" class="card p-5">
        <div class="flex items-center gap-2.5">
          <Icon name="alert-triangle" :size="18" class="text-fg-muted" />
          <h2 class="text-sm font-semibold text-fg">A backend is required</h2>
        </div>
        <p class="mt-1 text-[13px] text-fg-muted">
          Connect stores the gateway token on the FloMorphic backend so plugins can use it. Set
          <code class="font-mono text-xs">VITE_API_BASE_URL</code> to a running
          <code class="font-mono text-xs text-accent">flomorphic-api</code> and reload.
        </p>
      </section>

      <template v-else>
        <!-- Onboarding guidance -->
        <section class="card p-5">
          <div class="flex items-center gap-2">
            <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <Icon name="connect" :size="16" />
            </span>
            <h2 class="text-sm font-semibold text-fg">Set up oomol OpenConnector</h2>
            <span class="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
              20k free / month
            </span>
          </div>
          <p class="mb-4 mt-2 text-[13px] text-fg-muted">
            oomol hosts OpenConnector in the cloud with a free tier of 20,000 calls per month. Create an account, mint an
            access token, and paste it below — FloMorphic stores it and routes every external call through it. Prefer to
            keep everything on-prem? Point a connection at a self-hosted OpenConnector instead.
          </p>

          <ol class="space-y-3">
            <li class="flex gap-3">
              <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-fg-muted">1</span>
              <div class="text-[13px] text-fg">
                Create a free account at
                <a href="https://console.oomol.com" target="_blank" rel="noopener" class="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                  console.oomol.com <Icon name="external-link" :size="12" />
                </a>
                <span class="text-fg-muted"> — the free plan covers 20,000 gateway calls each month.</span>
              </div>
            </li>
            <li class="flex gap-3">
              <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-fg-muted">2</span>
              <div class="text-[13px] text-fg">
                In the console open the <span class="font-medium">Access</span> tab and create an
                <span class="font-medium">access token</span> — an
                <code class="font-mono text-xs text-accent">api-…</code> key or an
                <code class="font-mono text-xs text-accent">oct_…</code> runtime token.
                <span class="text-fg-muted"> Copy it now — oomol shows it only once.</span>
              </div>
            </li>
            <li class="flex gap-3">
              <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-fg-muted">3</span>
              <div class="text-[13px] text-fg">
                Paste the token below and save. Use base URL
                <code class="font-mono text-xs">{{ HOSTED_BASE }}</code> for the hosted service.
              </div>
            </li>
            <li class="flex gap-3">
              <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-fg-muted">4</span>
              <div class="text-[13px] text-fg">
                Connect the providers you need (GitHub, Gmail, Notion, …) from the oomol console — approve each OAuth screen
                or add an API key there. <span class="text-fg-muted">Your workflows then call them through this gateway.</span>
              </div>
            </li>
          </ol>
        </section>

        <!-- Connections -->
        <section class="card p-5">
          <div class="flex items-center justify-between gap-2">
            <h2 class="text-sm font-semibold text-fg">Gateway connections</h2>
            <Button v-if="!formOpen" icon="plus" variant="primary" @click="openAdd">Add connection</Button>
          </div>
          <p class="mb-4 mt-1 text-[13px] text-fg-muted">
            The OpenConnector endpoints FloMorphic proxies through. The <span class="font-medium">default</span> is used
            when a caller does not name one.
          </p>

          <!-- Add / edit form -->
          <div v-if="formOpen" class="mb-4 space-y-3 rounded-lg border p-4" style="border-color: var(--line-strong)">
            <div class="flex items-center justify-between">
              <p class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
                {{ editing ? 'Edit connection' : 'New connection' }}
              </p>
              <button class="text-fg-subtle hover:text-fg" title="Close" @click="formOpen = false">
                <Icon name="x" :size="16" />
              </button>
            </div>

            <div class="grid gap-3 sm:grid-cols-2">
              <label class="block">
                <span class="mb-1 block text-xs font-medium text-fg-muted">Label</span>
                <input v-model="form.label" class="input" placeholder="e.g. oomol (production)" />
              </label>
              <label class="block">
                <span class="mb-1 block text-xs font-medium text-fg-muted">Type</span>
                <select v-model="form.kind" class="input" @change="onKindChange">
                  <option value="hosted">Hosted (oomol cloud)</option>
                  <option value="selfhosted">Self-hosted OpenConnector</option>
                </select>
              </label>
            </div>

            <label class="block">
              <span class="mb-1 block text-xs font-medium text-fg-muted">Base URL</span>
              <input v-model="form.baseUrl" class="input" :placeholder="HOSTED_BASE" />
              <span v-if="usesConsoleHost" class="mt-1 flex items-start gap-1 text-[11px] text-danger">
                <Icon name="alert-triangle" :size="12" class="mt-0.5 shrink-0" />
                <span>
                  <code class="font-mono">console.oomol.com</code> is the web UI, not the API — its calls return nothing.
                  Use <code class="font-mono">{{ HOSTED_BASE }}</code>.
                  <button type="button" class="font-medium text-accent hover:underline" @click="form.baseUrl = HOSTED_BASE">Fix it</button>
                </span>
              </span>
            </label>

            <label class="block">
              <span class="mb-1 block text-xs font-medium text-fg-muted">
                Access token
                <span v-if="editing" class="font-normal text-fg-subtle">— leave blank to keep the stored token</span>
              </span>
              <input v-model="form.token" type="password" class="input" placeholder="api-… or oct_…" autocomplete="off" />
              <span class="mt-1 block text-[11px] text-fg-subtle">The <code class="font-mono">api-…</code> key or <code class="font-mono">oct_…</code> runtime token from the console. Runs actions (the gateway's <code class="font-mono">/v1</code> surface).</span>
            </label>

            <label v-if="showAdminToken" class="block">
              <span class="mb-1 block text-xs font-medium text-fg-muted">
                Admin token
                <span v-if="editing" class="font-normal text-fg-subtle">— leave blank to keep the stored token</span>
              </span>
              <input v-model="form.adminToken" type="password" class="input" placeholder="your OOMOL_CONNECT_ADMIN_TOKEN" autocomplete="off" />
              <span class="mt-1 block text-[11px] text-fg-subtle">
                The value you set as <code class="font-mono">OOMOL_CONNECT_ADMIN_TOKEN</code> when deploying the gateway.
                Lets FloMorphic browse &amp; connect apps in-app (the <code class="font-mono">/api</code> surface). Not used by hosted oomol.
              </span>
            </label>

            <div class="flex flex-wrap items-center gap-3 pt-1">
              <Button icon="key" variant="primary" :disabled="saving" @click="saveForm">
                {{ saving ? 'Saving…' : editing ? 'Save changes' : 'Save connection' }}
              </Button>
              <Button icon="activity" :disabled="inlineProbe === 'testing'" @click="testForm">
                {{ inlineProbe === 'testing' ? 'Testing…' : 'Test' }}
              </Button>
              <span v-if="inlineProbe === 'ok'" class="flex items-center gap-1 text-xs text-success">
                <Icon name="check" :size="13" /> Gateway reachable
              </span>
              <span v-else-if="inlineProbe && inlineProbe !== 'testing'" class="text-xs text-danger">{{ inlineProbe }}</span>
            </div>
            <p v-if="formError" class="text-xs text-danger">{{ formError }}</p>
          </div>

          <!-- List -->
          <div v-if="listLoading && !connections.length" class="rounded-lg border bg-surface-2 px-4 py-3 text-[13px] text-fg-muted">
            Loading connections…
          </div>
          <div v-else-if="!connections.length" class="rounded-lg border bg-surface-2 px-4 py-3 text-[13px] text-fg-muted">
            No connections yet. Add one above to start reaching external services.
          </div>

          <ul v-else class="space-y-2">
            <li
              v-for="c in connections"
              :key="c.id"
              class="rounded-lg border px-4 py-3"
              :style="c.isDefault ? { borderColor: 'var(--accent-border)', background: 'var(--accent-soft)' } : {}"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="truncate text-sm font-medium text-fg">{{ c.label }}</span>
                    <span
                      v-if="c.isDefault"
                      class="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
                    >Default</span>
                    <span class="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-fg-muted">
                      {{ c.kind === 'selfhosted' ? 'Self-hosted' : 'Hosted' }}
                    </span>
                  </div>
                  <p class="mt-0.5 truncate font-mono text-[11px] text-fg-muted">{{ c.baseUrl }}</p>
                  <p class="mt-0.5 text-[11px] text-fg-subtle">
                    Runtime
                    <span v-if="c.tokenSet" class="font-mono">{{ c.tokenPreview }}</span>
                    <span v-else class="text-danger">not set</span>
                    <template v-if="c.kind === 'selfhosted'">
                      · Admin
                      <span v-if="c.adminTokenSet" class="font-mono">{{ c.adminTokenPreview }}</span>
                      <span v-else class="text-fg-subtle">not set</span>
                    </template>
                  </p>
                </div>
                <div class="flex shrink-0 items-center gap-1">
                  <button class="rounded-lg p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg" title="Edit" @click="openEdit(c)">
                    <Icon name="settings" :size="15" />
                  </button>
                  <button class="rounded-lg p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg" title="Test" @click="testStored(c)">
                    <Icon name="activity" :size="15" />
                  </button>
                  <button class="rounded-lg p-1.5 text-fg-muted hover:bg-surface-2 hover:text-danger" title="Delete" :disabled="busy === c.id" @click="removeConnection(c)">
                    <Icon name="trash" :size="15" />
                  </button>
                </div>
              </div>
              <div class="mt-2 flex items-center gap-3">
                <button
                  v-if="!c.isDefault"
                  class="text-[12px] font-medium text-accent hover:underline disabled:opacity-50"
                  :disabled="busy === c.id"
                  @click="makeDefault(c)"
                >
                  {{ busy === c.id ? 'Working…' : 'Make default' }}
                </button>
                <span v-if="probe[c.id] === 'ok'" class="flex items-center gap-1 text-[12px] text-success">
                  <Icon name="check" :size="12" /> Reachable
                </span>
                <span v-else-if="probe[c.id] === 'testing'" class="text-[12px] text-fg-muted">Testing…</span>
                <span v-else-if="probe[c.id]" class="text-[12px] text-danger">{{ probe[c.id] }}</span>
              </div>
            </li>
          </ul>

          <p v-if="listError" class="mt-3 text-xs text-danger">{{ listError }}</p>
        </section>

        <!-- Apps: connected apps (runtime) + full catalog & in-app connect (admin) -->
        <ProvidersPanel
          v-if="activeConnection"
          :connection-id="activeConnection.id"
          :has-runtime="!!activeConnection.tokenSet"
          :has-admin="!!activeConnection.adminTokenSet"
        />
      </template>
    </div>
  </PageShell>
</template>
