<script setup lang="ts">
/**
 * Settings → Database: which database the backend persists to, and moving it.
 *
 * SQLite is the default and is enough for a single-node install. A deployment
 * that outgrows it (several API replicas, an existing managed postgres, ops who
 * run their own backup and replication) pastes a connection URI here instead of
 * editing the backend's environment and redeploying.
 *
 * The flow is deliberately two-step — **Test** then **Switch** — because the
 * two questions are different: "can this instance reach that database and write
 * to it?" is answerable without consequences, while switching moves live
 * persistence. Test creates nothing in the target, so probing a mistyped URI
 * leaves no trace in whatever database it hit.
 *
 * Switching copies **no data**: the backend continues against whatever the
 * target already holds (its schema is created and the builtin palette seeded as
 * on any first run). That is the one thing this panel has to say plainly, so it
 * is in the confirm text as well as on screen.
 */
import { computed, onMounted, ref } from 'vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import { databaseApi } from '@/api/database'
import type { DatabaseProbe, DatabaseState } from '@/types/api'

const remote = databaseApi.isRemote()

const state = ref<DatabaseState | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

/** The form's target. `source` starts empty rather than pre-filled with the
 *  live one: the live source comes back with its password masked, so offering it
 *  for editing would invite submitting `***` as a credential. */
const form = ref({ driver: '', source: '' })
const probe = ref<DatabaseProbe | null>(null)
/** Which action is in flight ('test' | 'switch' | 'reset'), so only the button
 *  pressed shows its pending label. */
const busy = ref<string | null>(null)

const liveDriver = computed(() => state.value?.driver ?? '')
const isPostgres = computed(() => form.value.driver === 'postgres')
/** Both actions need a source. Even sqlite is required to name one rather than
 *  falling back to a relative path in whatever directory the API was started
 *  from — going back to the deployment's own database is what "Reset to backend
 *  default" is for, and it is unambiguous. */
const canSubmit = computed(() => !!form.value.source.trim())

const sourcePlaceholder = computed(() =>
  isPostgres.value
    ? 'postgres://user:password@host:5432/flomorphic?sslmode=disable'
    : 'db/flomorphic.db — a path on the API host',
)

async function load() {
  if (!remote) return
  loading.value = true
  error.value = null
  try {
    state.value = await databaseApi.state()
    if (!form.value.driver) form.value.driver = pickDefaultDriver(state.value)
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

/** Default the form to the driver the operator is most likely moving *to*: the
 *  other one, when there are exactly two. */
function pickDefaultDriver(s: DatabaseState): string {
  const others = (s.drivers ?? []).filter((d) => d !== s.driver)
  return others[0] ?? s.driver
}

async function run(key: string, action: () => Promise<void>) {
  busy.value = key
  error.value = null
  try {
    await action()
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    busy.value = null
  }
}

const test = () =>
  run('test', async () => {
    probe.value = await databaseApi.test({
      driver: form.value.driver,
      source: form.value.source.trim(),
    })
  })

/** What the switch does to vector memory, stated in the confirm because it is
 *  the one part that does NOT follow the driver: embeddings are indexed by
 *  sqlite-vec whichever database is live, so they neither move nor break — and
 *  someone who presses Switch without pressing Test first has read nothing
 *  about them otherwise. */
function vectorNote(): string {
  const src = state.value?.vectorSource
  if (!src) {
    return 'Vector memory is off on this instance, so vector stores cannot be created after the switch.'
  }
  return (
    `Vector indexes do not move — they stay in sqlite-vec at ${src}. ` +
    'Stores created after the switch index into that same file, and stores created before it ' +
    'reappear if you switch back.'
  )
}

function confirmSwitch(): boolean {
  const to = form.value.source.trim()
  return window.confirm(
    `Move FloMorphic to ${form.value.driver}?\n\n${to}\n\n` +
      'No data is copied. The app will show whatever that database already ' +
      'contains — an empty one starts empty.\n\n' +
      vectorNote(),
  )
}

const switchTo = () =>
  run('switch', async () => {
    if (!confirmSwitch()) return
    state.value = await databaseApi.switchTo({
      driver: form.value.driver,
      source: form.value.source.trim(),
    })
    form.value.source = ''
    probe.value = null
    form.value.driver = pickDefaultDriver(state.value)
  })

const reset = () =>
  run('reset', async () => {
    if (
      !window.confirm(
        "Go back to the backend's own database (its DB_DRIVER / DB_SOURCE)?\n\n" +
          'The saved selection is deleted. No data is copied.',
      )
    )
      return
    state.value = await databaseApi.reset()
    probe.value = null
    form.value.driver = pickDefaultDriver(state.value)
  })

onMounted(load)

/** Epoch ms → a short local timestamp for the "saved from here" line. */
function savedAt(ms?: number): string {
  if (!ms) return ''
  return new Date(ms).toLocaleString()
}
</script>

<template>
  <section class="card p-5">
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <h2 class="text-sm font-semibold text-fg">Database</h2>
        <span
          v-if="state"
          class="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          :style="{ background: 'var(--accent-soft)', color: 'var(--accent)' }"
        >
          {{ state.driver }}
        </span>
        <span
          v-if="state?.origin === 'panel'"
          class="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          :style="{ background: 'var(--surface-2)', color: 'var(--fg-muted)' }"
          :title="state.updatedAt ? `Selected here on ${savedAt(state.updatedAt)}` : 'Selected from this panel'"
        >
          set here
        </span>
      </div>
      <button
        v-if="remote"
        class="flex items-center gap-1 text-[12px] text-fg-muted transition-colors hover:text-fg disabled:opacity-50"
        :disabled="!!busy || loading"
        title="Re-check the live database"
        @click="load"
      >
        <Icon name="refresh" :size="13" :class="{ 'animate-spin': loading }" />
        Refresh
      </button>
    </div>
    <p class="mb-4 mt-1 text-[13px] text-fg-muted">
      Where the backend persists workflows, contexts, runs and the rest. SQLite is the default and needs no server;
      point it at <span class="font-medium">postgres</span> when you outgrow a single node.
    </p>

    <div v-if="!remote" class="rounded-lg border bg-surface-2 px-4 py-3 text-[13px] text-fg-muted">
      Connect a backend to manage its database.
    </div>

    <template v-else>
      <div v-if="loading && !state" class="rounded-lg border bg-surface-2 px-4 py-3 text-[13px] text-fg-muted">
        Checking the database…
      </div>

      <template v-else-if="state">
        <!-- Live database -->
        <div class="rounded-lg border bg-surface-2 px-4 py-3">
          <div class="flex items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-2.5">
              <span
                class="h-2 w-2 shrink-0 rounded-full"
                :style="{ background: state.connected ? 'var(--success)' : 'var(--danger)' }"
              />
              <span class="shrink-0 text-sm font-medium text-fg">
                {{ state.connected ? 'Connected' : 'Not answering' }}
              </span>
              <code class="truncate font-mono text-xs text-fg-muted" :title="state.source">{{ state.source }}</code>
            </div>
            <span class="shrink-0 text-[11px] text-fg-subtle">{{ state.latencyMs }} ms</span>
          </div>
          <p v-if="state.error" class="mt-2 break-all text-xs text-danger">{{ state.error }}</p>

          <dl class="mt-3 space-y-1.5 border-t pt-3 text-[12px]">
            <div class="flex items-start gap-2">
              <dt class="w-28 shrink-0 text-fg-subtle">Selection</dt>
              <dd class="min-w-0 text-fg-muted">
                <span>{{ state.origin === 'panel' ? 'saved from this panel' : "the backend's own environment" }}</span>
                <code
                  v-if="state.origin === 'panel' && state.configFile"
                  class="block truncate font-mono text-[11px] text-fg-subtle"
                  :title="state.configFile"
                >
                  {{ state.configFile }}
                </code>
              </dd>
            </div>
            <div class="flex items-start gap-2">
              <dt class="w-28 shrink-0 text-fg-subtle">Vector index</dt>
              <dd class="min-w-0 text-fg-muted">
                <template v-if="state.vectorSource">
                  <code class="block truncate font-mono text-[11px]" :title="state.vectorSource">
                    {{ state.vectorSource }}
                  </code>
                  <span class="text-[11px] text-fg-subtle">sqlite-vec, whichever driver is live</span>
                </template>
                <span v-else class="text-fg-subtle">off — vector memory stores cannot be created</span>
              </dd>
            </div>
            <div v-if="state.localEntities?.length" class="flex items-start gap-2">
              <dt class="w-28 shrink-0 text-fg-subtle">Kept in sqlite</dt>
              <dd class="flex min-w-0 flex-wrap gap-1">
                <span
                  v-for="e in state.localEntities"
                  :key="e"
                  class="rounded px-1.5 py-0.5 font-mono text-[10px]"
                  :style="{ background: 'var(--surface-2)', color: 'var(--fg-muted)' }"
                >
                  {{ e }}
                </span>
                <span class="text-[11px] text-fg-subtle">· the backend's DB_LOCAL_TABLES</span>
              </dd>
            </div>
          </dl>
        </div>

        <!-- Move to another database -->
        <div
          v-if="state.switchable"
          class="mt-4 space-y-2 rounded-lg border p-3"
          style="border-color: var(--line-strong)"
        >
          <p class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Move to another database</p>

          <div class="grid gap-2 sm:grid-cols-[10rem_1fr]">
            <select v-model="form.driver" class="input" @change="probe = null">
              <option v-for="d in state.drivers" :key="d" :value="d">{{ d }}</option>
            </select>
            <input
              v-model="form.source"
              class="input font-mono text-xs"
              :placeholder="sourcePlaceholder"
              spellcheck="false"
              autocomplete="off"
              @input="probe = null"
              @keyup.enter="test"
            />
          </div>
          <p class="text-[11px] text-fg-subtle">
            <template v-if="isPostgres">
              The password goes in the URI and is stored on the API host (never sent back here). Special characters do
              not need escaping — <code class="font-mono">@</code> in a password is handled.
            </template>
            <template v-else>A path on the API host; its parent directory is created if missing.</template>
          </p>

          <div class="flex flex-wrap items-center gap-2 pt-1">
            <Button icon="activity" :disabled="!!busy || !canSubmit" @click="test">
              {{ busy === 'test' ? 'Testing…' : 'Test connection' }}
            </Button>
            <Button icon="database" variant="primary" :disabled="!!busy || !canSubmit" @click="switchTo">
              {{ busy === 'switch' ? 'Switching…' : 'Switch' }}
            </Button>
            <button
              v-if="state.origin === 'panel'"
              class="ml-auto text-[12px] text-fg-muted underline-offset-2 transition-colors hover:text-fg hover:underline disabled:opacity-50"
              :disabled="!!busy"
              title="Forget the saved selection and use the backend's own DB_DRIVER / DB_SOURCE"
              @click="reset"
            >
              {{ busy === 'reset' ? 'Resetting…' : 'Reset to backend default' }}
            </button>
          </div>

          <!-- Probe result -->
          <div
            v-if="probe"
            class="mt-2 rounded-lg border px-3 py-2.5"
            :style="
              probe.ok && probe.writable
                ? { borderColor: 'var(--accent-border)', background: 'var(--accent-soft)' }
                : { borderColor: 'var(--danger)' }
            "
          >
            <div class="flex items-center gap-2">
              <Icon
                :name="probe.ok && probe.writable ? 'check' : 'alert-triangle'"
                :size="14"
                :style="{ color: probe.ok && probe.writable ? 'var(--accent)' : 'var(--danger)' }"
              />
              <span class="text-[13px] font-medium text-fg">
                <template v-if="!probe.ok">Cannot be used</template>
                <template v-else-if="!probe.writable">Reachable, but not writable</template>
                <template v-else>Ready to use</template>
              </span>
              <code v-if="probe.server" class="truncate font-mono text-[11px] text-fg-muted">{{ probe.server }}</code>
            </div>
            <p v-if="probe.error" class="mt-1.5 break-all text-xs text-danger">{{ probe.error }}</p>
            <ul v-if="probe.notes?.length" class="mt-1.5 space-y-1">
              <li v-for="(n, i) in probe.notes" :key="i" class="flex gap-1.5 text-[12px] text-fg-muted">
                <Icon name="info" :size="12" class="mt-0.5 shrink-0 text-fg-subtle" />
                <span class="break-words">{{ n }}</span>
              </li>
            </ul>
            <p v-if="probe.ok && !probe.vector" class="mt-1.5 flex gap-1.5 text-[12px] text-fg-muted">
              <Icon name="alert-triangle" :size="12" class="mt-0.5 shrink-0" style="color: var(--warning)" />
              <span>Vector memory will be unavailable on this database.</span>
            </p>
          </div>

          <p class="flex gap-1.5 border-t pt-2 text-[12px] text-fg-muted">
            <Icon name="info" :size="12" class="mt-0.5 shrink-0 text-fg-subtle" />
            <span>
              Switching takes effect immediately — no restart — and <span class="font-medium">copies no data</span>. The
              app then shows whatever the target database holds; moving existing rows is a separate step. Vector indexes
              are the exception: they stay in sqlite-vec
              <template v-if="state.vectorSource">at the file above</template>
              <template v-else>(currently off)</template>
              whichever driver is live.
            </span>
          </p>
        </div>

        <div v-else class="mt-4 rounded-lg border bg-surface-2 px-4 py-3 text-[13px] text-fg-muted">
          This backend cannot switch databases at run time — set its
          <code class="font-mono text-xs">DB_DRIVER</code> / <code class="font-mono text-xs">DB_SOURCE</code> and
          restart it.
        </div>
      </template>

      <p v-if="error" class="mt-3 break-all text-xs text-danger">{{ error }}</p>
    </template>
  </section>
</template>
