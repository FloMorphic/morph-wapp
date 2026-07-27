<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { GraphNode } from '@vue-flow/core'
import WorkflowCanvas from '@/components/flow/WorkflowCanvas.vue'
import NodeSettingDetails from '@/components/flow/NodeSettingDetails.vue'
import FlowProcessesButton from '@/components/flow/FlowProcessesButton.vue'
import FlowLogDrawer from '@/components/flow/FlowLogDrawer.vue'
import RunFlowButton from '@/components/flow/RunFlowButton.vue'
import AiNodeImporter from '@/components/flow/AiNodeImporter.vue'
import WorkflowImporter from '@/components/flow/WorkflowImporter.vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import Icon from '@/components/ui/Icon.vue'
import { useWorkflowsStore } from '@/stores/workflows'
import { useFlowLogsStore } from '@/stores/flowLogs'
import { useFlowGraphsStore } from '@/stores/flowGraphs'
import { useNotificationsStore } from '@/stores/notifications'
import { offsetPatch, planPatch, summarize, type AiGraphPatch, type PlannedPatch } from '@/lib/aiGraph'
import { downloadFile, fileBase, workflowExportJson } from '@/lib/exportFlow'

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
const currentId = ref<string | undefined>(props.id)
const dirty = ref(false)
const saving = ref(false)
const loadError = ref<string | null>(null)

async function init() {
  loadError.value = null
  selected.value = null
  if (props.id) {
    try {
      const record = await store.get(props.id)
      title.value = record.title || UNTITLED
      currentId.value = record.id
      canvas.value?.loadGraph(record.view_flow ?? { nodes: [], edges: [] })
    } catch (err) {
      loadError.value = (err as Error).message
    }
  } else {
    title.value = UNTITLED
    currentId.value = undefined
    canvas.value?.loadGraph({ nodes: [], edges: [] }, true)
  }
  dirty.value = false
}

onMounted(init)
watch(() => props.id, init)

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
  notifications.notify({ level: 'success', title: 'AI nodes added', message: `${summarize(patch)} — review and save.` })
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
async function onImport({ patch, mode, title: fileTitle }: { patch: AiGraphPatch; mode: 'add' | 'replace'; title?: string }) {
  if (mode === 'replace') {
    canvas.value?.loadGraph({ nodes: [], edges: [] })
    await nextTick()
    return applyImport(planPatch(patch, null), mode, fileTitle)
  }
  const existing = currentGraph()
  return applyImport(planPatch(offsetPatch(patch, existing), existing), mode, fileTitle)
}

async function applyImport(planned: PlannedPatch, mode: 'add' | 'replace', fileTitle?: string) {
  await canvas.value?.applyPatch(planned)
  if (mode === 'replace' && fileTitle && isUnnamed(title.value)) title.value = fileTitle
  dirty.value = true
  notifications.notify({
    level: 'success',
    title: mode === 'replace' ? 'Workflow imported' : 'Workflow merged in',
    message: `${summarize(planned)} — review and save.`,
  })
}

/**
 * Export the design as a JSON file — what is on the canvas right now, saved or
 * not, so an unsaved draft can still be taken away. See lib/exportFlow for the
 * envelope and what a file does *not* carry across installs.
 */
function exportJson() {
  const graph = canvas.value?.getGraph()
  if (!graph) return
  downloadFile(
    new Blob([workflowExportJson(title.value, graph)], { type: 'application/json' }),
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

async function save() {
  const graph = canvas.value?.getGraph()
  if (!graph) return
  saving.value = true
  try {
    const record = await store.save({ id: currentId.value, title: title.value.trim() || UNTITLED, view_flow: graph })
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
        @input="dirty = true"
      />

      <span v-if="dirty" class="text-[11px] text-fg-subtle">Unsaved changes</span>

      <!-- Tools, grouped: view · design · runtime · commit. Scrolls rather than
           wraps on a narrow window, so the row always stays one line high. -->
      <div class="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto">
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

        <AiNodeImporter :resolve-graph="currentGraph" @apply="onAiPatch" />
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

    <!-- Canvas + inspector -->
    <div class="flex min-h-0 flex-1">
      <div class="relative min-w-0 flex-1">
        <WorkflowCanvas ref="canvas" @select="onSelect" @dirty="dirty = true" />
        <FlowLogDrawer />
      </div>
      <NodeSettingDetails :node="selected" @close="selected = null" @delete="onDelete" />
    </div>
  </div>
</template>
