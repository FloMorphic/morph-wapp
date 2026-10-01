<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { queryJsonPath, JsonPathError, type PathMatch } from '@/lib/jsonpath'
import { useNotificationsStore } from '@/stores/notifications'
import { readValue, writeValue } from '@/lib/localStore'

/** A labelled expression the host offers as a one-click jump. */
interface QueryShortcut {
  /** What the button reads — short, since it sits in the query row. */
  label: string
  /** The expression the button puts in the input. */
  query: string
  /** Tooltip, where the label alone doesn't say what the jump means. */
  hint?: string
}

/**
 * A JSONPath probe over a context document. A designer types the same
 * `{{$.path}}` expression a node carries in its template and sees, against a
 * real document, exactly which values resolve — the *scope* that node reads
 * from the context. Supports child/index selectors, `*` wildcards, `..`
 * recursive descent, slices and unions; filters are out of scope by design
 * (see `lib/jsonpath.ts`). Purely a read-only lens — it never mutates `root`.
 */
const props = defineProps<{
  /** The parsed context (or header) to evaluate against; null while invalid. */
  root: unknown
  /**
   * Expression to start from — the scope of the node being inspected, when the
   * probe is opened from the canvas. Editable from there on: the seed is a
   * starting point for exploring, not a lock.
   */
  initialQuery?: string
  /** Placeholder override, for hosts that want to name what they seeded. */
  placeholder?: string
  /**
   * Give the results panel a dragged height instead of a fixed cap. For a host
   * with room to spare (the node scope dialog) — a page that already scrolls
   * (the context view) is better off with the cap, or the panel would push the
   * document panels below the fold.
   */
  resizable?: boolean
  /**
   * One-click expressions to jump the probe to, rendered as tiny buttons beside
   * the input. The host decides what is worth a button — the node scope dialog
   * offers the node's own scope and that scope plus the node's result key, so
   * reading what a node *writes* is a click rather than a retype.
   */
  shortcuts?: readonly QueryShortcut[]
}>()

const notifications = useNotificationsStore()

const query = ref(props.initialQuery ?? '')

// Reseed when the host points the probe at another expression (e.g. the canvas
// dialog switching to a different node) without remounting it.
watch(
  () => props.initialQuery,
  (next) => {
    query.value = next ?? ''
  },
)

/** The literal template syntax, kept out of the mustache so the compiler
 * doesn't read its `{{` as a nested interpolation. */
const TEMPLATE_HINT = '{{$.path}}'

interface Result {
  matches: PathMatch[]
  error: string | null
}

const result = computed<Result>(() => {
  if (props.root === null || props.root === undefined) {
    return { matches: [], error: null }
  }
  if (!query.value.trim()) {
    return { matches: [], error: null }
  }
  try {
    return { matches: queryJsonPath(props.root, query.value), error: null }
  } catch (e) {
    if (e instanceof JsonPathError) return { matches: [], error: e.message }
    return { matches: [], error: (e as Error).message }
  }
})

const active = computed(() => !!query.value.trim())

/** A shortcut reads as pressed while the probe is sitting on its expression, so
 *  the set works as a toggle between the expressions the host named. */
function shortcutActive(s: QueryShortcut): boolean {
  return query.value.trim() === s.query.trim()
}

type JsonType = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object'

function typeOf(v: unknown): JsonType {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v as JsonType
}

/** The matched value rendered as it would read in the document: strings quoted,
 * objects and arrays pretty-printed across lines. */
function formatValue(v: unknown): string {
  return JSON.stringify(v, null, 2) ?? String(v)
}

/** Per-type accent for the value block, matching the tree view's palette. */
const typeClass: Record<JsonType, string> = {
  string: 'text-emerald-600 dark:text-emerald-400',
  number: 'text-pink-600 dark:text-pink-400',
  boolean: 'text-sky-600 dark:text-sky-400',
  null: 'text-fg-subtle',
  array: 'text-amber-600 dark:text-amber-400',
  object: 'text-violet-600 dark:text-violet-400',
}

// ---- Resizable results panel ----------------------------------------------
// Same grip idiom as the settings drawer and the log drawer: drag to size,
// clamped, and persisted so the height a designer settled on survives the next
// dialog and the next session. Double-click the grip to go back to the default.
const DEFAULT_HEIGHT = 340
const MIN_HEIGHT = 140
const HEIGHT_KEY = 'jsonPathResults.height'

/** Leave room for the query bar and the dialog's own chrome. */
function maxHeight(): number {
  return Math.max(MIN_HEIGHT, window.innerHeight - 260)
}

function clampHeight(h: number): number {
  return Math.min(maxHeight(), Math.max(MIN_HEIGHT, h))
}

function loadHeight(): number {
  const saved = readValue<number>(HEIGHT_KEY, DEFAULT_HEIGHT)
  return clampHeight(Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_HEIGHT)
}

const panelHeight = ref(loadHeight())
const resizing = ref(false)
let startY = 0
let startHeight = 0

function onResizeMove(e: MouseEvent) {
  // Grip sits under the panel, so dragging down grows it.
  panelHeight.value = clampHeight(startHeight + (e.clientY - startY))
}

function stopResize() {
  if (!resizing.value) return
  resizing.value = false
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', stopResize)
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
  writeValue(HEIGHT_KEY, panelHeight.value)
}

function startResize(e: MouseEvent) {
  e.preventDefault()
  resizing.value = true
  startY = e.clientY
  startHeight = panelHeight.value
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', stopResize)
  // Suppress text selection / cursor flicker while dragging over the values.
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'ns-resize'
}

function resetHeight() {
  panelHeight.value = clampHeight(DEFAULT_HEIGHT)
  writeValue(HEIGHT_KEY, panelHeight.value)
}

// A window that shrank can leave the panel taller than the viewport it was sized
// in, so re-clamp rather than trap the rest of the dialog below the fold.
function onWindowResize() {
  panelHeight.value = clampHeight(panelHeight.value)
}
window.addEventListener('resize', onWindowResize)

onBeforeUnmount(() => {
  stopResize()
  window.removeEventListener('resize', onWindowResize)
})

/** Copy the whole result: the lone value when there's one match, else the
 * values as a JSON array — the shape the runtime would hand a node. */
function copyResult() {
  const vals = result.value.matches.map((m) => m.value)
  const payload = vals.length === 1 ? vals[0] : vals
  copy(JSON.stringify(payload, null, 2), 'Result')
}

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    notifications.notify({ level: 'success', message: `${label} copied.` })
  } catch {
    notifications.notify({ level: 'error', message: 'Could not access the clipboard.' })
  }
}

/** Copy every matched path as one newline-joined block — the scope, listed. */
function copyAllPaths() {
  copy(result.value.matches.map((m) => m.path).join('\n'), 'Paths')
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <div class="flex items-center gap-1.5">
      <div class="relative flex min-w-0 flex-1 items-center">
        <Icon name="search" :size="14" class="pointer-events-none absolute left-2.5 text-fg-subtle" />
        <input
          v-model="query"
          spellcheck="false"
          autocapitalize="off"
          autocomplete="off"
          class="input min-w-0 flex-1 !pl-8 font-mono text-[13px]"
          :class="result.error ? '!border-danger' : ''"
          :placeholder="placeholder ?? 'JSONPath — e.g. $.llm.messages[*].role  ·  $..author'"
        />
        <span
          v-if="active && !result.error"
          class="absolute right-2.5 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold text-fg-muted"
        >
          {{ result.matches.length }} match{{ result.matches.length === 1 ? '' : 'es' }}
        </span>
      </div>

      <!-- Host-offered jumps, outside the input so the match badge keeps its
           corner. Pressed state marks the one the probe is currently on. -->
      <button
        v-for="s in shortcuts ?? []"
        :key="s.query"
        type="button"
        class="max-w-[9rem] shrink-0 truncate rounded-lg border px-2 py-[7px] font-mono text-[12px] transition-colors"
        :class="
          shortcutActive(s)
            ? 'border-accent bg-accent-soft text-accent'
            : 'border-[var(--line-strong)] text-fg-muted hover:border-accent hover:text-accent'
        "
        :title="s.hint ?? `Probe ${s.query}`"
        @click="query = s.query"
      >
        {{ s.label }}
      </button>
    </div>

    <p v-if="result.error" class="px-1 text-[12px] text-danger">{{ result.error }}</p>

    <template v-else-if="active">
      <div class="flex items-center justify-between px-1">
        <span class="text-[11px] text-fg-subtle">
          Resolves against this context the way a node’s <code class="font-mono">{{ TEMPLATE_HINT }}</code> template does.
        </span>
        <div v-if="result.matches.length" class="flex items-center gap-3">
          <button
            class="flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
            @click="copyResult"
          >
            <Icon name="copy" :size="12" /> Copy result
          </button>
          <button
            class="flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
            @click="copyAllPaths"
          >
            <Icon name="copy" :size="12" /> Copy paths
          </button>
        </div>
      </div>

      <p
        v-if="result.matches.length === 0"
        class="rounded-lg bg-surface-2 px-3 py-2 text-[12px] text-fg-muted"
      >
        No match in this document — nothing here for a node to read at that path.
      </p>

      <div
        v-else
        class="space-y-2 overflow-auto rounded-lg border bg-surface-2/40 p-2"
        :class="resizable ? '' : 'max-h-72'"
        :style="resizable ? { height: `${panelHeight}px` } : undefined"
      >
        <div
          v-for="(m, i) in result.matches"
          :key="i"
          class="overflow-hidden rounded-md border border-line/60 bg-surface"
        >
          <div class="flex items-center gap-2 border-b border-line/60 px-2.5 py-1 font-mono text-[12px]">
            <button
              class="min-w-0 truncate text-accent hover:underline"
              title="Copy this path"
              @click="copy(m.path, 'Path')"
            >
              {{ m.path }}
            </button>
            <span
              class="ml-auto shrink-0 rounded px-1 text-[10px] font-semibold lowercase"
              :class="typeClass[typeOf(m.value)]"
            >
              {{ typeOf(m.value) }}
            </span>
            <button
              class="shrink-0 text-fg-subtle hover:text-accent"
              title="Copy this value"
              @click="copy(formatValue(m.value), 'Value')"
            >
              <Icon name="copy" :size="12" />
            </button>
          </div>
          <pre
            class="overflow-auto whitespace-pre-wrap break-words px-2.5 py-1.5 font-mono text-[12px] leading-relaxed"
            :class="[typeClass[typeOf(m.value)], resizable ? '' : 'max-h-48']"
          >{{ formatValue(m.value) }}</pre>
        </div>
      </div>

      <!-- Drag grip: sizes the panel above it. Only where the host has the room
           to give (see the `resizable` prop). -->
      <div
        v-if="resizable && result.matches.length"
        class="group flex h-3 cursor-ns-resize items-center justify-center"
        title="Drag to resize · double-click to reset"
        @mousedown="startResize"
        @dblclick="resetHeight"
      >
        <span
          class="h-1 w-16 rounded-full transition-colors"
          :class="resizing ? 'bg-[var(--accent)]' : 'bg-[var(--line-strong)] group-hover:bg-[var(--accent)]/60'"
        />
      </div>
    </template>
  </div>
</template>
