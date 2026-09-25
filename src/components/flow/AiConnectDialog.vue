<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Modal from '@/components/ui/Modal.vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import CopyBlock from '@/components/ui/CopyBlock.vue'
import {
  mcpClaudeCodeCommand,
  mcpClientConfig,
  mcpEndpoint,
  mcpEndpointIsLoopback,
} from '@/api/mcp'
import { getAuthToken } from '@/api/client'

/**
 * The two ways to drive FloMorphic with an AI, side by side.
 *
 * Both share one property, and it is the reason they are the two on offer:
 * **FloMorphic never holds a provider key**. The model runs where you already
 * pay for it, and this install is either the thing being described to it or the
 * thing it connects to.
 *
 * **Build with AI** — the toolbar action on the canvas. It hands you a prompt
 * built from this install's real node catalog, you run it in whatever assistant
 * you like, and it validates and previews the graph that comes back before a
 * single node is added. Works with no backend at all.
 *
 * **MCP server** — for a client you already have. Point it at this install and
 * it gets the whole API as tools: draft a workflow, run one, read a run's
 * context, configure a node. This is also the only answer to "can I use my
 * Claude Pro / Max or ChatGPT Plus subscription?" — a subscription is not an API
 * key and no endpoint accepts one, but the desktop client you are already signed
 * in to can connect here.
 */

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

type Tab = 'build' | 'mcp'
const tab = ref<Tab>('build')

// Reopening always lands on the first tab: the dialog is read-only help, so
// there is no in-progress state a returning visitor would want restored.
watch(
  () => props.open,
  (open) => {
    if (open) tab.value = 'build'
  },
)

const endpoint = computed(() => mcpEndpoint())
const isLoopback = computed(() => mcpEndpointIsLoopback(endpoint.value))
const hasToken = computed(() => !!getAuthToken())
const clientConfig = computed(() => mcpClientConfig(endpoint.value))
const claudeCommand = computed(() => mcpClaudeCodeCommand(endpoint.value))

const DOCS_URL =
  'https://github.com/FloMorphic/morph-wapp/blob/main/docs/connect-mcp-client.md'

const TABS: { id: Tab; label: string }[] = [
  { id: 'build', label: 'Build with AI' },
  { id: 'mcp', label: 'MCP server' },
]

const stepCls = 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full ' +
  'bg-accent-soft text-[11px] font-semibold text-accent'
</script>

<template>
  <Modal
    :open="open"
    title="Use FloMorphic with an AI"
    subtitle="Two ways in — neither asks this install to hold your API key"
    size="lg"
    @close="emit('close')"
  >
    <!-- Tabs -->
    <div class="mb-4 flex gap-1 border-b border-line">
      <button
        v-for="t in TABS"
        :key="t.id"
        class="border-b-2 px-3 pb-2 text-[13px] font-medium transition-colors"
        :class="tab === t.id ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg'"
        @click="tab = t.id"
      >
        {{ t.label }}
      </button>
    </div>

    <!-- ── Build with AI ────────────────────────────────────────────────── -->
    <div v-if="tab === 'build'" class="flex flex-col gap-4 text-sm">
      <p class="text-fg-muted">
        <strong class="text-fg">AI build</strong> is in the canvas toolbar, at the
        top of the editor. It is the fastest way to get a workflow on screen: you
        describe what you want, run the prompt in whichever assistant you already
        use, and paste back what it gives you.
      </p>

      <div class="flex flex-col gap-3 rounded-lg border border-line bg-surface-2 p-4">
        <div class="flex gap-3">
          <span :class="stepCls">1</span>
          <p class="text-[13px] text-fg-muted">
            Open <strong class="text-fg">AI build</strong> in the toolbar and describe
            the workflow in plain language.
          </p>
        </div>
        <div class="flex gap-3">
          <span :class="stepCls">2</span>
          <p class="text-[13px] text-fg-muted">
            Copy the generated prompt. It already contains this install's real node
            catalog — including any plugins you have added — and a summary of the
            graph currently on the canvas, so the model wires into what is there
            instead of inventing nodes that do not exist here.
          </p>
        </div>
        <div class="flex gap-3">
          <span :class="stepCls">3</span>
          <p class="text-[13px] text-fg-muted">
            Run it in any assistant — a chat window, a desktop app, a subscription
            you already pay for. Paste the JSON it returns into the same dialog.
          </p>
        </div>
        <div class="flex gap-3">
          <span :class="stepCls">4</span>
          <p class="text-[13px] text-fg-muted">
            Review the preview. An unknown node kind or an edge leaving a port that
            does not exist is dropped and named; things a model cannot know — which
            settings profile, which store, which server URL — are listed as warnings
            to fill in. <strong class="text-fg">Nothing is added until you apply it.</strong>
          </p>
        </div>
      </div>

      <div class="rounded-lg border border-line bg-surface-2 p-3 text-[12px] text-fg-muted">
        <div class="mb-1 flex items-center gap-1.5 font-medium text-fg">
          <Icon name="info" :size="14" />
          No key, no backend
        </div>
        Nothing here calls a provider. The model never sees your install, only the
        prompt you carry to it, so this works with a subscription plan and works
        with browser-local persistence and no API configured at all.
      </div>

      <p class="text-[12px] text-fg-subtle">
        Want the assistant to reach into this install directly — read runs, apply
        changes, start a flow — rather than handing you JSON to paste? That is the
        <button class="text-accent hover:underline" @click="tab = 'mcp'">MCP server</button>
        tab.
      </p>

      <div class="flex justify-end pt-1">
        <Button variant="ghost" @click="emit('close')">Done</Button>
      </div>
    </div>

    <!-- ── MCP server ───────────────────────────────────────────────────── -->
    <div v-else class="flex flex-col gap-4 text-sm">
      <p class="text-fg-muted">
        Every FloMorphic API endpoint has a mirror on an <strong class="text-fg">MCP server</strong>
        this install serves. Point an MCP client at it and that client can draft a
        workflow, run one, read a run's context, or configure a node — the same
        surface the REST API exposes, as tools.
      </p>
      <p class="text-fg-muted">
        This is also how you use a <strong class="text-fg">Claude Pro / Max or ChatGPT Plus
        subscription</strong> with FloMorphic. Those plans aren't API keys and no
        endpoint accepts one — but the desktop client you're already signed in to
        can connect here.
      </p>

      <div v-if="!endpoint" class="rounded-lg border border-danger bg-danger-soft p-3 text-[12px]">
        No backend is configured, so there is no MCP server to connect to.
        <strong class="text-fg">Build with AI</strong> works without one.
      </div>

      <template v-else>
        <CopyBlock label="Endpoint (streamable HTTP)" :content="endpoint" max-height="4rem" />

        <div
          v-if="isLoopback"
          class="rounded-lg border border-line bg-surface-2 p-3 text-[12px] text-fg-muted"
        >
          <div class="mb-1 flex items-center gap-1.5 font-medium text-fg">
            <Icon name="info" :size="14" />
            This address only works on the API host
          </div>
          It points at loopback, so a client on another machine can't reach it.
          Swap the host for one that machine can see, and make sure the API is
          listening on it.
        </div>

        <div>
          <CopyBlock
            label="Config — Claude Desktop, Cursor, and most others"
            :content="clientConfig"
            :secret="hasToken"
            filename="flomorphic-mcp.json"
            max-height="12rem"
          />
          <p class="mt-1.5 text-[12px] text-fg-subtle">
            Goes in the client's MCP config file — <code>claude_desktop_config.json</code>
            for Claude Desktop, <code>.cursor/mcp.json</code> for Cursor. Merge the
            <code>flomorphic</code> entry if the file already has servers in it.
            <template v-if="hasToken">
              <strong class="text-fg">This config carries your bearer token</strong> —
              treat it like a password.
            </template>
          </p>
        </div>

        <div>
          <CopyBlock
            label="Claude Code — one command instead"
            :content="claudeCommand"
            :secret="hasToken"
            max-height="6rem"
          />
        </div>

        <p class="text-[12px] text-fg-muted">
          Codex uses TOML rather than JSON, and there are notes on verifying the
          connection and on what not to do (don't edit a flow you have open here;
          don't expose this endpoint unauthenticated) in the full guide:
          <a :href="DOCS_URL" target="_blank" rel="noreferrer" class="text-accent hover:underline">
            connect-mcp-client.md
          </a>
        </p>
      </template>

      <div class="flex justify-end pt-1">
        <Button variant="ghost" @click="emit('close')">Done</Button>
      </div>
    </div>
  </Modal>
</template>
