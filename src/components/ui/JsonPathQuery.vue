<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { queryJsonPath, JsonPathError, type PathMatch } from '@/lib/jsonpath'
import { useNotificationsStore } from '@/stores/notifications'

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
}>()

const notifications = useNotificationsStore()

const query = ref('')

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
    <div class="relative flex items-center">
      <Icon name="search" :size="14" class="pointer-events-none absolute left-2.5 text-fg-subtle" />
      <input
        v-model="query"
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        class="input min-w-0 flex-1 !pl-8 font-mono text-[13px]"
        :class="result.error ? '!border-danger' : ''"
        placeholder="JSONPath — e.g. $.llm.messages[*].role  ·  $..author"
      />
      <span
        v-if="active && !result.error"
        class="absolute right-2.5 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold text-fg-muted"
      >
        {{ result.matches.length }} match{{ result.matches.length === 1 ? '' : 'es' }}
      </span>
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

      <div v-else class="max-h-72 space-y-2 overflow-auto rounded-lg border bg-surface-2/40 p-2">
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
            class="max-h-48 overflow-auto whitespace-pre-wrap break-words px-2.5 py-1.5 font-mono text-[12px] leading-relaxed"
            :class="typeClass[typeOf(m.value)]"
          >{{ formatValue(m.value) }}</pre>
        </div>
      </div>
    </template>
  </div>
</template>
