<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { connectApi, ocUnwrap } from '@/api/connect'

/**
 * Apps panel: merges the gateway catalog with the connection list.
 *  - Catalog (GET /v1/providers or /api/providers): displayName, iconUrl,
 *    categories, authTypes — the ~1400 connectable apps.
 *  - Connections (GET /v1/connections or /api/connections): which apps are
 *    connected + the account label (e.g. the Gmail address).
 *
 * By default it shows the CONNECTED apps (small, relevant); the search box spans
 * the whole catalog so any app can be found. In admin mode (self-host + admin
 * token) OAuth apps can be connected in-app; otherwise connecting happens in the
 * oomol console. Payloads are parsed defensively — field names vary by build.
 */
const props = defineProps<{ connectionId?: string; hasRuntime: boolean; hasAdmin: boolean }>()

interface AppItem {
  id: string
  name: string
  icon?: string
  category?: string
  authType?: string
  oauth: boolean
}

interface ConnInfo {
  account?: string
  status?: string
  // A no-auth public provider (arXiv, PubMed, …) — always available, not an
  // account the user linked. Distinguished from a real "Connected" account.
  public: boolean
}

const catalog = ref<Map<string, AppItem>>(new Map())
const connMap = ref<Map<string, ConnInfo>>(new Map())
const summary = ref<Record<string, number> | null>(null)
const mode = ref<'admin' | 'runtime'>('runtime')
const canConnect = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const search = ref('')
const acting = ref<Record<string, string>>({})
let pollTimer: ReturnType<typeof setInterval> | null = null

const ready = computed(() => props.hasRuntime || props.hasAdmin)

/* ---- defensive parsing ---- */
function asArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object') {
    const o = payload as Record<string, unknown>
    for (const key of ['data', 'providers', 'apps', 'services', 'connections', 'list', 'items', 'results']) {
      if (Array.isArray(o[key])) return o[key] as unknown[]
    }
  }
  return []
}
function pick(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  return undefined
}
function titleize(slug: string): string {
  return slug.replace(/^no_auth:/, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim()
}
function authTypesOf(o: Record<string, unknown>): string[] {
  const t = o['authTypes'] ?? o['auth_types'] ?? o['authType'] ?? o['authMethods']
  if (Array.isArray(t)) return t.map(String)
  if (typeof t === 'string' && t) return [t]
  return []
}

function toCatalogEntry(raw: unknown): AppItem | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const service = pick(o, ['service', 'provider', 'slug', 'id', 'key', 'name'])
  if (!service) return null
  const auth = authTypesOf(o)
  const cats = o['categories']
  const category = Array.isArray(cats)
    ? cats.map((c) => (c && typeof c === 'object' ? pick(c as Record<string, unknown>, ['displayName', 'name', 'id']) : String(c))).filter(Boolean)[0]
    : undefined
  return {
    id: service,
    name: pick(o, ['displayName', 'display_name', 'title', 'label']) || titleize(service),
    icon: pick(o, ['iconUrl', 'icon_url', 'icon', 'logoUrl', 'logo_url', 'logo', 'image']),
    category,
    authType: auth.join(', ') || undefined,
    oauth: auth.some((a) => /oauth/i.test(a)),
  }
}

function parseConnections(payload: unknown): Map<string, ConnInfo> {
  const m = new Map<string, ConnInfo>()
  for (const raw of asArray(payload)) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const service = pick(o, ['service', 'provider', 'slug', 'name'])
    if (!service) continue
    const status = pick(o, ['status', 'state'])
    if (status && !/connect|active|ready|ok|linked|authoriz/i.test(status)) continue
    const auth = authTypesOf(o)
    const id = pick(o, ['id']) ?? ''
    const isPublic = auth.some((a) => /no[_ ]?auth/i.test(a)) || /^no_auth:/.test(id)
    m.set(service, { account: pick(o, ['accountLabel', 'account_label', 'account']), status, public: isPublic })
  }
  return m
}

/* ---- loading ---- */
async function load() {
  if (!ready.value) return
  loading.value = true
  error.value = null
  try {
    mode.value = props.hasAdmin ? 'admin' : 'runtime'
    canConnect.value = props.hasAdmin
    const providersPath = props.hasAdmin ? '/api/providers' : '/v1/providers'
    const connectionsPath = props.hasAdmin ? '/api/connections' : '/v1/connections'

    const [provRaw, connRaw] = await Promise.all([
      connectApi.gatewayGet(providersPath, props.connectionId).catch((e) => { throw e }),
      connectApi.gatewayGet(connectionsPath, props.connectionId).catch(() => null),
    ])

    const cat = new Map<string, AppItem>()
    for (const raw of asArray(ocUnwrap(provRaw))) {
      const e = toCatalogEntry(raw)
      if (e) cat.set(e.id, e)
    }
    catalog.value = cat
    connMap.value = parseConnections(connRaw ? ocUnwrap(connRaw) : [])
    const meta = (connRaw as { meta?: { summary?: Record<string, number> } } | null)?.meta
    summary.value = meta?.summary ?? null
  } catch (err) {
    error.value = (err as Error).message
    catalog.value = new Map()
    connMap.value = new Map()
  } finally {
    loading.value = false
  }
}

async function refreshConnections() {
  try {
    const path = props.hasAdmin ? '/api/connections' : '/v1/connections'
    const raw = await connectApi.gatewayGet(path, props.connectionId)
    connMap.value = parseConnections(ocUnwrap(raw))
  } catch {
    /* keep last known */
  }
}

onMounted(load)
watch(() => [props.connectionId, props.hasRuntime, props.hasAdmin], load)
onBeforeUnmount(() => pollTimer && clearInterval(pollTimer))

/* ---- derived views ---- */
// Every known app: the catalog, plus any connected service not in it.
const allApps = computed<AppItem[]>(() => {
  const m = new Map(catalog.value)
  for (const svc of connMap.value.keys()) {
    if (!m.has(svc)) m.set(svc, { id: svc, name: titleize(svc), oauth: false })
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
})
const isConnected = (id: string) => connMap.value.has(id)
const isPublic = (id: string) => connMap.value.get(id)?.public === true
const isLinked = (id: string) => isConnected(id) && !isPublic(id) // a real account you authorized
// Default view = your active connections (linked accounts first, then publics);
// searching spans the whole catalog (capped).
const activeApps = computed(() => {
  const rank = (a: AppItem) => (isLinked(a.id) ? 0 : isPublic(a.id) ? 1 : 2)
  return allApps.value.filter((a) => isConnected(a.id)).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
})
const linkedCount = computed(() => [...connMap.value.keys()].filter((id) => !isPublic(id)).length)
const publicCount = computed(() => [...connMap.value.keys()].filter((id) => isPublic(id)).length)
const visible = computed<AppItem[]>(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return activeApps.value
  return allApps.value
    .filter((a) => a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q) || (a.category ?? '').toLowerCase().includes(q))
    .slice(0, 80)
})
const totalAvailable = computed(() => summary.value?.connectableProviderCount ?? catalog.value.size)
const accountOf = (id: string) => connMap.value.get(id)?.account

/* ---- connect flow ---- */
async function connectApp(app: AppItem) {
  if (!canConnect.value || !app.oauth) {
    window.open('https://console.oomol.com/connections', '_blank', 'noopener')
    startPolling(app.id)
    return
  }
  acting.value = { ...acting.value, [app.id]: 'connecting' }
  try {
    const env = await connectApi.startOAuth(app.id, props.connectionId)
    const data = ocUnwrap(env) as Record<string, unknown>
    const url = pick(data, ['authorizationUrl', 'authorization_url', 'url', 'redirectUrl', 'redirect_url'])
    if (!url) {
      acting.value = { ...acting.value, [app.id]: 'No authorization URL returned.' }
      return
    }
    window.open(url, '_blank', 'noopener')
    startPolling(app.id)
  } catch (err) {
    acting.value = { ...acting.value, [app.id]: (err as Error).message }
  }
}
function startPolling(appId: string) {
  acting.value = { ...acting.value, [appId]: 'connecting' }
  if (pollTimer) clearInterval(pollTimer)
  let ticks = 0
  pollTimer = setInterval(async () => {
    ticks++
    await refreshConnections()
    if (isConnected(appId) || ticks > 48) {
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = null
      const next = { ...acting.value }
      delete next[appId]
      acting.value = next
    }
  }, 2500)
}

</script>

<template>
  <section class="card p-5">
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <h2 class="text-sm font-semibold text-fg">Apps</h2>
        <span v-if="allApps.length" class="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-fg-muted">
          {{ linkedCount }} connected<template v-if="publicCount"> · {{ publicCount }} public</template> · {{ totalAvailable.toLocaleString() }} available
        </span>
      </div>
      <button
        class="flex items-center gap-1 text-[12px] text-fg-muted transition-colors hover:text-fg disabled:opacity-50"
        :disabled="loading || !ready"
        @click="load"
      >
        <Icon name="refresh" :size="13" :class="{ 'animate-spin': loading }" /> Refresh
      </button>
    </div>
    <p class="mb-4 mt-1 text-[13px] text-fg-muted">
      <span class="font-medium text-fg">Connected</span> apps are accounts you authorized;
      <span class="font-medium text-fg">Public</span> ones (arXiv, PubMed, …) need no login and are always available.
      Search to explore all {{ totalAvailable.toLocaleString() }} apps the gateway can reach.
      <template v-if="mode === 'runtime'">
        Connect a new app in the
        <a href="https://console.oomol.com/connections" target="_blank" rel="noopener" class="text-accent hover:underline">oomol console</a>,
        then Refresh.
      </template>
    </p>

    <div v-if="!ready" class="rounded-lg border bg-surface-2 px-4 py-3 text-[13px] text-fg-muted">
      Add a connection with a token above to see apps.
    </div>

    <template v-else>
      <div v-if="loading && !allApps.length" class="rounded-lg border bg-surface-2 px-4 py-3 text-[13px] text-fg-muted">Loading apps…</div>

      <div v-else-if="error" class="rounded-lg border px-4 py-3 text-[13px]" style="border-color: var(--line-strong)">
        <p class="text-danger">Could not load apps: {{ error }}</p>
        <p class="mt-1 text-fg-muted">Check the token and base URL, or manage connections in the
          <a href="https://console.oomol.com/connections" target="_blank" rel="noopener" class="text-accent hover:underline">oomol console</a>.
        </p>
      </div>

      <template v-else>
        <label class="mb-3 block">
          <input v-model="search" class="input" :placeholder="`Search all ${totalAvailable.toLocaleString()} apps…`" />
        </label>

        <div v-if="!visible.length" class="rounded-lg border bg-surface-2 px-4 py-3 text-[13px] text-fg-muted">
          <template v-if="search.trim()">No apps match “{{ search.trim() }}”.</template>
          <template v-else>
            No apps connected yet. Connect one (e.g. Gmail) in the
            <a href="https://console.oomol.com/connections" target="_blank" rel="noopener" class="text-accent hover:underline">oomol console</a>
            and make sure this token is granted access, then Refresh — or search above to browse the full catalog.
          </template>
        </div>

        <ul v-else class="grid gap-2 sm:grid-cols-2">
          <li
            v-for="app in visible"
            :key="app.id"
            class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
            :style="isLinked(app.id) ? { borderColor: 'var(--accent-border)', background: 'var(--accent-soft)' } : {}"
          >
            <div class="flex min-w-0 items-center gap-2.5">
              <img v-if="app.icon" :src="app.icon" :alt="app.name" class="h-7 w-7 shrink-0 rounded object-contain" @error="($event.target as HTMLImageElement).style.display = 'none'" />
              <span v-else class="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-surface-2 text-[11px] font-semibold uppercase text-fg-muted">{{ app.name.slice(0, 2) }}</span>
              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-fg">{{ app.name }}</p>
                <p class="truncate text-[11px] text-fg-subtle">
                  <span v-if="isLinked(app.id) && accountOf(app.id)">{{ accountOf(app.id) }}</span>
                  <span v-else-if="isPublic(app.id)">No login required</span>
                  <span v-else-if="app.category">{{ app.category }}</span>
                  <span v-else-if="app.authType">{{ app.authType }}</span>
                </p>
              </div>
            </div>

            <span v-if="isLinked(app.id)" class="flex shrink-0 items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              <Icon name="check" :size="10" /> Connected
            </span>
            <span v-else-if="isPublic(app.id)" class="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
              Public
            </span>
            <button
              v-else
              class="flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium text-accent transition-colors hover:border-accent-border disabled:opacity-50"
              :disabled="acting[app.id] === 'connecting'"
              @click="connectApp(app)"
            >
              <Icon :name="acting[app.id] === 'connecting' ? 'refresh' : 'external-link'" :size="12" :class="{ 'animate-spin': acting[app.id] === 'connecting' }" />
              {{ acting[app.id] === 'connecting' ? 'Waiting…' : 'Connect' }}
            </button>
          </li>
        </ul>
        <p v-if="Object.values(acting).some((v) => v && v !== 'connecting')" class="mt-2 text-[12px] text-danger">
          {{ Object.values(acting).find((v) => v && v !== 'connecting') }}
        </p>
      </template>
    </template>
  </section>
</template>
