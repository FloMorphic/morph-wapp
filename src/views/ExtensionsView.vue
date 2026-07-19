<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useExtensionsStore } from '@/stores/extensions'
import type { EnvVar, ExtensionStatus, ProjectExtension } from '@/types/api'
import PageShell from '@/components/ui/PageShell.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'

const store = useExtensionsStore()
onMounted(() => store.refresh())

const showAdd = ref(false)
const submitting = ref(false)
const formError = ref<string | null>(null)

const form = reactive<{ name: string; repo: string; ref: string; description: string; env: EnvVar[] }>({
  name: '',
  repo: '',
  ref: 'main',
  description: '',
  env: [{ key: '', value: '' }],
})

function resetForm() {
  form.name = ''
  form.repo = ''
  form.ref = 'main'
  form.description = ''
  form.env = [{ key: '', value: '' }]
  formError.value = null
}

function openAdd() {
  resetForm()
  showAdd.value = true
}

function addEnvRow() {
  form.env.push({ key: '', value: '' })
}
function removeEnvRow(i: number) {
  form.env.splice(i, 1)
}

// Derive a friendly name from a repo URL if the user leaves name blank.
function repoName(repo: string): string {
  return repo.replace(/\.git$/, '').split('/').filter(Boolean).pop() ?? ''
}

async function submit() {
  formError.value = null
  const repo = form.repo.trim()
  if (!/^https?:\/\/.+\/.+/.test(repo) && !/^git@.+:.+/.test(repo)) {
    formError.value = 'Enter a valid git repository URL.'
    return
  }
  submitting.value = true
  try {
    await store.add({
      name: form.name.trim() || repoName(repo),
      repo,
      ref: form.ref.trim() || 'main',
      description: form.description.trim(),
      env: form.env.filter((e) => e.key.trim()),
    })
    showAdd.value = false
  } catch (err) {
    formError.value = (err as Error).message
  } finally {
    submitting.value = false
  }
}

async function remove(ext: ProjectExtension) {
  if (!window.confirm(`Remove "${ext.name}"? Its running process will be stopped.`)) return
  await store.remove(ext.id)
}

function toggleRun(ext: ProjectExtension) {
  const next: ExtensionStatus = ext.status === 'running' ? 'stopped' : 'running'
  store.setStatus(ext.id, next)
}

const statusStyle: Record<ExtensionStatus, { label: string; color: string }> = {
  registered: { label: 'Registered', color: 'var(--fg-subtle)' },
  installing: { label: 'Installing', color: 'var(--warning)' },
  running: { label: 'Running', color: 'var(--success)' },
  stopped: { label: 'Stopped', color: 'var(--fg-subtle)' },
  error: { label: 'Error', color: 'var(--danger)' },
}
</script>

<template>
  <PageShell
    title="Extensions"
    subtitle="Bring capabilities into this project from source. FloMorphic clones the repo and runs it with your env so it joins the inflow ecosystem — then its plugin nodes appear in the workflow palette."
  >
    <template #actions>
      <Button variant="primary" icon="plus" @click="openAdd">Add extension</Button>
    </template>

    <div class="mb-6 flex items-start gap-3 rounded-xl border border-dashed bg-surface-2 px-4 py-3 text-[13px] text-fg-muted">
      <span class="mt-0.5 text-accent"><Icon name="info" :size="16" /></span>
      <p>
        An extension is a Git repository implementing the InflowV1 protocol. On add, the backend clones it, installs it
        and runs it with the environment you provide so it can connect to inflow over NATS. Each running extension
        contributes ready-made <span class="font-medium text-fg">Plugin</span> nodes to the canvas.
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
      description="Add one from a GitHub repository to bring its nodes into your workflows."
    >
      <Button variant="primary" icon="plus" @click="openAdd">Add extension</Button>
    </EmptyState>

    <div v-else class="grid gap-4 sm:grid-cols-2">
      <div v-for="ext in store.items" :key="ext.id" class="card flex flex-col p-4">
        <div class="flex items-start justify-between gap-2">
          <div class="flex min-w-0 items-center gap-2.5">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <Icon name="plugin" :size="18" />
            </span>
            <div class="min-w-0">
              <h3 class="truncate font-semibold text-fg">{{ ext.name }}</h3>
              <span class="inline-flex items-center gap-1.5 text-[11px] font-medium" :style="{ color: statusStyle[ext.status].color }">
                <span class="h-1.5 w-1.5 rounded-full" :style="{ background: statusStyle[ext.status].color }" />
                {{ statusStyle[ext.status].label }}
              </span>
            </div>
          </div>
          <button class="rounded-lg p-1.5 text-fg-subtle hover:bg-danger-soft hover:text-danger" title="Remove" @click="remove(ext)">
            <Icon name="trash" :size="15" />
          </button>
        </div>

        <p v-if="ext.description" class="mt-3 line-clamp-2 text-[13px] text-fg-muted">{{ ext.description }}</p>

        <div class="mt-3 flex items-center gap-1.5 truncate font-mono text-[11px] text-fg-subtle">
          <Icon name="external-link" :size="13" />
          <span class="truncate">{{ ext.repo }}</span>
          <span class="shrink-0 rounded bg-surface-2 px-1.5 py-0.5">{{ ext.ref }}</span>
        </div>

        <div class="mt-4 flex items-center gap-2 border-t pt-3">
          <Button :icon="ext.status === 'running' ? 'x' : 'play'" @click="toggleRun(ext)">
            {{ ext.status === 'running' ? 'Stop' : 'Start' }}
          </Button>
          <span class="ml-auto text-[11px] text-fg-subtle">{{ ext.env.length }} env var{{ ext.env.length === 1 ? '' : 's' }}</span>
        </div>
      </div>
    </div>

    <!-- Add extension modal -->
    <Modal :open="showAdd" title="Add extension" subtitle="From a Git repository implementing InflowV1." @close="showAdd = false">
      <div class="space-y-4">
        <div class="space-y-1">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Repository URL</label>
          <input v-model="form.repo" class="input font-mono text-xs" placeholder="https://github.com/org/inflow-plugin-x" />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Name</label>
            <input v-model="form.name" class="input" placeholder="auto from repo" />
          </div>
          <div class="space-y-1">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Ref (branch / tag)</label>
            <input v-model="form.ref" class="input" placeholder="main" />
          </div>
        </div>

        <div class="space-y-1">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Description</label>
          <input v-model="form.description" class="input" placeholder="What this extension provides" />
        </div>

        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Environment</label>
            <button class="flex items-center gap-1 text-[12px] text-accent hover:underline" @click="addEnvRow">
              <Icon name="plus" :size="13" /> Add var
            </button>
          </div>
          <div v-for="(row, i) in form.env" :key="i" class="flex items-center gap-2">
            <input v-model="row.key" class="input flex-1 font-mono text-xs" placeholder="KEY" />
            <input v-model="row.value" class="input flex-1 font-mono text-xs" placeholder="value" />
            <button class="shrink-0 rounded-lg p-1.5 text-fg-subtle hover:bg-danger-soft hover:text-danger" @click="removeEnvRow(i)">
              <Icon name="x" :size="15" />
            </button>
          </div>
          <p class="text-[11px] text-fg-subtle">Passed to the extension process (secrets, connection strings, inflow credentials).</p>
        </div>

        <p v-if="formError" class="text-sm text-danger">{{ formError }}</p>
      </div>

      <template #footer>
        <Button @click="showAdd = false">Cancel</Button>
        <Button variant="primary" icon="plus" :disabled="submitting" @click="submit">
          {{ submitting ? 'Adding…' : 'Add extension' }}
        </Button>
      </template>
    </Modal>
  </PageShell>
</template>
