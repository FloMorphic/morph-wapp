<script setup lang="ts">
import { computed, reactive } from 'vue'
import { nodeRegistryApi } from '@/api/nodeRegistry'
import { parseManual } from '@/lib/manualMarkdown'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'

/**
 * Renders a plugin's Markdown **manual** (its `@intro.manual`) as safe HTML, and
 * upgrades every ```inflow-meta fence into a live **Run** button. Clicking one
 * calls the named meta over the host proxy (nodeRegistryApi.pluginFn, keyed by
 * the inflowv1 plugin id) and shows the raw JSON reply beneath it.
 *
 * The doc author is the meta author, so a fence only carries the method name —
 * no form, no arguments. Metas that need input aren't meant to be exercised
 * here; this is the README's "try it" affordance for read-only helpers.
 */
const props = defineProps<{
  /** The inflowv1 plugin id — what the proxy addresses the meta on. */
  pluginId: string
  /** The Markdown manual from @intro. */
  manual?: string | null
}>()

const blocks = computed(() => parseManual(props.manual ?? ''))

type RunState = { loading: boolean; done: boolean; text: string; error: string }
// Keyed by "<blockIndex>:<method>" so each meta block tracks its own result.
const runs = reactive<Record<string, RunState>>({})

async function run(key: string, method: string) {
  runs[key] = { loading: true, done: false, text: '', error: '' }
  try {
    const res = await nodeRegistryApi.pluginFn(props.pluginId, method)
    runs[key] = { loading: false, done: true, text: pretty(res), error: '' }
  } catch (err) {
    runs[key] = { loading: false, done: false, text: '', error: (err as Error).message }
  }
}

function pretty(v: unknown): string {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}
</script>

<template>
  <div class="manual">
    <template v-for="(b, i) in blocks" :key="i">
      <!-- Prose / code — pre-escaped safe HTML from lib/manualMarkdown. -->
      <div v-if="b.kind === 'html'" class="manual-prose" v-html="b.html" />

      <!-- Callable meta: method + Run button + raw response. -->
      <div v-else class="manual-meta">
        <div class="manual-meta__bar">
          <code class="manual-meta__method">{{ b.method }}</code>
          <Button
            variant="primary"
            icon="play"
            :disabled="runs[`${i}:${b.method}`]?.loading"
            @click="run(`${i}:${b.method}`, b.method)"
          >
            {{ runs[`${i}:${b.method}`]?.loading ? 'Running…' : b.label || 'Run' }}
          </Button>
        </div>

        <p v-if="runs[`${i}:${b.method}`]?.error" class="manual-meta__error">
          <Icon name="alert-triangle" :size="14" />
          {{ runs[`${i}:${b.method}`].error }}
        </p>
        <pre v-else-if="runs[`${i}:${b.method}`]?.done" class="manual-meta__out"><code>{{ runs[`${i}:${b.method}`].text }}</code></pre>
      </div>
    </template>
  </div>
</template>

<style scoped>
.manual {
  font-size: 13px;
  line-height: 1.6;
  color: var(--fg-muted);
}
/* Prose — the renderer emits a plain tag soup, so styling lives here. */
.manual-prose :deep(h1),
.manual-prose :deep(h2),
.manual-prose :deep(h3),
.manual-prose :deep(h4) {
  color: var(--fg);
  font-weight: 600;
  line-height: 1.3;
  margin: 1.2em 0 0.5em;
}
.manual-prose :deep(h1) { font-size: 1.35em; }
.manual-prose :deep(h2) { font-size: 1.2em; }
.manual-prose :deep(h3) { font-size: 1.05em; }
.manual-prose :deep(p) { margin: 0.6em 0; }
.manual-prose :deep(ul),
.manual-prose :deep(ol) { margin: 0.6em 0; padding-left: 1.4em; }
.manual-prose :deep(li) { margin: 0.2em 0; }
.manual-prose :deep(li)::marker { color: var(--fg-subtle); }
.manual-prose :deep(a) { color: var(--accent); text-decoration: underline; }
.manual-prose :deep(strong) { color: var(--fg); font-weight: 600; }
.manual-prose :deep(code) {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.88em;
  background: var(--surface-2);
  border-radius: 4px;
  padding: 0.1em 0.35em;
}
.manual-prose :deep(blockquote) {
  margin: 0.6em 0;
  padding: 0.2em 0 0.2em 0.9em;
  border-left: 3px solid var(--line-strong, var(--surface-2));
  color: var(--fg-subtle);
}
.manual-prose :deep(hr) {
  border: 0;
  border-top: 1px solid var(--line-strong, var(--surface-2));
  margin: 1.2em 0;
}
.manual-prose :deep(.manual-table) {
  display: block;
  width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  margin: 0.8em 0;
  font-size: 0.92em;
}
.manual-prose :deep(.manual-table th),
.manual-prose :deep(.manual-table td) {
  border: 1px solid var(--line-strong, var(--surface-2));
  padding: 0.4em 0.7em;
  text-align: left;
  vertical-align: top;
}
.manual-prose :deep(.manual-table th) {
  background: var(--surface-2);
  color: var(--fg);
  font-weight: 600;
}
.manual-prose :deep(.manual-code) {
  background: var(--surface-2);
  border-radius: 8px;
  padding: 0.8em 1em;
  overflow-x: auto;
  font-size: 0.85em;
  margin: 0.7em 0;
}
.manual-prose :deep(.manual-code code) {
  background: none;
  padding: 0;
  font-family: var(--font-mono, ui-monospace, monospace);
}

/* Callable meta block. */
.manual-meta {
  margin: 0.9em 0;
  border: 1px solid var(--line-strong, var(--surface-2));
  border-radius: 10px;
  padding: 0.7em 0.8em;
  background: var(--surface-2);
}
.manual-meta__bar {
  display: flex;
  align-items: center;
  gap: 0.6em;
  flex-wrap: wrap;
}
.manual-meta__method {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.85em;
  color: var(--fg);
  overflow-wrap: anywhere;
}
.manual-meta__error {
  display: flex;
  align-items: center;
  gap: 0.4em;
  margin: 0.6em 0 0;
  color: var(--danger);
  font-size: 0.9em;
}
.manual-meta__out {
  margin: 0.6em 0 0;
  max-height: 22rem;
  overflow: auto;
  background: var(--surface-1, var(--bg));
  border-radius: 8px;
  padding: 0.7em 0.9em;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.82em;
  color: var(--fg);
  white-space: pre;
}
</style>
