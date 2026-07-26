<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { GraphNode } from '@vue-flow/core'
import WorkflowCanvas from '@/components/flow/WorkflowCanvas.vue'
import NodeSettingDetails from '@/components/flow/NodeSettingDetails.vue'
import FlowProcessesButton from '@/components/flow/FlowProcessesButton.vue'
import FlowLogDrawer from '@/components/flow/FlowLogDrawer.vue'
import RunFlowButton from '@/components/flow/RunFlowButton.vue'
import AiNodeImporter from '@/components/flow/AiNodeImporter.vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import { useWorkflowsStore } from '@/stores/workflows'
import { useFlowLogsStore } from '@/stores/flowLogs'
import { useFlowGraphsStore } from '@/stores/flowGraphs'
import { useNotificationsStore } from '@/stores/notifications'
import { summarize, type PlannedPatch } from '@/lib/aiGraph'

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

const title = ref('Untitled workflow')
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
      title.value = record.title || 'Untitled workflow'
      currentId.value = record.id
      canvas.value?.loadGraph(record.view_flow ?? { nodes: [], edges: [] })
    } catch (err) {
      loadError.value = (err as Error).message
    }
  } else {
    title.value = 'Untitled workflow'
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

async function save() {
  const graph = canvas.value?.getGraph()
  if (!graph) return
  saving.value = true
  try {
    const record = await store.save({ id: currentId.value, title: title.value.trim() || 'Untitled workflow', view_flow: graph })
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

      <div class="ml-auto flex items-center gap-2">
        <AiNodeImporter :resolve-graph="currentGraph" @apply="onAiPatch" />
        <FlowProcessesButton :flow-id="currentId" />
        <Button
          v-if="logs.isRemote"
          icon="monitor"
          :title="logs.isOpen ? 'Hide runtime logs' : 'Show runtime logs'"
          @click="logs.toggle()"
        >
          <span class="hidden sm:inline">Logs</span>
          <span
            v-if="logs.errorCount > 0"
            class="ml-1 inline-flex min-w-4 items-center justify-center rounded-full bg-danger-soft px-1.5 text-[11px] font-semibold text-danger"
          >
            {{ logs.errorCount }}
          </span>
        </Button>
        <Button
          icon="map"
          :title="canvas?.showMinimap ? 'Hide minimap' : 'Show minimap'"
          @click="canvas?.toggleMinimap()"
        >
          <span class="hidden sm:inline">{{ canvas?.showMinimap ? 'Map' : 'Map off' }}</span>
        </Button>
        <Button icon="refresh" title="Fit view" @click="canvas?.fitView({ padding: 0.3 })">
          <span class="hidden sm:inline">Fit</span>
        </Button>
        <RunFlowButton :flow-id="currentId" :dirty="dirty" />
        <Button variant="primary" icon="save" :disabled="saving" @click="save">
          {{ saving ? 'Saving…' : 'Save' }}
        </Button>
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
