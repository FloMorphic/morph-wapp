<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { GraphNode } from '@vue-flow/core'
import Icon from '@/components/ui/Icon.vue'
import { triggersApi, type SaveTriggerInput } from '@/api/triggers'
import { flowsApi } from '@/api/flows'
import { apiBaseUrl } from '@/api/client'
import { contextsApi } from '@/api/contexts'
import { useNotificationsStore } from '@/stores/notifications'
import type {
  Trigger,
  TriggerKind,
  TriggerContextMode,
  ContextRecord,
  WebhookAuthMethod,
  WebhookTrigger,
  ScheduleTrigger,
} from '@/types/api'

/**
 * Start-node trigger manager: the inbound webhooks and recurring schedules that
 * launch this workflow. Triggers are first-class resources served under
 * `/trigger` — they are NOT stored on the node or in the flow graph. This
 * component only reads the flow id (route) and this node's id to know which
 * triggers to list and what to bind new ones to; it writes nothing back into
 * `node.data`. Secrets, the public URL, and delivery history live on the trigger
 * record, off the graph.
 */
const props = defineProps<{ node: GraphNode }>()

const route = useRoute()
const router = useRouter()
const notifications = useNotificationsStore()

// The flow being edited. Triggers bind to a saved flow, so an unsaved canvas
// (no route id) cannot attach one yet — the panel shows a hint instead.
const flowId = computed(() => String(route.params.id ?? ''))
const startNodeId = computed(() => String(props.node.id ?? ''))

const triggers = ref<Trigger[]>([])
const contexts = ref<ContextRecord[]>([])
const loading = ref(false)
const saving = ref(false)

// Context docs available to the `existing` picker — the 50 most-recently-updated
// (the list endpoint orders newest-first). Enough to pick from without loading a
// large store; best-effort, so a failure just leaves the picker empty.
async function loadContexts() {
  try {
    contexts.value = (await contextsApi.list({ per_page: 50 })).list
  } catch {
    contexts.value = []
  }
}
onMounted(loadContexts)

// Which webhooks have their delivery log expanded (independent toggles).
const openDeliveries = ref<Set<string>>(new Set())
function toggleDeliveries(id: string) {
  if (openDeliveries.value.has(id)) openDeliveries.value.delete(id)
  else openDeliveries.value.add(id)
}

/** The webhook's public URL, built from the API base the app actually talks to
 *  mixed with the slug — reliable even when the backend has no PUBLIC_API_URL set
 *  (its `url` would then be root-relative). Falls back to the app origin in local
 *  mode, then to whatever the backend returned. */
function webhookUrl(t: WebhookTrigger): string {
  const base = apiBaseUrl()
  if (base) return `${base}/hooks/${t.slug}`
  if (typeof window !== 'undefined' && window.location) return `${window.location.origin}/hooks/${t.slug}`
  return t.url ?? `/hooks/${t.slug}`
}

/** Colour a delivery by its HTTP status: 2xx accepted, 4xx rejected, 5xx error. */
function hitStatusClass(status: number): string {
  if (status >= 200 && status < 300) return 'text-success'
  if (status >= 400 && status < 500) return 'text-warning'
  return 'text-danger'
}

async function load() {
  if (!flowId.value) return
  loading.value = true
  try {
    triggers.value = await triggersApi.listForFlow(flowId.value)
  } catch (err) {
    notifications.notify({ level: 'error', message: `Load triggers: ${(err as Error).message}` })
  } finally {
    loading.value = false
  }
}

onMounted(load)

// One trigger per workflow — a webhook OR a schedule. Typed views narrow the
// union so the template can read kind-specific fields; wanting more than one
// trigger is served by cloning the workflow.
const trigger = computed<Trigger | null>(() => triggers.value[0] ?? null)
const webhookTrigger = computed<WebhookTrigger | null>(() =>
  trigger.value?.kind === 'webhook' ? trigger.value : null,
)
const scheduleTrigger = computed<ScheduleTrigger | null>(() =>
  trigger.value?.kind === 'schedule' ? trigger.value : null,
)

/** Clone the current workflow (graph only — triggers are per-flow, so the copy
 *  starts with none) and open the copy, ready for its own single trigger. */
async function cloneWorkflow() {
  if (!flowId.value) return
  try {
    const src = await flowsApi.get(flowId.value)
    const copy = await flowsApi.save({ title: `${src.title || 'Untitled'} (copy)`, view_flow: src.view_flow })
    notifications.notify({ level: 'success', message: 'Workflow cloned' })
    router.push({ name: 'workflow-edit', params: { id: copy.id } })
  } catch (err) {
    notifications.notify({ level: 'error', message: `Clone workflow: ${(err as Error).message}` })
  }
}

// ---- Draft editor ----------------------------------------------------------
// One reactive draft edits either a new or existing trigger. `secret` is always
// blank on open (the stored secret is write-only and never returned); leaving it
// blank on save keeps the existing one.
type ScheduleUnit = 'seconds' | 'minutes' | 'hours' | 'days'
const UNIT_SECONDS: Record<ScheduleUnit, number> = { seconds: 1, minutes: 60, hours: 3600, days: 86400 }

interface Draft {
  id?: string
  kind: TriggerKind
  title: string
  enabled: boolean
  // run context + settings (both kinds)
  contextMode: TriggerContextMode
  contextId: string
  contextTitle: string
  execTimeoutSec: number
  nodeLimit: number
  reqTimeoutSec: number
  // webhook
  slug: string
  methods: string[]
  authMethod: WebhookAuthMethod
  headerKey: string
  headerPattern: string
  hashAlgo: 'sha256' | 'sha384' | 'sha512'
  digest: 'base64' | 'hex'
  secret: string
  hasSecret: boolean
  whitelistIp: string
  url?: string
  // schedule
  mode: 'cron' | 'interval'
  cron: string
  intervalValue: number
  intervalUnit: ScheduleUnit
  timezone: string
}

const draft = ref<Draft | null>(null)

function blankDraft(kind: TriggerKind): Draft {
  return {
    kind,
    title: kind === 'webhook' ? 'New webhook' : 'New schedule',
    enabled: true,
    contextMode: 'new',
    contextId: '',
    contextTitle: '',
    execTimeoutSec: 0,
    nodeLimit: 0,
    reqTimeoutSec: 0,
    slug: '',
    methods: [],
    authMethod: 'none',
    headerKey: kind === 'webhook' ? 'Authorization' : '',
    headerPattern: '',
    hashAlgo: 'sha256',
    digest: 'hex',
    secret: '',
    hasSecret: false,
    whitelistIp: '',
    url: undefined,
    mode: 'cron',
    cron: '0 9 * * *',
    intervalValue: 1,
    intervalUnit: 'hours',
    timezone: '',
  }
}

/** Copy a trigger's shared run-context + settings fields into a draft. */
function draftContext(t: Trigger): Pick<Draft, 'contextMode' | 'contextId' | 'contextTitle' | 'execTimeoutSec' | 'nodeLimit' | 'reqTimeoutSec'> {
  return {
    contextMode: t.contextMode ?? 'new',
    contextId: t.contextId ?? '',
    contextTitle: t.contextTitle ?? '',
    execTimeoutSec: t.settings?.executeTimeoutSec ?? 0,
    nodeLimit: t.settings?.processNodeLimit ?? 0,
    reqTimeoutSec: t.settings?.requestTimeoutSec ?? 0,
  }
}

/** Split an interval in seconds back into the largest whole unit for editing. */
function splitInterval(sec: number): { value: number; unit: ScheduleUnit } {
  for (const unit of ['days', 'hours', 'minutes'] as ScheduleUnit[]) {
    const s = UNIT_SECONDS[unit]
    if (sec && sec % s === 0) return { value: sec / s, unit }
  }
  return { value: sec || 1, unit: 'seconds' }
}

async function editWebhook(t: WebhookTrigger) {
  showSecret.value = false
  // Fetch the single record so the stored secret is loaded into the field (the
  // list redacts it). It opens masked; the eye reveals it. Fall back to the list
  // record if the fetch fails.
  let full: WebhookTrigger = t
  try {
    const fetched = await triggersApi.get(t.id)
    if (fetched.kind === 'webhook') full = fetched
  } catch {
    /* keep the list record (no secret) */
  }
  draft.value = {
    ...blankDraft('webhook'),
    ...draftContext(full),
    id: full.id,
    title: full.title,
    enabled: full.enabled,
    slug: full.slug,
    methods: [...(full.methods ?? [])],
    authMethod: full.auth.method,
    headerKey: full.auth.headerKey ?? '',
    headerPattern: full.auth.headerPattern ?? '',
    hashAlgo: full.auth.hashAlgo ?? 'sha256',
    digest: full.auth.digest ?? 'hex',
    secret: full.auth.secret ?? '',
    hasSecret: !!full.hasSecret,
    whitelistIp: (full.whitelistIp ?? []).join('\n'),
    url: full.url,
  }
}

function editSchedule(t: ScheduleTrigger) {
  const iv = splitInterval(t.intervalSec ?? 0)
  draft.value = {
    ...blankDraft('schedule'),
    ...draftContext(t),
    id: t.id,
    title: t.title,
    enabled: t.enabled,
    mode: t.mode,
    cron: t.cron ?? '',
    intervalValue: iv.value,
    intervalUnit: iv.unit,
    timezone: t.timezone ?? '',
  }
}

function addTrigger(kind: TriggerKind) {
  showSecret.value = false
  draft.value = blankDraft(kind)
}

function cancelEdit() {
  showSecret.value = false
  draft.value = null
}

/** The `none` auth method has no header credential to prove identity, so it must
 *  be paired with an IP allow-list — an open unauthenticated hook is refused. */
const noneNeedsIp = computed(
  () => draft.value?.kind === 'webhook' && draft.value.authMethod === 'none' && !draft.value.whitelistIp.trim(),
)

/** A trigger can only be enabled once its run context resolves: `existing` mode
 *  must name a doc; `new` always resolves (a doc is minted each fire). */
const contextIncomplete = computed(() => draft.value?.contextMode === 'existing' && !draft.value.contextId)
const cannotEnable = computed(() => !!draft.value?.enabled && contextIncomplete.value)

const canSave = computed(() => {
  const d = draft.value
  if (!d || !d.title.trim()) return false
  if (cannotEnable.value) return false
  if (d.kind === 'webhook') return !noneNeedsIp.value
  if (d.mode === 'cron') return !!d.cron.trim()
  return d.intervalValue > 0
})

function buildSettings(d: Draft): SaveTriggerInput['settings'] {
  if (!d.execTimeoutSec && !d.nodeLimit && !d.reqTimeoutSec) return undefined
  return {
    executeTimeoutSec: d.execTimeoutSec || undefined,
    processNodeLimit: d.nodeLimit || undefined,
    requestTimeoutSec: d.reqTimeoutSec || undefined,
  }
}

function buildInput(d: Draft): SaveTriggerInput {
  const common = {
    id: d.id,
    flowId: flowId.value,
    startNodeId: startNodeId.value,
    title: d.title.trim(),
    enabled: d.enabled,
    contextMode: d.contextMode,
    contextId: d.contextMode === 'existing' ? d.contextId || undefined : undefined,
    contextTitle: d.contextMode === 'new' ? d.contextTitle.trim() || undefined : undefined,
    settings: buildSettings(d),
  }
  if (d.kind === 'webhook') {
    return {
      ...common,
      kind: 'webhook',
      slug: d.slug.trim(),
      methods: [...d.methods],
      whitelistIp: d.whitelistIp
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      auth: {
        method: d.authMethod,
        headerKey: d.authMethod === 'none' ? undefined : d.headerKey.trim() || undefined,
        headerPattern: ['jwt', 'hmac'].includes(d.authMethod) ? d.headerPattern.trim() || undefined : undefined,
        hashAlgo: d.authMethod === 'hmac' ? d.hashAlgo : undefined,
        digest: d.authMethod === 'hmac' ? d.digest : undefined,
        // Blank secret on an edit leaves the stored one untouched (undefined).
        secret: d.secret ? d.secret : undefined,
      },
    }
  }
  return {
    ...common,
    kind: 'schedule',
    mode: d.mode,
    cron: d.mode === 'cron' ? d.cron.trim() : undefined,
    intervalSec: d.mode === 'interval' ? d.intervalValue * UNIT_SECONDS[d.intervalUnit] : undefined,
    timezone: d.timezone.trim() || undefined,
  }
}

async function save() {
  if (!draft.value || !canSave.value) return
  saving.value = true
  try {
    await triggersApi.save(buildInput(draft.value))
    notifications.notify({ level: 'success', message: 'Trigger saved' })
    draft.value = null
    await load()
  } catch (err) {
    notifications.notify({ level: 'error', message: `Save trigger: ${(err as Error).message}` })
  } finally {
    saving.value = false
  }
}

async function toggleEnabled(t: Trigger) {
  try {
    // Re-save the whole record with the flipped flag. Secret is omitted (blank),
    // so the stored one is preserved.
    await triggersApi.save({ ...toSaveInput(t), enabled: !t.enabled } as SaveTriggerInput)
    await load()
  } catch (err) {
    notifications.notify({ level: 'error', message: `Update trigger: ${(err as Error).message}` })
  }
}

async function remove(t: Trigger) {
  if (!confirm(`Delete trigger "${t.title}"? This cannot be undone.`)) return
  try {
    await triggersApi.remove(t.id)
    notifications.notify({ level: 'success', message: 'Trigger deleted' })
    await load()
  } catch (err) {
    notifications.notify({ level: 'error', message: `Delete trigger: ${(err as Error).message}` })
  }
}

/** Rebuild a save input from an existing record (for a toggle) — no secret. */
function toSaveInput(t: Trigger): SaveTriggerInput {
  const ctx = {
    contextMode: t.contextMode,
    contextId: t.contextId,
    contextTitle: t.contextTitle,
    settings: t.settings,
  }
  if (t.kind === 'webhook') {
    return {
      ...ctx,
      id: t.id,
      kind: 'webhook',
      flowId: t.flowId,
      startNodeId: t.startNodeId,
      title: t.title,
      enabled: t.enabled,
      slug: t.slug,
      methods: t.methods,
      whitelistIp: t.whitelistIp,
      auth: { ...t.auth, secret: undefined },
    }
  }
  return {
    ...ctx,
    id: t.id,
    kind: 'schedule',
    flowId: t.flowId,
    startNodeId: t.startNodeId,
    title: t.title,
    enabled: t.enabled,
    mode: t.mode,
    cron: t.cron,
    intervalSec: t.intervalSec,
    timezone: t.timezone,
  }
}

function copyUrl(url?: string) {
  if (!url || typeof navigator === 'undefined' || !navigator.clipboard) return
  navigator.clipboard.writeText(url).then(
    () => notifications.notify({ level: 'success', message: 'URL copied' }),
    () => {},
  )
}

// ---- Row summaries ----------------------------------------------------------
const AUTH_LABEL: Record<WebhookAuthMethod, string> = {
  none: 'IP allow-list',
  static: 'Static token',
  basic: 'Basic auth',
  jwt: 'JWT',
  hmac: 'HMAC signature',
}

function scheduleSummary(t: ScheduleTrigger): string {
  if (t.mode === 'cron') return t.cron ? `cron ${t.cron}` : 'cron —'
  const iv = splitInterval(t.intervalSec ?? 0)
  return `every ${iv.value} ${iv.unit}`
}

function fmtTime(ms?: number): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString()
}

// Compact segmented options: icon + short label. The descriptive AUTH_LABEL
// above is still used for the row summaries; these drive the editor's chips.
const AUTH_OPTS: { id: WebhookAuthMethod; label: string; icon: string }[] = [
  { id: 'none', label: 'None', icon: 'shield' },
  { id: 'static', label: 'Token', icon: 'key' },
  { id: 'basic', label: 'Basic', icon: 'lock' },
  { id: 'jwt', label: 'JWT', icon: 'send' },
  { id: 'hmac', label: 'HMAC', icon: 'activity' },
]
const MODE_OPTS: { id: 'cron' | 'interval'; label: string; icon: string }[] = [
  { id: 'cron', label: 'Cron', icon: 'node-code' },
  { id: 'interval', label: 'Interval', icon: 'refresh' },
]
const UNIT_OPTS: { id: ScheduleUnit; label: string }[] = [
  { id: 'seconds', label: 'sec' },
  { id: 'minutes', label: 'min' },
  { id: 'hours', label: 'hr' },
  { id: 'days', label: 'day' },
]
const CONTEXT_OPTS: { id: TriggerContextMode; label: string; icon: string }[] = [
  { id: 'existing', label: 'Existing doc', icon: 'context' },
  { id: 'new', label: 'New each run', icon: 'plus' },
]
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

/** Toggle an HTTP method in the webhook's allow-list. */
function toggleMethod(m: string) {
  const arr = draft.value?.methods
  if (!arr) return
  const i = arr.indexOf(m)
  if (i >= 0) arr.splice(i, 1)
  else arr.push(m)
}

// Reveal state for the webhook secret input (eye toggle).
const showSecret = ref(false)

/** Inline style for a segmented option chip — accent-filled when selected. */
function seg(active: boolean) {
  return active
    ? { background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'var(--accent)' }
    : { color: 'var(--fg-muted)' }
}

const secretPlaceholder = computed(() =>
  draft.value?.hasSecret ? '•••••••• (unchanged — type to replace)' : 'Enter secret',
)
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center gap-2">
      <span class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Triggers</span>
      <span class="text-[11px] text-fg-subtle">— how this workflow starts</span>
    </div>
    <p class="text-[11px] leading-relaxed text-fg-subtle">
      Webhooks and schedules are stored separately from the flow graph; they only reference this flow and its
      Start node. Secrets and delivery logs never live in the workflow.
    </p>

    <!-- Unsaved flow: no id to bind triggers to. -->
    <div
      v-if="!flowId"
      class="rounded-lg border border-dashed px-3 py-4 text-[12px] text-fg-muted"
      style="border-color: var(--line-strong)"
    >
      Save the workflow first — triggers attach to a saved flow.
    </div>

    <template v-else>
      <!-- ===================== Existing triggers ===================== -->
      <div v-if="loading" class="text-[12px] text-fg-subtle">Loading triggers…</div>

      <template v-else>
        <!-- Webhook trigger (one per workflow) -->
        <div
          v-if="webhookTrigger"
          class="rounded-lg border p-2.5"
          :style="{ borderColor: 'var(--line)', opacity: webhookTrigger.enabled ? 1 : 0.6 }"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="flex min-w-0 items-center gap-1.5">
              <Icon name="zap" :size="14" class="shrink-0 text-fg-subtle" />
              <div class="min-w-0">
                <p class="truncate text-[13px] font-medium text-fg">{{ webhookTrigger.title }}</p>
                <p class="truncate text-[11px] text-fg-subtle">{{ AUTH_LABEL[webhookTrigger.auth.method] }}</p>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <button class="text-fg-subtle hover:text-fg" title="Enable / disable" @click="toggleEnabled(webhookTrigger)">
                <Icon :name="webhookTrigger.enabled ? 'check' : 'lock'" :size="14" />
              </button>
              <button class="text-fg-subtle hover:text-fg" title="Edit" @click="editWebhook(webhookTrigger)">
                <Icon name="settings" :size="14" />
              </button>
              <button class="text-fg-subtle hover:text-danger" title="Delete" @click="remove(webhookTrigger)">
                <Icon name="trash" :size="14" />
              </button>
            </div>
          </div>
          <div v-if="webhookTrigger.slug" class="mt-1.5 flex items-center gap-1.5">
            <code class="min-w-0 flex-1 truncate rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-fg-muted">{{ webhookUrl(webhookTrigger) }}</code>
            <button class="text-fg-subtle hover:text-fg" title="Copy URL" @click="copyUrl(webhookUrl(webhookTrigger))">
              <Icon name="copy" :size="13" />
            </button>
          </div>

          <!-- Recent deliveries (webhook hit log). Collapsed by default. -->
          <div class="mt-1.5">
            <button
              class="flex items-center gap-1 text-[11px] text-fg-subtle hover:text-fg"
              @click="toggleDeliveries(webhookTrigger.id)"
            >
              <Icon :name="openDeliveries.has(webhookTrigger.id) ? 'chevron-down' : 'chevron-right'" :size="12" />
              Recent deliveries
              <span v-if="webhookTrigger.recentHits?.length">({{ webhookTrigger.recentHits.length }})</span>
            </button>
            <div v-if="openDeliveries.has(webhookTrigger.id)" class="mt-1 space-y-1 border-l pl-2" style="border-color: var(--line)">
              <p v-if="!webhookTrigger.recentHits?.length" class="text-[11px] text-fg-subtle">No deliveries yet.</p>
              <div v-for="(hit, i) in (webhookTrigger.recentHits ?? []).slice(0, 10)" :key="i" class="flex items-baseline gap-1.5 text-[11px]">
                <span :class="hitStatusClass(hit.status)" class="font-mono font-semibold">{{ hit.status }}</span>
                <span class="font-mono text-fg-subtle">{{ hit.method }}</span>
                <span class="min-w-0 flex-1 truncate text-fg-muted" :title="hit.message">{{ hit.message }}</span>
                <span class="shrink-0 text-fg-subtle">{{ fmtTime(hit.at) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Schedule trigger (one per workflow) -->
        <div
          v-else-if="scheduleTrigger"
          class="rounded-lg border p-2.5"
          :style="{ borderColor: 'var(--line)', opacity: scheduleTrigger.enabled ? 1 : 0.6 }"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="flex min-w-0 items-center gap-1.5">
              <Icon name="refresh" :size="14" class="shrink-0 text-fg-subtle" />
              <div class="min-w-0">
                <p class="truncate text-[13px] font-medium text-fg">{{ scheduleTrigger.title }}</p>
                <p class="truncate font-mono text-[11px] text-fg-subtle">{{ scheduleSummary(scheduleTrigger) }}</p>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <button class="text-fg-subtle hover:text-fg" title="Enable / disable" @click="toggleEnabled(scheduleTrigger)">
                <Icon :name="scheduleTrigger.enabled ? 'check' : 'lock'" :size="14" />
              </button>
              <button class="text-fg-subtle hover:text-fg" title="Edit" @click="editSchedule(scheduleTrigger)">
                <Icon name="settings" :size="14" />
              </button>
              <button class="text-fg-subtle hover:text-danger" title="Delete" @click="remove(scheduleTrigger)">
                <Icon name="trash" :size="14" />
              </button>
            </div>
          </div>
          <p v-if="scheduleTrigger.nextAt" class="mt-1 text-[11px] text-fg-subtle">Next: {{ fmtTime(scheduleTrigger.nextAt) }}</p>
        </div>

        <!-- No trigger yet, not editing: choose one to add -->
        <div v-else-if="!draft" class="space-y-1.5">
          <p class="text-[11px] text-fg-subtle">Add one trigger to start this workflow automatically:</p>
          <div class="flex gap-2">
            <button class="btn flex-1" style="border: 1px solid var(--line-strong)" @click="addTrigger('webhook')">
              <Icon name="zap" :size="14" /> Webhook
            </button>
            <button class="btn flex-1" style="border: 1px solid var(--line-strong)" @click="addTrigger('schedule')">
              <Icon name="refresh" :size="14" /> Schedule
            </button>
          </div>
        </div>

        <!-- One-per-workflow note + clone escape hatch -->
        <p v-if="trigger" class="text-[11px] leading-relaxed text-fg-subtle">
          One trigger per workflow.
          <button class="text-accent hover:opacity-80" @click="cloneWorkflow">Clone this workflow</button>
          to add another.
        </p>
      </template>

      <!-- ===================== Draft editor ===================== -->
      <div
        v-if="draft"
        class="space-y-2.5 rounded-lg border p-3"
        style="border-color: var(--accent)"
      >
        <p class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
          {{ draft.id ? 'Edit' : 'New' }} {{ draft.kind }}
        </p>

        <!-- Title + enabled -->
        <div class="space-y-1">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Title</label>
          <input v-model="draft.title" class="input" placeholder="Label for this trigger" />
        </div>
        <label class="flex items-center gap-2 text-[13px] text-fg">
          <input v-model="draft.enabled" type="checkbox" class="h-4 w-4 accent-[var(--accent)]" />
          <span>{{ draft.enabled ? 'Enabled' : 'Disabled' }}</span>
        </label>
        <p v-if="cannotEnable" class="flex items-center gap-1 text-[11px] text-warning">
          <Icon name="alert-triangle" :size="12" /> Select a context document below before enabling.
        </p>

        <!-- ---- Run context (both kinds) ---- -->
        <div class="space-y-1.5 border-t pt-3">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Run context</label>
          <div class="flex gap-1.5">
            <button
              v-for="m in CONTEXT_OPTS"
              :key="m.id"
              class="flex flex-1 items-center justify-center gap-1 rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors"
              :style="seg(draft.contextMode === m.id)"
              @click="draft.contextMode = m.id"
            >
              <Icon :name="m.icon" :size="12" />{{ m.label }}
            </button>
          </div>

          <!-- Existing: pick a context doc -->
          <template v-if="draft.contextMode === 'existing'">
            <select v-model="draft.contextId" class="input">
              <option value="">— select a context —</option>
              <option v-for="ctx in contexts" :key="ctx.id" :value="ctx.id">{{ ctx.title || ctx.id }}</option>
            </select>
            <p class="text-[11px] text-fg-subtle">
              Each fire runs against this doc (a webhook merges its payload in). Runs share and mutate it.
            </p>
          </template>

          <!-- New: a fresh doc per fire -->
          <template v-else>
            <input v-model="draft.contextTitle" class="input" placeholder="New-context title (optional)" />
            <p class="text-[11px] text-fg-subtle">
              A fresh context is created every fire — isolated runs, but more rows in the context store.
            </p>
          </template>
        </div>

        <!-- ---- Run settings (optional, both kinds) ---- -->
        <div class="space-y-1.5 border-t pt-3">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
            Run settings <span class="font-normal normal-case text-fg-subtle">(optional — 0 keeps engine default)</span>
          </label>
          <div class="grid grid-cols-3 gap-2">
            <div class="space-y-1">
              <label class="text-[10px] text-fg-subtle">Timeout s</label>
              <input v-model.number="draft.execTimeoutSec" type="number" min="0" class="input font-mono text-xs" />
            </div>
            <div class="space-y-1">
              <label class="text-[10px] text-fg-subtle">Node limit</label>
              <input v-model.number="draft.nodeLimit" type="number" min="0" class="input font-mono text-xs" />
            </div>
            <div class="space-y-1">
              <label class="text-[10px] text-fg-subtle">Req s</label>
              <input v-model.number="draft.reqTimeoutSec" type="number" min="0" class="input font-mono text-xs" />
            </div>
          </div>
        </div>

        <!-- ---- Webhook fields ---- -->
        <template v-if="draft.kind === 'webhook'">
          <div class="space-y-1">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Path slug</label>
            <input v-model="draft.slug" class="input font-mono text-xs" placeholder="auto — e.g. github-push" />
            <p class="text-[11px] text-fg-subtle">Public URL is <code>/hooks/&lt;slug&gt;</code>. Leave blank to auto-assign.</p>
          </div>

          <div class="space-y-1.5">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
              Methods <span class="font-normal normal-case text-fg-subtle">(none = any)</span>
            </label>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="m in HTTP_METHODS"
                :key="m"
                class="rounded-md border px-2 py-1 font-mono text-[11px] font-medium transition-colors"
                :style="seg(draft.methods.includes(m))"
                @click="toggleMethod(m)"
              >
                {{ m }}
              </button>
            </div>
          </div>

          <div class="space-y-1.5">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Authentication</label>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="m in AUTH_OPTS"
                :key="m.id"
                class="flex items-center gap-1 rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors"
                :style="seg(draft.authMethod === m.id)"
                :title="AUTH_LABEL[m.id]"
                @click="draft.authMethod = m.id"
              >
                <Icon :name="m.icon" :size="12" />{{ m.label }}
              </button>
            </div>
          </div>

          <!-- Header key (all but none) -->
          <div v-if="draft.authMethod !== 'none'" class="space-y-1">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Header</label>
            <input v-model="draft.headerKey" class="input font-mono text-xs" placeholder="Authorization" />
          </div>

          <!-- Header pattern (jwt / hmac) -->
          <div v-if="draft.authMethod === 'jwt' || draft.authMethod === 'hmac'" class="space-y-1">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Header pattern</label>
            <input
              v-model="draft.headerPattern"
              class="input font-mono text-xs"
              :placeholder="draft.authMethod === 'jwt' ? '^Bearer (.+)$' : '^sha256=([a-f0-9]+)$'"
            />
            <p class="text-[11px] text-fg-subtle">Regex; the last capture group is the token.</p>
          </div>

          <!-- HMAC hash + digest -->
          <div v-if="draft.authMethod === 'hmac'" class="flex gap-2">
            <div class="flex-1 space-y-1">
              <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Hash</label>
              <select v-model="draft.hashAlgo" class="input">
                <option value="sha256">SHA-256</option>
                <option value="sha384">SHA-384</option>
                <option value="sha512">SHA-512</option>
              </select>
            </div>
            <div class="flex-1 space-y-1">
              <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Digest</label>
              <select v-model="draft.digest" class="input">
                <option value="hex">Hex</option>
                <option value="base64">Base64</option>
              </select>
            </div>
          </div>

          <!-- Secret (all but none) -->
          <div v-if="draft.authMethod !== 'none'" class="space-y-1">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
              {{ draft.authMethod === 'basic' ? 'Credentials (user:pass)' : draft.authMethod === 'jwt' ? 'Verification key / secret' : 'Secret' }}
            </label>
            <div class="relative">
              <input
                v-model="draft.secret"
                :type="showSecret ? 'text' : 'password'"
                autocomplete="off"
                class="input font-mono text-xs pr-8"
                :placeholder="secretPlaceholder"
              />
              <button
                type="button"
                class="absolute right-2 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg"
                :title="showSecret ? 'Hide secret' : 'Reveal secret'"
                @click="showSecret = !showSecret"
              >
                <Icon :name="showSecret ? 'eye-off' : 'eye'" :size="14" />
              </button>
            </div>
          </div>

          <!-- IP allow-list -->
          <div class="space-y-1">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
              IP allow-list {{ draft.authMethod === 'none' ? '(required)' : '(optional)' }}
            </label>
            <textarea
              v-model="draft.whitelistIp"
              rows="2"
              spellcheck="false"
              class="input resize-none font-mono text-xs"
              placeholder="One CIDR per line — e.g. 203.0.113.0/24"
            />
            <p v-if="noneNeedsIp" class="flex items-center gap-1 text-[11px] text-warning">
              <Icon name="alert-triangle" :size="12" /> IP allow-list is required when authentication is off.
            </p>
          </div>
        </template>

        <!-- ---- Schedule fields ---- -->
        <template v-else>
          <div class="space-y-1">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Mode</label>
            <div class="flex gap-1.5">
              <button
                v-for="m in MODE_OPTS"
                :key="m.id"
                class="flex flex-1 items-center justify-center gap-1 rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors"
                :style="seg(draft.mode === m.id)"
                @click="draft.mode = m.id"
              >
                <Icon :name="m.icon" :size="12" />{{ m.label }}
              </button>
            </div>
          </div>

          <div v-if="draft.mode === 'cron'" class="space-y-1">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Cron expression</label>
            <input v-model="draft.cron" class="input font-mono text-xs" placeholder="0 9 * * 1-5" />
            <p class="text-[11px] text-fg-subtle">Standard 5-field cron (min hour dom mon dow).</p>
          </div>

          <div v-else class="space-y-1.5">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Every</label>
            <div class="flex items-center gap-1.5">
              <input v-model.number="draft.intervalValue" type="number" min="1" class="input w-16 font-mono text-xs" />
              <div class="flex flex-1 gap-1.5">
                <button
                  v-for="u in UNIT_OPTS"
                  :key="u.id"
                  class="flex-1 rounded-md border px-2 py-1 text-[12px] font-medium transition-colors"
                  :style="seg(draft.intervalUnit === u.id)"
                  @click="draft.intervalUnit = u.id"
                >
                  {{ u.label }}
                </button>
              </div>
            </div>
            <p class="text-[11px] text-fg-subtle">Normalized to a cron expression on the server.</p>
          </div>

          <div class="space-y-1">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Timezone (optional)</label>
            <input v-model="draft.timezone" class="input font-mono text-xs" placeholder="UTC — e.g. Europe/Berlin" />
          </div>
        </template>

        <!-- Actions -->
        <div class="flex gap-2 pt-1">
          <button
            class="btn flex-1"
            :style="canSave && !saving
              ? { background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'var(--accent)' }
              : { opacity: 0.5 }"
            :disabled="!canSave || saving"
            @click="save"
          >
            <Icon name="save" :size="15" /> {{ saving ? 'Saving…' : 'Save' }}
          </button>
          <button class="btn" style="border: 1px solid var(--line-strong)" @click="cancelEdit">Cancel</button>
        </div>
      </div>
    </template>
  </div>
</template>
