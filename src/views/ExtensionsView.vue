<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { emptyInstall, useExtensionsStore, type PluginStatus } from '@/stores/extensions'
import { useNotificationsStore } from '@/stores/notifications'
import { fetchPluginIntro } from '@/lib/pluginSettings'
import { apiBaseUrl } from '@/api/client'
import type { EnvVar, ExtensionRecord, InstallInfo, InstallRuntime, PluginIntro } from '@/types/api'
import PluginOnboardModal from '@/components/settings/PluginOnboardModal.vue'
import PageShell from '@/components/ui/PageShell.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'
import CopyBlock from '@/components/ui/CopyBlock.vue'

/**
 * Extensions portal — bring a third-party inflowv1 plugin into this project.
 *
 * A plugin is a process the user runs; FloMorphic only needs it to reach inflow
 * under an id this registry knows. So adding one is: register the row (which
 * mints the id), then take away whatever it takes to run it. Two ways in, and
 * the only difference between them is how much the user already has:
 *
 *   from a repo — they have a GitHub URL. We answer with a one-liner that
 *                 clones it, writes the env (credential included), builds and
 *                 starts it in a directory they name.
 *   bring your own — they already have the plugin. We answer with just the env
 *                 file, which is the whole of what it needs to connect.
 *
 * Whether a plugin actually came up is asked live, never stored: each card
 * probes the plugin's `@intro` through the backend's inflowv1 proxy.
 */

const store = useExtensionsStore()
const notify = useNotificationsStore()

onMounted(async () => {
  await store.refresh()
  if (store.isRemote) store.probeAll()
})

// ---- Add flow ---------------------------------------------------------------

type AddMode = 'repo' | 'manual'

const showAdd = ref(false)
const mode = ref<AddMode>('repo')
const submitting = ref(false)
const formError = ref<string | null>(null)

/** What the modal shows once a row is registered: how to get it running. */
type Handoff =
  | { kind: 'install'; name: string; pluginId: string; info: InstallInfo }
  | { kind: 'env'; name: string; pluginId: string; env: string; envFile: string }
const handoff = ref<Handoff | null>(null)
const handoffLoading = ref(false)

const ICON_CHOICES = ['plugin', 'zap', 'spaces', 'resources', 'shield', 'sparkles', 'memory', 'table', 'node-cast', 'node-code']
const RUNTIMES: { value: InstallRuntime; label: string; hint: string }[] = [
  { value: 'auto', label: 'Detect', hint: 'go.mod → Go, package.json → Node, Dockerfile → Docker' },
  { value: 'go', label: 'Go', hint: 'go build, then run the binary' },
  { value: 'node', label: 'Node', hint: 'npm install + npm start' },
  { value: 'docker', label: 'Docker', hint: 'docker build, then docker run' },
]

const form = reactive({
  name: '',
  description: '',
  iconName: 'plugin',
  repo: '',
  ref: '',
  subdir: '',
  runtime: 'auto' as InstallRuntime,
  envFile: '.env.inflow',
  dir: '',
  env: [] as EnvVar[],
})

// The plugin id is issued by the backend on register — a UUID, never chosen
// here. It is an address, not a label: every subject the plugin owns is
// `inflow.v1.<pluginId>.…` and its credential is scoped to exactly those, so it
// has to be unique across everyone importing the same plugin.

const dirTouched = ref(false)
function onNameInput() {
  if (!dirTouched.value) form.dir = defaultDir()
}

function defaultDir(): string {
  const base = form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `./${base || 'plugin'}`
}

function openAdd(next: AddMode) {
  mode.value = next
  form.name = ''
  form.description = ''
  form.iconName = 'plugin'
  form.repo = ''
  form.ref = ''
  form.subdir = ''
  form.runtime = 'auto'
  form.envFile = '.env.inflow'
  form.dir = ''
  form.env = []
  dirTouched.value = false
  formError.value = null
  handoff.value = null
  showAdd.value = true
}

function addEnvRow() {
  form.env.push({ key: '', value: '' })
}
function removeEnvRow(i: number) {
  form.env.splice(i, 1)
}

function isGitUrl(v: string): boolean {
  return /^https?:\/\/[^/]+\/.+/.test(v) || /^git@[^:]+:.+/.test(v) || /^ssh:\/\/.+/.test(v)
}

/** Register the row, then fetch the handoff for the mode it was added in. */
async function submit() {
  formError.value = null
  const name = form.name.trim()
  if (!name) {
    formError.value = 'Name is required.'
    return
  }
  const repo = form.repo.trim()
  if (mode.value === 'repo' && !isGitUrl(repo)) {
    formError.value = 'Enter a valid git repository URL (https://… or git@…).'
    return
  }

  submitting.value = true
  try {
    // No pluginId is sent: the backend issues one (a UUID) on create and keeps
    // it fixed thereafter.
    const saved = await store.save({
      kind: 'extension',
      type: 'plugin',
      name,
      description: form.description.trim(),
      icon: { class: 'flomorphic', name: form.iconName, meta: {} },
      install: {
        ...emptyInstall(),
        repo: mode.value === 'repo' ? repo : '',
        ref: form.ref.trim(),
        subdir: form.subdir.trim(),
        runtime: form.runtime,
        envFile: form.envFile.trim() || '.env.inflow',
        env: form.env.filter((e) => e.key.trim()),
      },
    })
    await loadHandoff(saved, mode.value === 'repo' ? form.dir.trim() || defaultDir() : undefined)
    notify.notify({ level: 'success', message: `${name} registered as ${saved.pluginId}.` })
  } catch (err) {
    formError.value = (err as Error).message
  } finally {
    submitting.value = false
  }
}

/** Repoint the installer at the origin the browser is *already* using to reach
 *  the API. The backend builds `scriptUrl`/`command` from the request it sees,
 *  but behind a reverse proxy that request has been rewritten — the public host,
 *  port and any `/api` prefix are stripped before it arrives — so the URL the
 *  backend hands back (127.0.0.1, no port, no prefix) reaches the proxy, not the
 *  API. The page origin plus the configured API base *is* the reachable address,
 *  by definition: it's how this very screen loaded the data. Keep only the path
 *  the backend chose and splice on that known-good origin. */
function withReachableUrl(info: InstallInfo): InstallInfo {
  const base = apiBaseUrl()
  if (!base) return info
  try {
    const apiBase = new URL(base, window.location.origin).href.replace(/\/$/, '')
    const path = new URL(info.scriptUrl)
    const scriptUrl = apiBase + path.pathname + path.search
    return { ...info, scriptUrl, command: info.command.replace(info.scriptUrl, scriptUrl) }
  } catch {
    return info
  }
}

/** Fetch what the user needs to run a registered plugin: the installer one-liner
 *  when the row has a source repo, otherwise just its env file. */
async function loadHandoff(ext: ExtensionRecord, dir?: string) {
  handoffLoading.value = true
  handoff.value = null
  try {
    if (ext.install?.repo) {
      const info = withReachableUrl(await store.installInfo(ext.id, dir))
      handoff.value = { kind: 'install', name: ext.name, pluginId: info.pluginId, info }
    } else {
      const res = await store.pluginEnv(ext.id)
      handoff.value = { kind: 'env', name: ext.name, pluginId: res.pluginId, env: res.env, envFile: res.envFile }
    }
  } catch (err) {
    formError.value = (err as Error).message
  } finally {
    handoffLoading.value = false
  }
}

/** Re-open the handoff for a row already in the list. The credential it carries
 *  is minted fresh each time — this is not a stored value being re-read. */
async function openHandoff(ext: ExtensionRecord) {
  formError.value = null
  handoff.value = null
  showAdd.value = true
  await loadHandoff(ext)
}

async function remove(ext: ExtensionRecord) {
  if (!window.confirm(`Remove "${ext.name}"? Its nodes disappear from the palette, and the credential minted for it stops being useful.`)) return
  await store.remove(ext.id)
  notify.notify({ level: 'info', message: `${ext.name} removed.` })
}

// ---- Live plugin actions ----------------------------------------------------
//
// A plugin describes itself over inflowv1, and neither descriptor is stored:
// `@intro` carries the settings it wants before any action runs (which becomes a
// settings profile), `@actions` the methods it exposes (which become palette
// nodes). Both are re-read on demand, because a plugin can be redeployed with
// either changed at any time.

/** Which row has an in-flight call, so its button can show it. */
const busy = ref<Record<string, 'sync' | 'onboard' | undefined>>({})

const onboarding = ref<ExtensionRecord | null>(null)
const onboardIntro = ref<PluginIntro | null>(null)
const showOnboard = ref(false)

/**
 * Read the plugin's settings requirements live, then offer them as a profile.
 *
 * The two descriptors this reads and why it takes both live in lib/pluginSettings
 * — the same fetch the node settings dialog uses, so a plugin's profile is built
 * from its own form wherever it is created.
 */
async function openOnboard(ext: ExtensionRecord) {
  busy.value = { ...busy.value, [ext.id]: 'onboard' }
  onboarding.value = ext
  onboardIntro.value = null
  showOnboard.value = true
  try {
    onboardIntro.value = await fetchPluginIntro(ext.id)
    store.states[ext.id] = { ...store.states[ext.id], status: 'up', intro: onboardIntro.value, error: undefined }
  } catch (err) {
    showOnboard.value = false
    store.states[ext.id] = { ...store.states[ext.id], status: 'down', error: (err as Error).message }
    notify.notify({
      level: 'error',
      title: `${ext.name} did not answer`,
      message: 'Start the plugin first — its settings form is read from the running process.',
    })
  } finally {
    busy.value = { ...busy.value, [ext.id]: undefined }
  }
}

/** Rebuild this plugin's palette nodes from its live action list. */
async function syncPlugin(ext: ExtensionRecord) {
  busy.value = { ...busy.value, [ext.id]: 'sync' }
  try {
    const res = await store.sync(ext.id)
    notify.notify({
      level: 'success',
      title: `${ext.name} refreshed`,
      message:
        res.added === 0
          ? 'The plugin exposes no actions.'
          : `${res.added} node${res.added === 1 ? '' : 's'} in the palette${res.removed ? ` (replacing ${res.removed})` : ''}.`,
    })
  } catch (err) {
    store.states[ext.id] = { ...store.states[ext.id], status: 'down', error: (err as Error).message }
    notify.notify({
      level: 'error',
      title: `Could not refresh ${ext.name}`,
      message: (err as Error).message,
    })
  } finally {
    busy.value = { ...busy.value, [ext.id]: undefined }
  }
}

// ---- Status -----------------------------------------------------------------

const STATUS: Record<PluginStatus, { label: string; color: string }> = {
  unknown: { label: 'Not checked', color: 'var(--fg-subtle)' },
  checking: { label: 'Checking…', color: 'var(--warning)' },
  up: { label: 'Up', color: 'var(--success)' },
  down: { label: 'Not reachable', color: 'var(--danger)' },
}

function stateOf(id: string) {
  return store.states[id] ?? { status: 'unknown' as PluginStatus }
}

const upCount = computed(() => store.items.filter((e) => stateOf(e.id).status === 'up').length)

const modalTitle = computed(() => {
  if (handoff.value) return `Run ${handoff.value.name}`
  return mode.value === 'repo' ? 'Add extension from a repository' : 'Add an extension you already have'
})
</script>

<template>
  <PageShell
    title="Extensions"
    subtitle="Third-party inflowv1 plugins. Register one here to give it an identity and a credential; run it wherever you like, and its nodes join the workflow palette."
  >
    <template #actions>
      <Button icon="refresh" :disabled="!store.isRemote || store.items.length === 0" @click="store.probeAll()">Check all</Button>
      <Button variant="primary" icon="plus" :disabled="!store.isRemote" @click="openAdd('repo')">Add extension</Button>
    </template>

    <div
      v-if="!store.isRemote"
      class="mb-6 flex items-start gap-3 rounded-xl border border-dashed bg-surface-2 px-4 py-3 text-[13px] text-fg-muted"
    >
      <span class="mt-0.5 text-warning"><Icon name="alert-triangle" :size="16" /></span>
      <p>
        Extensions need a connected backend: the plugin's identity is registered there, and its runtime credential is minted
        there too. Set <code class="font-mono text-xs">VITE_API_BASE_URL</code> to connect.
      </p>
    </div>

    <div v-else class="mb-6 flex items-start gap-3 rounded-xl border border-dashed bg-surface-2 px-4 py-3 text-[13px] text-fg-muted">
      <span class="mt-0.5 text-accent"><Icon name="info" :size="16" /></span>
      <p>
        An extension is a plugin process you run — FloMorphic never clones or executes anything. Registering it here mints its
        <span class="font-medium text-fg">plugin id</span> and a credential scoped to it; you get back either a one-line
        installer or just the env file, depending on whether you have the source yet.
      </p>
    </div>

    <div v-if="store.loading" class="py-16 text-center text-sm text-fg-muted">Loading extensions…</div>

    <div v-else-if="store.error" class="rounded-xl border border-dashed px-6 py-12 text-center">
      <p class="text-sm text-danger">{{ store.error }}</p>
      <Button class="mt-4" icon="refresh" @click="store.refresh()">Retry</Button>
    </div>

    <EmptyState
      v-else-if="store.items.length === 0"
      icon="extensions"
      title="No extensions yet"
      description="Add a plugin from its Git repository, or register one you already have running."
    >
      <div class="flex flex-wrap items-center justify-center gap-2">
        <Button variant="primary" icon="plus" :disabled="!store.isRemote" @click="openAdd('repo')">From a repository</Button>
        <Button icon="key" :disabled="!store.isRemote" @click="openAdd('manual')">I already have it</Button>
      </div>
    </EmptyState>

    <template v-else>
      <p class="mb-3 text-[12px] text-fg-subtle">
        {{ store.items.length }} registered · {{ upCount }} up
      </p>

      <div class="grid gap-4 sm:grid-cols-2">
        <div v-for="ext in store.items" :key="ext.id" class="card flex flex-col p-4">
          <div class="flex items-start justify-between gap-2">
            <div class="flex min-w-0 items-center gap-2.5">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <Icon :name="ext.icon?.name || 'plugin'" :size="18" />
              </span>
              <div class="min-w-0">
                <h3 class="truncate font-semibold text-fg">{{ ext.name }}</h3>
                <span
                  class="inline-flex items-center gap-1.5 text-[11px] font-medium"
                  :style="{ color: STATUS[stateOf(ext.id).status].color }"
                  :title="stateOf(ext.id).error"
                >
                  <span class="h-1.5 w-1.5 rounded-full" :style="{ background: STATUS[stateOf(ext.id).status].color }" />
                  {{ STATUS[stateOf(ext.id).status].label }}
                </span>
              </div>
            </div>
            <button class="rounded-lg p-1.5 text-fg-subtle hover:bg-danger-soft hover:text-danger" title="Remove" @click="remove(ext)">
              <Icon name="trash" :size="15" />
            </button>
          </div>

          <p v-if="ext.description" class="mt-3 line-clamp-2 text-[13px] text-fg-muted">{{ ext.description }}</p>

          <div class="mt-3 space-y-1 font-mono text-[11px] text-fg-subtle">
            <div class="flex items-center gap-1.5 truncate">
              <Icon name="key" :size="12" />
              <span class="truncate">{{ ext.pluginId }}</span>
            </div>
            <div v-if="ext.install?.repo" class="flex items-center gap-1.5 truncate">
              <Icon name="external-link" :size="12" />
              <span class="truncate">{{ ext.install.repo }}</span>
              <span v-if="ext.install.ref" class="shrink-0 rounded bg-surface-2 px-1.5 py-0.5">{{ ext.install.ref }}</span>
            </div>
          </div>

          <!-- What the plugin contributes to the palette, once synced. -->
          <div v-if="store.actionsOf(ext.pluginId).length" class="mt-3 flex flex-wrap gap-1">
            <span
              v-for="a in store.actionsOf(ext.pluginId).slice(0, 6)"
              :key="a.id"
              class="chip !bg-surface-2 !text-fg-subtle text-[10px]"
              :title="a.description"
            >
              {{ a.name }}
            </span>
            <span v-if="store.actionsOf(ext.pluginId).length > 6" class="chip !bg-surface-2 !text-fg-subtle text-[10px]">
              +{{ store.actionsOf(ext.pluginId).length - 6 }}
            </span>
          </div>

          <div class="mt-4 flex items-center gap-2 border-t pt-3">
            <Button :icon="ext.install?.repo ? 'export' : 'key'" @click="openHandoff(ext)">
              {{ ext.install?.repo ? 'Install command' : 'Env file' }}
            </Button>
            <Button icon="refresh" title="Ask the plugin whether it is up" @click="store.probe(ext.id)">Check</Button>

            <div class="ml-auto flex items-center gap-0.5">
              <!-- @intro → the plugin's own settings form, saved as a profile. -->
              <button
                class="rounded-lg p-1.5 text-fg-subtle hover:bg-accent-soft hover:text-accent disabled:opacity-40"
                title="Set up this plugin — fill in the settings it asks for"
                :disabled="busy[ext.id] === 'onboard'"
                @click="openOnboard(ext)"
              >
                <Icon name="settings" :size="15" />
              </button>
              <!-- @actions → rebuild this plugin's palette nodes. -->
              <button
                class="rounded-lg p-1.5 text-fg-subtle hover:bg-accent-soft hover:text-accent disabled:opacity-40"
                title="Refresh this plugin's nodes from its live action list"
                :disabled="busy[ext.id] === 'sync'"
                @click="syncPlugin(ext)"
              >
                <Icon name="zap" :size="15" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Add / handoff modal -->
    <Modal
      :open="showAdd"
      :title="modalTitle"
      :subtitle="handoff ? 'Registered. Here is what it takes to get it running.' : 'It gets an identity here; you run the process.'"
      size="lg"
      @close="showAdd = false"
    >
      <!-- Step 2: the handoff -->
      <div v-if="handoffLoading" class="py-10 text-center text-sm text-fg-muted">Minting credential…</div>

      <div v-else-if="handoff?.kind === 'install'" class="space-y-4">
        <div class="flex items-center gap-2 rounded-lg border bg-surface-2 px-3 py-2">
          <Icon name="key" :size="14" class="shrink-0 text-accent" />
          <span class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Plugin ID</span>
          <code class="truncate font-mono text-[12px] text-fg">{{ handoff.pluginId }}</code>
        </div>

        <div>
          <p class="mb-1.5 text-[13px] text-fg-muted">
            Run this on the machine that should host the plugin. It clones the repo into
            <code class="font-mono text-xs text-fg">{{ handoff.info.dir }}</code
            >, writes <code class="font-mono text-xs text-fg">{{ handoff.info.envFile }}</code
            >, builds it and starts it.
          </p>
          <CopyBlock label="One-line install" :content="handoff.info.command" secret max-height="7rem" />
        </div>

        <CopyBlock
          label="Environment the script writes"
          :content="handoff.info.env"
          :filename="handoff.info.envFile"
          secret
          max-height="9rem"
        />

        <details class="rounded-lg border" style="border-color: var(--line-strong)">
          <summary class="cursor-pointer px-3 py-2 text-[12px] font-medium text-fg-muted">
            Read the script before running it
          </summary>
          <div class="px-3 pb-3">
            <CopyBlock label="install.sh" :content="handoff.info.script" filename="install.sh" max-height="20rem" />
          </div>
        </details>

        <p class="flex items-start gap-2 rounded-lg border border-dashed bg-surface-2 px-3 py-2 text-[12px] text-fg-muted">
          <span class="mt-0.5 text-warning"><Icon name="lock" :size="14" /></span>
          <span>
            This command carries a credential scoped to <code class="font-mono">{{ handoff.info.pluginId }}</code
            >. Anyone who has it can act as this plugin — don't paste it into a shared channel or commit it.
          </span>
        </p>
      </div>

      <div v-else-if="handoff?.kind === 'env'" class="space-y-4">
        <div class="flex items-center gap-2 rounded-lg border bg-surface-2 px-3 py-2">
          <Icon name="key" :size="14" class="shrink-0 text-accent" />
          <span class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Plugin ID</span>
          <code class="truncate font-mono text-[12px] text-fg">{{ handoff.pluginId }}</code>
        </div>

        <p class="text-[13px] text-fg-muted">
          Save this next to the plugin as <code class="font-mono text-xs text-fg">{{ handoff.envFile }}</code> and start it. The
          three inflow variables are all the SDK needs; anything else below is what you declared for this plugin.
        </p>
        <CopyBlock label="Environment" :content="handoff.env" :filename="handoff.envFile" secret max-height="14rem" />
        <p class="flex items-start gap-2 rounded-lg border border-dashed bg-surface-2 px-3 py-2 text-[12px] text-fg-muted">
          <span class="mt-0.5 text-warning"><Icon name="lock" :size="14" /></span>
          <span>Treat it as a secret: <code class="font-mono">INFRA_CRED</code> is a live credential for this plugin.</span>
        </p>
      </div>

      <!-- Step 1: the form -->
      <div v-else class="space-y-4">
        <!-- Mode -->
        <div class="flex items-center gap-1 rounded-lg border bg-surface-2 p-1 text-sm">
          <button
            v-for="m in (['repo', 'manual'] as AddMode[])"
            :key="m"
            class="flex-1 rounded-md px-3 py-1.5 font-medium transition-colors"
            :style="mode === m ? { background: 'var(--accent)', color: 'var(--accent-fg)' } : { color: 'var(--fg-muted)' }"
            @click="mode = m"
          >
            {{ m === 'repo' ? 'From a Git repository' : 'I already have the plugin' }}
          </button>
        </div>
        <p class="text-[12px] text-fg-subtle">
          {{
            mode === 'repo'
              ? 'You get a one-liner that downloads, configures and runs the plugin on any host that can reach inflow.'
              : 'You get the env file — credential, infra URL and plugin id — to drop next to your checkout.'
          }}
        </p>

        <div class="grid gap-3 sm:grid-cols-2">
          <div class="space-y-1">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Name</label>
            <input v-model="form.name" class="input" placeholder="e.g. Jira Connector" @input="onNameInput" />
          </div>
          <div class="space-y-1">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Description</label>
            <input v-model="form.description" class="input" placeholder="What this plugin does" />
          </div>
        </div>
        <p class="-mt-2 flex items-start gap-2 text-[11px] text-fg-subtle">
          <span class="mt-0.5"><Icon name="key" :size="12" /></span>
          <span>
            The plugin id is issued on register — your name plus a UUID, e.g. <code class="font-mono">jira-connector-274b…</code>.
            It is the address every one of this plugin's inflow subjects is built from, and what its credential is scoped to, so
            the UUID half keeps two imports of the same plugin apart.
          </span>
        </p>

        <div class="space-y-1.5">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Palette icon</label>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="ic in ICON_CHOICES"
              :key="ic"
              class="flex h-9 w-9 items-center justify-center rounded-lg border transition-colors"
              :style="
                form.iconName === ic
                  ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)' }
                  : { color: 'var(--fg-muted)' }
              "
              :title="ic"
              @click="form.iconName = ic"
            >
              <Icon :name="ic" :size="16" />
            </button>
          </div>
        </div>

        <!-- Source (repo mode) -->
        <div v-if="mode === 'repo'" class="space-y-3 rounded-lg border bg-surface-2 p-3">
          <div class="space-y-1">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Repository URL</label>
            <input v-model="form.repo" class="input font-mono text-xs" placeholder="https://github.com/org/inflow-plugin-x" />
          </div>

          <div class="grid gap-3 sm:grid-cols-3">
            <div class="space-y-1">
              <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Ref</label>
              <input v-model="form.ref" class="input" placeholder="default branch" />
            </div>
            <div class="space-y-1">
              <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Subdirectory</label>
              <input v-model="form.subdir" class="input font-mono text-xs" placeholder="repo root" />
            </div>
            <div class="space-y-1">
              <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Runtime</label>
              <select v-model="form.runtime" class="input">
                <option v-for="r in RUNTIMES" :key="r.value" :value="r.value">{{ r.label }}</option>
              </select>
            </div>
          </div>
          <p class="text-[11px] text-fg-subtle">{{ RUNTIMES.find((r) => r.value === form.runtime)?.hint }}</p>

          <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1">
              <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Install directory</label>
              <input
                v-model="form.dir"
                class="input font-mono text-xs"
                :placeholder="defaultDir()"
                @input="dirTouched = true"
              />
            </div>
            <div class="space-y-1">
              <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Env file</label>
              <input v-model="form.envFile" class="input font-mono text-xs" placeholder=".env.inflow" />
            </div>
          </div>
        </div>

        <div v-else class="space-y-1">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Env file name</label>
          <input v-model="form.envFile" class="input font-mono text-xs" placeholder=".env.inflow" />
          <p class="text-[11px] text-fg-subtle">The dotenv your plugin reads — the Go SDK's default is <code class="font-mono">.env.inflow</code>.</p>
        </div>

        <!-- Extra env -->
        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Plugin environment</label>
            <button class="flex items-center gap-1 text-[12px] text-accent hover:underline" @click="addEnvRow">
              <Icon name="plus" :size="13" /> Add variable
            </button>
          </div>
          <div v-for="(row, i) in form.env" :key="i" class="flex items-center gap-2">
            <input v-model="row.key" class="input flex-1 font-mono text-xs" placeholder="KEY" />
            <input v-model="row.value" class="input flex-1 font-mono text-xs" placeholder="value" />
            <button class="shrink-0 rounded-lg p-1.5 text-fg-subtle hover:bg-danger-soft hover:text-danger" @click="removeEnvRow(i)">
              <Icon name="x" :size="15" />
            </button>
          </div>
          <p class="text-[11px] text-fg-subtle">
            Anything the plugin needs beyond inflow itself (API keys, endpoints). <code class="font-mono">PLUGIN_ID</code>,
            <code class="font-mono">INFRA_URL</code> and <code class="font-mono">INFRA_CRED</code> are added for you.
          </p>
        </div>

        <p v-if="formError" class="text-sm text-danger">{{ formError }}</p>
      </div>

      <template #footer>
        <template v-if="handoff">
          <p class="mr-auto text-[12px] text-fg-subtle">Started it? Hit <span class="font-medium">Check</span> on its card.</p>
          <Button variant="primary" icon="check" @click="showAdd = false">Done</Button>
        </template>
        <template v-else>
          <Button @click="showAdd = false">Cancel</Button>
          <Button variant="primary" icon="plus" :disabled="submitting" @click="submit">
            {{ submitting ? 'Registering…' : 'Register plugin' }}
          </Button>
        </template>
      </template>
    </Modal>

    <!-- Plugin onboarding: the settings form read live from @intro. -->
    <PluginOnboardModal
      :open="showOnboard"
      :plugin="onboarding"
      :intro="onboardIntro"
      @close="showOnboard = false"
      @saved="(t) => notify.notify({ level: 'success', message: `Settings profile “${t}” saved.` })"
    />
  </PageShell>
</template>
