<script setup lang="ts">
import { computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { specForType } from '@/data/nodeCatalog'
import type { PlannedPatch } from '@/lib/aiGraph'
import type { VueFlowGraph } from '@/types/api'

/**
 * What a patch would do to the canvas, shown before anything is applied — the
 * shared review step behind both ways a graph gets in: pasted assistant output
 * (AiNodeImporter) and an imported workflow file (WorkflowImporter).
 *
 * It is the same list for both on purpose. Whatever produced the JSON, the
 * questions are identical — which nodes land, how they wire up, what was
 * dropped as invalid, and what only a human can finish (a settings profile, a
 * store, a server URL) — so reviewing an import teaches you nothing new when
 * you later review a patch, and a fix to this list improves both paths.
 *
 * Purely presentational: it reads a plan ({@link PlannedPatch}, already
 * validated by lib/aiGraph) and renders it.
 */
const props = defineProps<{
  plan: PlannedPatch
  /** The graph on canvas, so an edge into an existing node reads by its title. */
  existing?: VueFlowGraph | null
  /** Shown when the plan carries no usable node. */
  emptyLabel?: string
}>()

const errors = computed(() => props.plan.problems.filter((p) => p.level === 'error'))
const warnings = computed(() => props.plan.problems.filter((p) => p.level === 'warn'))
const hasNodes = computed(() => props.plan.nodes.length > 0)

/** Node ids → their patch ref, so the edge list reads in the patch's own names. */
const refById = computed(() => new Map(props.plan.nodes.map((n) => [n.id, n.ref])))

function endpointLabel(id: string): string {
  const ref = refById.value.get(id)
  if (ref) return ref
  const existing = props.existing?.nodes.find((n) => n.id === id)
  const title = String((existing?.data as Record<string, unknown>)?.title ?? '').trim()
  return title || id
}

function specColor(type: string): string {
  return specForType(type)?.color ?? 'var(--fg-muted)'
}
</script>

<template>
  <div class="space-y-3">
    <p v-if="!hasNodes" class="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-fg-muted">
      {{ emptyLabel ?? 'Nothing to add — the patch declared no usable nodes.' }}
    </p>

    <div v-else class="space-y-1.5">
      <div v-for="n in plan.nodes" :key="n.id" class="flex items-start gap-2.5 rounded-xl border px-3 py-2">
        <span
          class="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
          :style="{ background: `color-mix(in srgb, ${specColor(n.type)} 16%, transparent)`, color: specColor(n.type) }"
        >
          <Icon :name="n.spec.icon" :size="13" />
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-baseline gap-x-2">
            <span class="text-[13px] font-semibold text-fg">{{ n.data.title || n.spec.label }}</span>
            <span class="chip">{{ n.spec.label }}</span>
            <span v-if="n.data.key" class="font-mono text-[11px] text-fg-subtle">→ {{ n.data.key }}</span>
          </div>
          <p v-if="n.note" class="mt-0.5 text-[12px] leading-relaxed text-fg-muted">{{ n.note }}</p>
        </div>
      </div>

      <div v-if="plan.edges.length" class="flex flex-wrap gap-1.5 pt-1">
        <span v-for="e in plan.edges" :key="e.id" class="chip font-mono text-[11px]">
          {{ endpointLabel(e.source) }}<template v-if="e.portLabel"> · {{ e.portLabel }}</template> →
          {{ endpointLabel(e.target) }}
        </span>
      </div>
    </div>

    <!-- Dropped items: said out loud, never applied silently. -->
    <div v-if="errors.length" class="rounded-xl border border-dashed p-3" style="border-color: var(--danger)">
      <p class="flex items-center gap-1.5 text-[12px] font-semibold text-danger">
        <Icon name="alert-triangle" :size="14" />
        {{ errors.length }} item{{ errors.length === 1 ? '' : 's' }} dropped
      </p>
      <ul class="mt-1.5 space-y-1">
        <li v-for="(p, i) in errors" :key="i" class="text-[12px] leading-relaxed text-fg-muted">
          <span v-if="p.at" class="font-mono text-fg-subtle">{{ p.at }}</span>
          {{ p.message }}
        </li>
      </ul>
    </div>

    <div v-if="warnings.length" class="rounded-xl border border-dashed p-3">
      <p class="flex items-center gap-1.5 text-[12px] font-semibold text-fg">
        <Icon name="info" :size="14" class="text-fg-subtle" />
        Finish by hand after adding
      </p>
      <ul class="mt-1.5 space-y-1">
        <li v-for="(p, i) in warnings" :key="i" class="text-[12px] leading-relaxed text-fg-muted">
          <span v-if="p.at" class="font-mono text-fg-subtle">{{ p.at }}</span>
          {{ p.message }}
        </li>
      </ul>
    </div>

    <div v-if="plan.notes.length" class="rounded-xl bg-surface-2 p-3">
      <p class="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Notes</p>
      <ul class="mt-1.5 space-y-1">
        <li v-for="(note, i) in plan.notes" :key="i" class="text-[12px] leading-relaxed text-fg-muted">{{ note }}</li>
      </ul>
    </div>
  </div>
</template>
