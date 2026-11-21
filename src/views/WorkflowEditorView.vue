<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { GraphNode } from '@vue-flow/core'
import WorkflowCanvas from '@/components/flow/WorkflowCanvas.vue'
import NodeSettingDetails from '@/components/flow/NodeSettingDetails.vue'
import FlowProcessesButton from '@/components/flow/FlowProcessesButton.vue'
import FlowInflightBanner from '@/components/flow/FlowInflightBanner.vue'
import FlowValidationBanner from '@/components/flow/FlowValidationBanner.vue'
import FlowLogDrawer from '@/components/flow/FlowLogDrawer.vue'
import FlowRunHud from '@/components/flow/FlowRunHud.vue'
import RunFlowButton from '@/components/flow/RunFlowButton.vue'
import AiNodeImporter from '@/components/flow/AiNodeImporter.vue'
import AiConnectButton from '@/components/flow/AiConnectButton.vue'
import WorkflowImporter from '@/components/flow/WorkflowImporter.vue'
import FlowEntryButton from '@/components/flow/FlowEntryButton.vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import Icon from '@/components/ui/Icon.vue'
import { useWorkflowsStore } from '@/stores/workflows'
import { useFlowLogsStore } from '@/stores/flowLogs'
import { useFlowGraphsStore } from '@/stores/flowGraphs'
import { useNotificationsStore } from '@/stores/notifications'
import { offsetPatch, planPatch, summarize, type AiGraphPatch, type PlannedPatch } from '@/lib/aiGraph'
import { downloadFile, fileBase, workflowExportJson, type AvailablePlugin, type PluginManifestEntry } from '@/lib/exportFlow'
import { fetchPluginRegistrations } from '@/lib/nodeExtRefs'
import { resolveNodeSettingsProfiles } from '@/lib/profileSync'
import { flowsApi, normalizeTags } from '@/api/flows'
import type { FlowPreferences, FlowValidation, NodeSetting } from '@/types/api'

const props = defineProps<{ id?: string }>()
const router = useRouter()
const store = useWorkflowsStore()
const logs = useFlowLogsStore()
const graphs = useFlowGraphsStore()
const notifications = useNotificationsStore()

// One shared socket powers the log drawer, the toolbar's live-run badge and
// app-wide notification toasts. App.vue connects it for the whole session;
// this is just a safety net in case the editor mounts first. Never disconnect
// on leave — notifications must keep arriving on other views.
onMounted(() => {
  if (logs.isRemote) logs.connect()
})

const canvas = ref<InstanceType<typeof WorkflowCanvas> | null>(null)
const selected = ref<GraphNode | null>(null)

const UNTITLED = 'Untitled workflow'
/** A workflow still carrying its placeholder name — safe for an import to name. */
const isUnnamed = (t: string) => !t.trim() || t.trim() === UNTITLED

const title = ref(UNTITLED)
// The flow's labels, edited as free text and normalized on save. They are what
// a consumer of this install filters its flow picker by (SurfStat narrows "run
// a flow on this row" to the framework that installed the flow), so they are
// part of the design, not metadata hidden in a side panel.
const tagsText = ref('')
/**
 * The flow's preferences — its entry form.
 *
 * `preferences` is what the flow carries (loaded with the record, replaced when
 * the Entry dialog saves its own route); `prefsPending` is set ONLY when
 * something on this canvas brought a form with it — an imported file, an AI
 * design — and is what a Save sends. Everything else sends nothing, and the
 * backend keeps what is stored: a graph save must never be able to drop the
 * form a flow needs, the same contract the tags have.
 */
const preferences = ref<FlowPreferences | undefined>(undefined)
const prefsPending = ref<FlowPreferences | undefined>(undefined)
/** The flow id `preferences` was loaded/saved for — so an export during a fast
 *  navigation cannot ship the previous flow's form (see preferencesForExport). */
let prefsOwner: string | undefined
const currentId = ref<string | undefined>(props.id)
const dirty = ref(false)
const saving = ref(false)
const loadError = ref<string | null>(null)
/** Counts author edits, so a background save knows not to clear a newer one. */
let editEpoch = 0

/** Mark the flow as edited (and remember it, for background-save coordination). */
function markDirty() {
  dirty.value = true
  editEpoch++
}

/** Bumped by every load/save-sync pass, so a slow background answer cannot
 *  repaint or persist a flow the editor has already navigated away from. */
let syncSeq = 0
/** The open flow's in-flight profile sweep, awaited before an author save so a
 *  fast Save cannot write the pre-sync copies back to the API. */
let profileSweep: Promise<void> | null = null

async function init() {
  loadError.value = null
  selected.value = null
  const seq = ++syncSeq
  if (props.id) {
    try {
      const record = await store.get(props.id)
      if (seq !== syncSeq) return
      title.value = record.title || UNTITLED
      tagsText.value = (record.tags ?? []).join(', ')
      preferences.value = record.preferences
      prefsPending.value = undefined
      prefsOwner = record.id
      currentId.value = record.id
      const graph = record.view_flow ?? { nodes: [], edges: [] }
      // Paint the saved graph immediately. Its profile copies are frozen at
      // save time, so they are re-resolved in the background (see
      // syncProfilesInBackground) and the canvas repaints as answers land.
      canvas.value?.loadGraph(graph)
      dirty.value = false
      const sweeping = syncProfilesInBackground(record.id, graph.nodes ?? [], seq)
      profileSweep = sweeping
      void sweeping.finally(() => {
        if (profileSweep === sweeping) profileSweep = null
      })
    } catch (err) {
      loadError.value = (err as Error).message
    }
  } else {
    title.value = UNTITLED
    tagsText.value = ''
    preferences.value = undefined
    prefsPending.value = undefined
    prefsOwner = undefined
    currentId.value = undefined
    canvas.value?.loadGraph({ nodes: [], edges: [] }, true)
    dirty.value = false
  }
}

/**
 * Lazy profile refresh for an opened flow.
 *
 * The saved graph is already on screen, so this never blocks the editor: it
 * fetches each distinct bound profile, re-stamps the matching nodes (whose
 * `data` objects are the ones the canvas paints) and only then, if something
 * actually changed, persists the corrected copies.
 *
 * Persisting matters. A sync that stopped at the canvas would make the next
 * refresh fetch the same stale graph from the API, detect the same difference
 * and report it again forever — the loop this replaces. The write is
 * deliberately silent: derived profile copies are not an edit the author made,
 * so they get no toast and no "unsaved changes" marker on open. A pass that
 * lands while the author is already editing leaves the canvas updated and lets
 * their own Save carry it, rather than persisting a half-finished change.
 */
async function syncProfilesInBackground(
  id: string,
  nodes: Array<{ type: string; data: unknown }>,
  seq: number,
): Promise<void> {
  const changed = await resolveNodeSettingsProfiles(nodes)
  if (!changed || seq !== syncSeq || currentId.value !== id) return
  // The author touched the flow while profiles were being read — keep their
  // edits (and the refreshed copies) in memory; their Save commits both.
  if (dirty.value || saving.value) return
  await persistSyncedGraph(id, seq)
}

/**
 * Save the current graph without touching title/tags/preferences the sync did
 * not change (`undefined` keeps the stored values). Used by the background
 * profile refresh, so a corrected copy reaches the API and the next open is
 * clean. Failing softly is right here: the canvas already shows the new copy,
 * and the next open tries again — this is not a user action to report.
 */
async function persistSyncedGraph(id: string, seq: number): Promise<void> {
  const graph = canvas.value?.getGraph()
  if (!graph || currentId.value !== id) return
  const editEpochAtStart = editEpoch
  lastSelfSaveAt = Date.now()
  try {
    const record = await store.save({
      id,
      title: title.value.trim() || UNTITLED,
      view_flow: graph,
      tags: normalizeTags(tagsText.value.split(',')),
    })
    if (seq !== syncSeq || currentId.value !== id) return
    lastSelfSaveAt = Date.now()
    validationSource.value = 'save'
    validation.value = record.validation ?? null
    graphs.invalidate(record.id)
    // Only clear the marker when the author did not start editing mid-save.
    if (editEpoch === editEpochAtStart) dirty.value = false
  } catch {
    // Silent: leave the refreshed copy on the canvas; the next open retries.
  }
}

onMounted(init)
watch(() => props.id, init)

// When this same client saves, the API echoes a `flow.changed` back over the
// socket; ignore it for a short window so a save never looks like an external edit.
let lastSelfSaveAt = 0

// React to the open flow being changed elsewhere (an MCP client, another tab).
// With no unsaved edits it is safe to reload the canvas in place — the "watch it
// update live" experience. With unsaved edits, only warn: reloading would throw
// the user's work away, so leave that choice to them.
watch(
  () => store.lastChanged,
  (change) => {
    if (!change || !currentId.value || change.id !== currentId.value) return
    if (Date.now() - lastSelfSaveAt < 2000) return
    if (!dirty.value) {
      void init()
      notifications.notify({ level: 'info', title: 'Workflow updated', message: 'Reloaded with changes made elsewhere.' })
    } else {
      notifications.notify({
        level: 'warning',
        title: 'Workflow changed elsewhere',
        message: 'This workflow was updated externally; your unsaved edits are kept. Reopen it to load the other changes and discard yours.',
      })
    }
  },
)

function onSelect(node: GraphNode | null) {
  selected.value = node
}

function onDelete(node: GraphNode) {
  canvas.value?.removeSelected(node)
  selected.value = null
}

/** The current graph, for the AI importer's prompt and its layout anchor. */
function currentGraph() {
  return canvas.value?.getGraph() ?? { nodes: [], edges: [] }
}

/** Drop an AI-designed subgraph in. Unsaved like any other edit, so Save commits it. */
async function onAiPatch(patch: PlannedPatch) {
  await canvas.value?.applyPatch(patch)
  adoptPreferences(patch.preferences)
  notifications.notify({ level: 'success', title: 'AI nodes added', message: `${summarize(patch)} — review and save.` })
}

/**
 * Take on an entry form a patch or a file brought with it.
 *
 * `replace` is for the file dialog's "Replace canvas" mode: the file is being
 * opened *as* this workflow, so its entry form replaces the current one — the
 * way its graph replaces the canvas. Everywhere else (Add, an AI patch) the
 * form is adopted only when this flow has none of its own, for the same reason
 * an import does not rename or relabel a flow behind the author's back. It
 * needs a Save to be committed.
 */
function adoptPreferences(incoming?: FlowPreferences, replace = false) {
  const declared = incoming?.entry?.form?.schema
  if (!declared || !Object.keys(declared).length) return
  if (!replace && preferences.value?.entry?.form?.schema) return
  preferences.value = incoming
  prefsPending.value = incoming
  markDirty()
}

/**
 * Land an imported workflow file (see WorkflowImporter for the two modes).
 *
 * Replacing plans the patch against an *empty* canvas on purpose: planPatch
 * lays a patch out clear of whatever is already there, and there is about to be
 * nothing there — planning it against the graph being thrown away would push
 * the imported nodes off to one side of their own canvas. Adding does the
 * opposite: the file's layout is shifted clear of the graph it joins
 * ({@link offsetPatch}), which a file needs and a hand-written patch doesn't,
 * since a file positions every node it carries.
 *
 * The file's name is adopted only for a workflow that hasn't been named yet, so
 * importing into a workflow you already titled never renames it behind your back.
 */
async function onImport({
  patch,
  mode,
  title: fileTitle,
  tags: fileTags,
  plugins,
  preferences: filePrefs,
}: {
  patch: AiGraphPatch
  mode: 'add' | 'replace'
  title?: string
  tags?: string[]
  plugins?: PluginManifestEntry[]
  preferences?: FlowPreferences
}) {
  adoptPreferences(filePrefs, mode === 'replace')
  if (mode === 'replace') {
    canvas.value?.loadGraph({ nodes: [], edges: [] })
    await nextTick()
    return applyImport(planPatch(patch, null), mode, fileTitle, fileTags, plugins)
  }
  const existing = currentGraph()
  return applyImport(planPatch(offsetPatch(patch, existing), existing), mode, fileTitle, fileTags, plugins)
}

/**
 * Re-attach settings profiles on an imported graph.
 *
 * An export writes only each node's `settingsId` (the values hold secrets), so
 * the id is resolved against *this* install's store before the patch lands. A
 * match denormalizes the current profile onto the node; an id nothing answers
 * to is left visibly dangling — the import review flags it for a pick. See
 * lib/profileSync for the shared lookup and reference-only rules.
 */
async function applyImport(
  planned: PlannedPatch,
  mode: 'add' | 'replace',
  fileTitle?: string,
  fileTags?: string[],
  plugins?: PluginManifestEntry[],
) {
  await resolveNodeSettingsProfiles(planned.nodes)
  await canvas.value?.applyPatch(planned, plugins)
  if (mode === 'replace' && fileTitle && isUnnamed(title.value)) title.value = fileTitle
  // The file's labels are adopted only when this flow has none of its own, for
  // the same reason as the title: an import must not relabel a flow behind the
  // author's back. They still need a Save to be committed.
  if (fileTags?.length && !tagsText.value.trim()) tagsText.value = normalizeTags(fileTags).join(', ')
  markDirty()
  notifications.notify({
    level: 'success',
    title: mode === 'replace' ? 'Workflow imported' : 'Workflow merged in',
    message: `${summarize(planned)} — review and save.`,
  })
}

/**
 * The entry form an export should carry.
 *
 * The in-memory copy is normally right, but it is only set once the record has
 * loaded and when the Entry dialog saves. Export can be pressed while that is
 * still in flight — or after the form was changed elsewhere — and a file that
 * silently drops the flow's entry form is worse than a short wait. A pending
 * (imported, not yet saved) form wins, because the file describes the canvas as
 * it stands; then the stored form, so a stale in-memory copy cannot erase it;
 * then whatever the editor holds.
 */
async function preferencesForExport(): Promise<FlowPreferences | undefined> {
  if (prefsPending.value) return prefsPending.value
  if (!currentId.value) return preferences.value
  // Ask the store rather than trusting the editor's copy: the form is edited on
  // its own route (FlowEntryButton), so another tab or client can have changed
  // it since this flow was opened, and an export that ships an old form is
  // exactly the bug this guards. The copy in memory is the offline fallback.
  try {
    const stored = await flowsApi.getPreferences(currentId.value)
    const hasForm = !!stored.entry?.form?.schema && Object.keys(stored.entry.form.schema).length > 0
    preferences.value = hasForm ? stored : undefined
    prefsOwner = currentId.value
    return hasForm ? stored : undefined
  } catch {
    return prefsOwner === currentId.value ? preferences.value : undefined
  }
}

/**
 * Export the design as a JSON file — what is on the canvas right now, saved or
 * not, so an unsaved draft can still be taken away. See lib/exportFlow for the
 * envelope and what a file does *not* carry across installs.
 */
async function exportJson() {
  const graph = canvas.value?.getGraph()
  if (!graph) return
  // The plugins this install has registered, so the file can name each plugin
  // the flow uses (and its repo) for a target install that is missing one. Fails
  // soft to none — the manifest then just lists actions without a name/repo.
  const [registrations, prefs] = await Promise.all([
    fetchPluginRegistrations().catch(() => []),
    preferencesForExport(),
  ])
  const available: AvailablePlugin[] = registrations.map((r) => ({
    pluginId: r.pluginId,
    name: r.name,
    repo: r.repo,
    ref: r.ref,
    subdir: r.subdir,
  }))
  downloadFile(
    new Blob([workflowExportJson(title.value, graph, available, normalizeTags(tagsText.value.split(',')), prefs)], {
      type: 'application/json',
    }),
    `${fileBase(title.value)}.flow.json`,
  )
  notifications.notify({
    level: 'success',
    title: 'Workflow exported',
    message: `${graph.nodes.length} node${graph.nodes.length === 1 ? '' : 's'} written to a JSON file.`,
  })
}

const capturing = ref(false)

/** PNG of the whole graph — for a doc, a ticket or a chat. */
async function snapshot() {
  if (capturing.value) return
  capturing.value = true
  try {
    const png = await canvas.value?.captureImage()
    if (!png) {
      notifications.notify({ level: 'info', message: 'Nothing to capture — the canvas is empty.' })
      return
    }
    downloadFile(png, `${fileBase(title.value)}.png`)
    notifications.notify({ level: 'success', title: 'Snapshot saved', message: 'The canvas was exported as a PNG image.' })
  } catch (err) {
    notifications.notify({ level: 'error', title: 'Snapshot failed', message: (err as Error).message })
  } finally {
    capturing.value = false
  }
}

/**
 * What the backend's graph check last found, and where it came from.
 *
 * It rides on the save response (the backend compiles what it just stored) and
 * can also be asked for on demand with Check. Either way it is advice — the save
 * already happened, runs are never blocked by it — so it lives in a dismissible
 * banner and nothing in the editor gates on it. See FlowValidationBanner.
 */
const validation = ref<FlowValidation | null>(null)
const validationSource = ref<'save' | 'check'>('save')
const checking = ref(false)

/**
 * Check the saved design now, without saving: the backend compiles the stored
 * graph and reports what it finds (`?validate=true`). For a flow opened from the
 * list — whose findings no save in this session has surfaced — this is how the
 * author sees them, and after an edit it reads the LAST SAVED graph, which is why
 * it says so when there are unsaved changes.
 */
async function check() {
  if (!currentId.value) return
  checking.value = true
  try {
    const res = await flowsApi.compile(currentId.value, { validate: true })
    validationSource.value = 'check'
    validation.value = res.validation ?? null
    if (res.validation && res.validation.issues.length === 0) {
      notifications.notify({
        level: 'success',
        title: 'Nothing to fix',
        message: dirty.value ? 'The last saved version of this flow checks out.' : 'This flow checks out.',
      })
    }
  } catch (err) {
    // A graph that would not lower at all answers 422 with the same payload.
    notifications.notify({ level: 'error', title: 'Check failed', message: (err as Error).message })
  } finally {
    checking.value = false
  }
}

/**
 * A settings profile was saved from a node's drawer.
 *
 * Every canvas node bound to the same `settingsId` still holds the profile's
 * old values, so the canvas re-stamps all of them at once. When the flow was
 * clean before this, the only difference is that derived copy — persist it in
 * the background so a refresh cannot fetch the stale version back. If the
 * author already had unsaved edits, leave them theirs to save: the synced
 * copies are on the canvas and their Save writes both.
 */
async function onProfileSaved(record: NodeSetting) {
  const wasClean = !dirty.value && !saving.value
  canvas.value?.syncSettingsProfile(record)
  if (!wasClean || !currentId.value) return
  // Let an open-flow sweep land first (it now sees the flow as edited and will
  // leave the write to this pass), so the two never race the API.
  await profileSweep?.catch(() => undefined)
  await persistSyncedGraph(currentId.value, ++syncSeq)
}

async function save() {
  saving.value = true
  // Arm the self-save guard before the await: the server echoes `flow.changed`
  // over the socket, which can beat this HTTP response back, and an echo seen
  // before the guard is armed looks like an external edit.
  lastSelfSaveAt = Date.now()
  try {
    // A profile sweep still resolving would re-stamp nodes mid-read; let it
    // finish first so this save writes the refreshed copies, not the ones the
    // graph was opened with. (`saving` is already set, so the sweep's own
    // persist pass steps back and lets this one own the write.)
    await profileSweep?.catch(() => undefined)
    const graph = canvas.value?.getGraph()
    if (!graph) return
    const record = await store.save({
      id: currentId.value,
      title: title.value.trim() || UNTITLED,
      view_flow: graph,
      tags: normalizeTags(tagsText.value.split(',')),
      preferences: prefsPending.value,
    })
    tagsText.value = (record.tags ?? []).join(', ')
    preferences.value = record.preferences ?? preferences.value
    prefsOwner = record.id
    // The check the save ran over the graph it just stored (absent in local mode).
    validationSource.value = 'save'
    validation.value = record.validation ?? null
    prefsPending.value = undefined
    lastSelfSaveAt = Date.now()
    dirty.value = false
    // The log drawer names nodes/edges by resolving ids against the saved graph;
    // a rename here must not leave it showing the old titles.
    graphs.invalidate(record.id)
    if (!currentId.value) {
      currentId.value = record.id
      router.replace({ name: 'workflow-edit', params: { id: record.id } })
    }
  } catch (err) {
    loadError.value = (err as Error).message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Toolbar -->
    <div class="flex h-14 shrink-0 items-center gap-3 border-b bg-surface px-3">
      <button
        class="flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-accent-soft hover:text-fg"
        title="Back to workflows"
        @click="router.push({ name: 'workflows' })"
      >
        <Icon name="arrow-left" :size="18" />
      </button>

      <input
        v-model="title"
        class="min-w-0 max-w-xs flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm font-semibold text-fg outline-none hover:border-line focus:border-accent"
        placeholder="Workflow name"
        @input="markDirty"
      />

      <!-- Tags: free text, comma-separated, normalized on save (the saved form
           is read back into the field). A flow's labels are how another system
           narrows a flow list to the ones it cares about. -->
      <label
        class="hidden min-w-0 max-w-[13rem] flex-1 items-center gap-1.5 rounded-lg border border-transparent px-2 py-1.5 text-fg-subtle hover:border-line focus-within:border-accent sm:flex"
        title="Labels for this flow, comma-separated — what a flow list can be filtered by (e.g. a compliance framework's name)"
      >
        <Icon name="tag" :size="15" class="shrink-0" />
        <input
          v-model="tagsText"
          class="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none"
          placeholder="tags, comma separated"
          @input="markDirty"
        />
      </label>

      <span v-if="dirty" class="text-[11px] text-fg-subtle">Unsaved changes</span>

      <!-- Tools, grouped: view · design · runtime · commit. Scrolls rather than
           wraps on a narrow window, so the row always stays one line high. -->
      <div class="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto">
        <!-- AI leads the row, ahead of the tools, as one segmented control: AI
             build puts nodes on this canvas, AI connect explains pointing your
             own client at the MCP server. One question with two answers — and
             the help half is not an action, so it does not belong among
             Import / Export / Snapshot. -->
        <div class="tool-group">
          <AiNodeImporter :resolve-graph="currentGraph" @apply="onAiPatch" />
          <AiConnectButton />
        </div>

        <span class="tool-sep" />

        <ToolButton
          icon="tidy"
          label="Tidy"
          title="Auto-arrange — re-lay the graph out left → right (replaces hand-placed positions)"
          @click="canvas?.autoArrange()"
        />
        <ToolButton icon="refresh" label="Fit" title="Fit the whole graph in view" @click="canvas?.fitView({ padding: 0.3 })" />
        <ToolButton
          icon="map"
          label="Map"
          :active="canvas?.showMinimap"
          :title="canvas?.showMinimap ? 'Hide minimap' : 'Show minimap'"
          @click="canvas?.toggleMinimap()"
        />

        <span class="tool-sep" />

        <FlowEntryButton
          :flow-id="currentId"
          @saved="
            (p) => {
              preferences = p
              prefsPending = undefined
            }
          "
        />
        <WorkflowImporter :resolve-graph="currentGraph" @apply="onImport" />
        <ToolButton
          icon="export"
          label="Export"
          title="Export workflow — download this design as a JSON file (unsaved edits included)"
          @click="exportJson"
        />
        <ToolButton
          icon="camera"
          :label="capturing ? 'Saving…' : 'Snapshot'"
          :disabled="capturing"
          title="Snapshot — save a PNG image of the whole graph"
          @click="snapshot"
        />

        <span class="tool-sep" />

        <FlowProcessesButton :flow-id="currentId" />
        <ToolButton
          v-if="logs.isRemote"
          icon="monitor"
          label="Logs"
          :active="logs.isOpen"
          :badge="logs.errorCount || undefined"
          badge-tone="danger"
          :title="logs.isOpen ? 'Hide runtime logs' : 'Show runtime logs'"
          @click="logs.toggle()"
        />
        <RunFlowButton :flow-id="currentId" :dirty="dirty" />

        <span class="tool-sep" />

        <ToolButton
          v-if="currentId && store.isRemote"
          icon="shield"
          :label="checking ? 'Checking…' : 'Check'"
          :disabled="checking"
          title="Check this design — compile the saved graph and report what the engine would find (deadlocked joins, unbound nodes, nodes nothing reaches). Saves nothing, blocks nothing."
          @click="check"
        />
        <ToolButton
          tone="primary"
          icon="save"
          :label="saving ? 'Saving…' : 'Save'"
          :disabled="saving"
          :title="dirty ? 'Save this workflow — you have unsaved changes' : 'Save this workflow'"
          @click="save"
        />
      </div>
    </div>

    <div v-if="loadError" class="border-b bg-danger-soft px-4 py-2 text-sm text-danger">{{ loadError }}</div>

    <!-- Non-blocking heads-up when the flow being edited still has runs or human
         tasks in flight (e.g. an unfinished Human-in-the-Loop session). -->
    <FlowInflightBanner :flow-id="currentId" />

    <!-- What compiling the graph found: advice an author can act on, never a
         refusal (the flow is saved and runnable regardless). Each row can take
         the canvas to the node or connection it is about. -->
    <FlowValidationBanner
      :validation="validation"
      :source="validationSource"
      @reveal="(t) => canvas?.reveal(t)"
      @dismiss="validation = null"
    />

    <!-- Canvas + inspector -->
    <div class="flex min-h-0 flex-1">
      <div class="relative min-w-0 flex-1">
        <WorkflowCanvas ref="canvas" :flow-id="currentId" @select="onSelect" @dirty="markDirty" />
        <!-- Which run the node/edge overlays belong to, and the control for
             switching between the runs live on this flow. -->
        <FlowRunHud :flow-id="currentId" />
        <FlowLogDrawer />
      </div>
      <NodeSettingDetails
        :node="selected"
        @close="selected = null"
        @delete="onDelete"
        @resolved="canvas?.rebindPluginNodes()"
        @profile-saved="onProfileSaved"
        @dirty="markDirty"
      />
    </div>
  </div>
</template>
