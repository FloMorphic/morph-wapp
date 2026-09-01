<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'
import Button from '@/components/ui/Button.vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import PatchReview from './PatchReview.vue'
import { planPatch, type AiGraphPatch } from '@/lib/aiGraph'
import { parseWorkflowFile, referencedActions, namespaceOf, type PluginManifestEntry } from '@/lib/exportFlow'
import { fetchPluginActions } from '@/lib/nodeExtRefs'
import type { VueFlowGraph } from '@/types/api'

/**
 * "Import" — the other end of Export: a workflow file back onto the canvas.
 *
 * The file is a graph patch (see lib/exportFlow), which is why this dialog is
 * thin. Reading it is a parse; everything after that is the road the pasted-AI
 * path already walks — planPatch validates against the catalog and PatchReview
 * shows what would land, what was dropped and what needs finishing by hand. A
 * file from another install is exactly the case that review exists for: its
 * settings profiles and stores are ids from a table this app doesn't have.
 *
 * Two ways to land it, because they mean different things:
 *   - **Replace** — open the file *as* this canvas. The graph is cleared first
 *     and the file's own positions are kept, so a workflow comes back looking
 *     the way it was exported.
 *   - **Add** — merge it into what is already here, laid out clear of it, the
 *     way an AI patch arrives.
 *
 * Neither touches the backend: the canvas is left dirty and Save commits it, so
 * an import that turns out wrong is undone by leaving without saving.
 */
const props = defineProps<{
  /** The graph currently on the canvas, read when the dialog opens. */
  resolveGraph: () => VueFlowGraph
}>()
const emit = defineEmits<{
  (e: 'apply', payload: { patch: AiGraphPatch; mode: 'add' | 'replace'; title?: string; plugins?: PluginManifestEntry[] }): void
}>()

const open = ref(false)
const fileName = ref('')
const fileTitle = ref<string | undefined>(undefined)
const patch = ref<AiGraphPatch | null>(null)
const error = ref<string | null>(null)
const newerVersion = ref<number | undefined>(undefined)
const filePlugins = ref<PluginManifestEntry[]>([])
const dragging = ref(false)
const input = ref<HTMLInputElement | null>(null)

// The action methods this install's registered plugins expose — the portable
// key a flow's plugin nodes are checked against (an install's own pluginId is a
// per-install address that never matches across machines; the method names a
// plugin declares are the same everywhere). Loaded when the dialog opens and
// fails soft to empty — with no backend every action reads as "not installed",
// which is exactly the note a user with no plugins needs to see.
const installedActions = ref<Set<string>>(new Set())

// Snapshotted on open like the AI dialog does: the review is planned against
// this graph, so it must not shift under the dialog while it is up.
const snapshot = ref<VueFlowGraph>({ nodes: [], edges: [] })
const canvasEmpty = computed(() => snapshot.value.nodes.length === 0)

function openDialog() {
  snapshot.value = props.resolveGraph()
  reset()
  open.value = true
  void fetchPluginActions()
    .then((rows) => (installedActions.value = new Set(rows.map((r) => r.action))))
    .catch(() => (installedActions.value = new Set()))
}

function reset() {
  fileName.value = ''
  fileTitle.value = undefined
  patch.value = null
  error.value = null
  newerVersion.value = undefined
  filePlugins.value = []
  dragging.value = false
  if (input.value) input.value.value = ''
}

async function readFile(file: File | undefined | null) {
  if (!file) return
  fileName.value = file.name
  patch.value = null
  try {
    const parsed = parseWorkflowFile(await file.text())
    patch.value = parsed.patch
    error.value = parsed.error
    fileTitle.value = parsed.title
    newerVersion.value = parsed.newerVersion
    filePlugins.value = parsed.plugins ?? []
  } catch (err) {
    error.value = (err as Error).message
  }
}

function onDrop(e: DragEvent) {
  dragging.value = false
  void readFile(e.dataTransfer?.files?.[0])
}

// Planned against the canvas as it stands, which is what "Add" would do. The
// node list and the problems are the same either way; only the ids and the
// auto-laid-out positions differ, and those are decided when the patch is
// applied for real (see WorkflowEditorView).
const plan = computed(() => (patch.value ? planPatch(patch.value, snapshot.value) : null))
const canApply = computed(() => (plan.value?.nodes.length ?? 0) > 0)

/**
 * The plugins this flow runs but this install can't provide — the note that
 * tells the designer what to install before a run. Importing does not need them:
 * a plugin node lands either way, but a run of it errors while no local plugin
 * exposes its action.
 *
 * The check is per action method (the portable key), grouped back into plugins
 * for the note: a manifest entry claims the missing actions it declares (and
 * lends them its name + repo); any missing action no manifest entry claims — an
 * older file, or a bare patch — is grouped by its namespace so it is still shown.
 */
const missingPlugins = computed<PluginManifestEntry[]>(() => {
  if (!patch.value) return []
  const missing = referencedActions(patch.value).filter((a) => !installedActions.value.has(a))
  if (!missing.length) return []

  const out: PluginManifestEntry[] = []
  const claimed = new Set<string>()
  for (const entry of filePlugins.value) {
    const hits = entry.actions.filter((a) => missing.includes(a))
    if (!hits.length) continue
    hits.forEach((a) => claimed.add(a))
    out.push({ ...entry, actions: hits })
  }
  // Actions the manifest never named — key them by namespace (`qdrant.*`).
  const orphans = new Map<string, string[]>()
  for (const a of missing) {
    if (claimed.has(a)) continue
    const ns = namespaceOf(a) || a
    orphans.set(ns, [...(orphans.get(ns) ?? []), a])
  }
  for (const [ns, actions] of orphans) out.push({ name: ns, actions })
  return out
})

function apply(mode: 'add' | 'replace') {
  if (!patch.value || !canApply.value) return
  emit('apply', { patch: patch.value, mode, title: fileTitle.value, plugins: filePlugins.value })
  open.value = false
  reset()
}
</script>

<template>
  <ToolButton
    icon="import"
    label="Import"
    title="Import workflow — open an exported .flow.json file on this canvas"
    @click="openDialog"
  />

  <Modal
    :open="open"
    size="lg"
    title="Import workflow"
    subtitle="Open a workflow file exported from FloMorphic — or any patch JSON. Nothing is applied until you review it."
    @close="open = false"
  >
    <div class="space-y-4">
      <!-- The file ------------------------------------------------------ -->
      <label
        class="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-4 py-7 text-center transition-colors"
        :style="dragging ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)' } : undefined"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="onDrop"
      >
        <Icon name="import" :size="20" class="text-fg-subtle" />
        <span class="text-[13px] font-semibold text-fg">Drop a workflow file here, or click to browse</span>
        <span class="text-[11.5px] text-fg-muted">A <code class="font-mono">.flow.json</code> export, or any patch JSON</span>
        <input
          ref="input"
          type="file"
          accept="application/json,.json"
          class="hidden"
          @change="readFile(($event.target as HTMLInputElement).files?.[0])"
        />
      </label>

      <div v-if="fileName" class="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[12px]">
        <span class="font-mono text-fg-muted">{{ fileName }}</span>
        <span v-if="fileTitle" class="chip">{{ fileTitle }}</span>
        <span v-if="plan" class="text-fg-subtle">
          {{ plan.nodes.length }} node{{ plan.nodes.length === 1 ? '' : 's' }} ·
          {{ plan.edges.length }} edge{{ plan.edges.length === 1 ? '' : 's' }}
        </span>
      </div>

      <p v-if="error" class="flex items-start gap-1.5 text-[12px] text-danger">
        <Icon name="alert-triangle" :size="14" class="mt-px shrink-0" />
        {{ error }}
      </p>

      <p v-if="newerVersion" class="flex items-start gap-1.5 text-[12px] text-fg-muted">
        <Icon name="info" :size="14" class="mt-px shrink-0 text-fg-subtle" />
        This file was written by a newer version of FloMorphic (format {{ newerVersion }}). Anything this app doesn't
        recognise is listed below.
      </p>

      <!-- Plugins this flow needs that aren't installed here -------------- -->
      <section
        v-if="plan && missingPlugins.length"
        class="rounded-xl border p-3 text-[12px]"
        :style="{
          borderColor: 'color-mix(in srgb, var(--warning) 40%, var(--line))',
          background: 'color-mix(in srgb, var(--warning) 8%, transparent)',
        }"
      >
        <p class="flex items-start gap-1.5 font-semibold text-warning">
          <Icon name="alert-triangle" :size="14" class="mt-px shrink-0" />
          {{ missingPlugins.length }} plugin{{ missingPlugins.length === 1 ? '' : 's' }} this flow uses
          {{ missingPlugins.length === 1 ? "isn't" : "aren't" }} installed here
        </p>
        <p class="mt-1 text-fg-muted">
          Importing is fine — the {{ missingPlugins.length === 1 ? 'node lands' : 'nodes land' }} either way — but a
          run will error while {{ missingPlugins.length === 1 ? 'this plugin is' : 'these plugins are' }} missing.
          Install and register {{ missingPlugins.length === 1 ? 'it' : 'each one' }} from Extensions, then reopen the
          node to reconnect it. Not required to import.
        </p>
        <ul class="mt-2 space-y-2">
          <li v-for="(p, i) in missingPlugins" :key="p.name + i" class="space-y-0.5">
            <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span class="font-semibold text-fg">{{ p.name }}</span>
              <a
                v-if="p.repo"
                :href="p.repo"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1 text-accent hover:underline"
              >
                <Icon name="external-link" :size="12" class="shrink-0" />
                <span class="break-all">{{ p.repo }}</span>
                <span v-if="p.ref" class="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10.5px]">{{ p.ref }}</span>
              </a>
            </div>
            <div class="flex flex-wrap gap-1">
              <span
                v-for="a in p.actions"
                :key="a"
                class="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-fg-subtle"
                >{{ a }}</span
              >
            </div>
          </li>
        </ul>
      </section>

      <!-- What would land ----------------------------------------------- -->
      <section v-if="plan" class="space-y-2">
        <h3 class="text-[13px] font-semibold text-fg">Review</h3>
        <PatchReview :plan="plan" :existing="snapshot" empty-label="Nothing to import — the file declared no usable nodes." />
      </section>

      <p v-if="canApply && !canvasEmpty" class="text-[11.5px] leading-relaxed text-fg-subtle">
        <strong class="font-semibold text-fg-muted">Replace</strong> clears the
        {{ snapshot.nodes.length }} node{{ snapshot.nodes.length === 1 ? '' : 's' }} on this canvas and opens the file in
        their place, keeping its saved layout. <strong class="font-semibold text-fg-muted">Add</strong> keeps them and
        drops the file's nodes beside them. Either way nothing is written until you save.
      </p>
    </div>

    <template #footer>
      <Button @click="open = false">Cancel</Button>
      <Button v-if="!canvasEmpty" :disabled="!canApply" @click="apply('add')">Add to canvas</Button>
      <Button variant="primary" icon="import" :disabled="!canApply" @click="apply('replace')">
        {{ canvasEmpty ? 'Open on canvas' : 'Replace canvas' }}
      </Button>
    </template>
  </Modal>
</template>
