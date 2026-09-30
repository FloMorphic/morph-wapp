<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import type { GraphNode } from '@vue-flow/core'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import PromptImporter from '@/components/flow/PromptImporter.vue'
import PromptExpander from '@/components/flow/PromptExpander.vue'
import type { BaseNodeData } from '@/data/nodeCatalog'
import { connectApi, ocAccountActive, ocAccountLabel, type OcAccount } from '@/api/connect'
import { hitlApi } from '@/api/hitl'
import type {
  ConnectConnection,
  TelegramBotProfile,
  TelegramRecipient,
  TelegramWebhookInfo,
} from '@/types/api'
import {
  DEFAULT_HITL_PROMPT,
  HITL_CHANNELS,
  HITL_MODES,
  migrateHitlData,
  type HitlChannel,
  type HitlMode,
} from '@/lib/hitl'

/**
 * Settings editor for the Human-in-the-Loop node.
 *
 * Everything here is authored at design time and shipped whole to the backend
 * `hitl` service as the node's compile-time operation payload (`op`) — which the
 * runtime resolves before the svc handler ever sees it: any `{{$.path}}` in the
 * payload is filled in from the run's context first. So the prompt written here
 * arrives at the handler as real text and is recorded ready to show a person.
 *
 * The three things a designer decides:
 *
 *   mode      park → the handler answers with a `stop` command and the run
 *             finishes at this node; the flow resumes from every captured next
 *             node once the session is closed. continue → the handler only
 *             records the task and answers plainly, so the flow carries on.
 *   prompt    what the session has to establish with the person, embedding
 *             `{{$.path}}` variables that pull in whatever the flow built up to
 *             here (an MCP/LLM message stack, the point it got stuck on). There
 *             is no question list beside it: a node is reached precisely because
 *             the flow could not settle something, so the questions are worked
 *             out in the session, not written on the canvas.
 *   channel   where the conversation happens. `direct` is the in-app chat
 *             (Operate → Human Tasks). `telegram` is the same conversation held
 *             in a Telegram chat: the backend bridge opens it, the person answers
 *             on their phone, and every turn is still mirrored onto the task —
 *             so it needs a delivery binding, which is what the Telegram panel
 *             below collects. WhatsApp has no bridge yet.
 *
 * The values live on the node's own `data` (`mode` / `prompt` / `channel`, plus
 * `telegram*` for a Telegram binding) — the shape the node catalog's `hitl` spec
 * declares and `buildHitlNode` compiles.
 *
 * Nothing here holds a credential. A Telegram session runs as a bot CONNECTED IN
 * OPENCONNECTOR, reached through a stored Connect connection, so the node names a
 * connection + a bot alias + a chat and the token stays on the gateway. That is
 * also why the bot list is fetched live rather than typed: a binding is only
 * worth offering if the gateway will actually honour it at run time.
 */
const props = defineProps<{ node: GraphNode }>()

function data(): BaseNodeData {
  return props.node.data as BaseNodeData
}

// Clear the fields earlier versions of this editor wrote (see migrateHitlData).
onMounted(() => migrateHitlData(data()))

// ---- Mode -------------------------------------------------------------------

const mode = computed<HitlMode>({
  get: () => (data().mode === 'continue' ? 'continue' : 'park'),
  set: (v) => {
    data().mode = v
  },
})

// ---- Prompt -----------------------------------------------------------------

const prompt = computed<string>({
  get: () => String(data().prompt ?? ''),
  set: (v) => {
    data().prompt = v
  },
})

// The literal shown in help text; kept in script so its braces don't collide
// with Vue's own `{{ }}` interpolation in the template.
const PATH_HINT = '{{$.path}}'

// ---- Channel ----------------------------------------------------------------

const channel = computed<HitlChannel>({
  get: () => {
    const v = String(data().channel ?? 'direct')
    return HITL_CHANNELS.some((c) => c.id === v) ? (v as HitlChannel) : 'direct'
  },
  set: (v) => {
    data().channel = v
  },
})

// ---- Telegram binding -------------------------------------------------------
// The three fields the backend bridge needs to deliver the session, stored flat
// on the node data (see lib/hitl's HitlTelegramBinding for why flat).

function dataField(key: string) {
  return computed<string>({
    get: () => String(data()[key] ?? ''),
    set: (v) => {
      data()[key] = v
    },
  })
}

const telegramConnection = dataField('telegramConnection')
const telegramAlias = dataField('telegramAlias')
const telegramChatId = dataField('telegramChatId')

// Telegram needs the backend: it is the backend that stores the gateway token,
// proxies OpenConnector and runs the poll loop that holds the conversation. In
// local (no-API) mode there is nothing to deliver the session.
const hasBackend = connectApi.isRemote()

const connections = ref<ConnectConnection[]>([])
const bots = ref<OcAccount[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)

/** The connected Telegram bots the gateway will actually let a run act as. */
const usableBots = computed(() => bots.value.filter(ocAccountActive))

/** Load the Connect connections and the selected one's Telegram bots. Failures
 *  are shown, not thrown: an unreachable gateway must not break the editor, and
 *  the designer can still type a chat id and fix Connect afterwards. */
async function loadBots() {
  if (!hasBackend) return
  loading.value = true
  loadError.value = null
  try {
    if (connections.value.length === 0) connections.value = await connectApi.list()
    bots.value = await connectApi.accounts('telegram', telegramConnection.value || undefined)
  } catch (err) {
    bots.value = []
    loadError.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

// The bot list belongs to one gateway, so it is reloaded when the panel first shows
// Telegram and whenever the connection changes — not when the bot does.
watch(
  () => [channel.value, telegramConnection.value] as const,
  ([ch]) => {
    if (ch === 'telegram') void loadBots()
  },
  { immediate: true },
)

// An alias that no longer resolves is worse than an empty one: the run fails
// where the editor could have said so. Flag it rather than silently rewriting the
// designer's choice, which would hide a gateway that is merely unreachable.
const staleAlias = computed(
  () =>
    !loading.value &&
    !loadError.value &&
    !!telegramAlias.value &&
    usableBots.value.length > 0 &&
    !usableBots.value.some((b) => b.alias === telegramAlias.value),
)

// ---- Who the session is sent to --------------------------------------------
//
// A chat id is not something a designer can be expected to know, and Telegram
// gives no way to look one up: a bot cannot list its users. What it can do is
// remember — the backend records every chat its HITL bridge hears from, so this
// picker reads an accumulated directory rather than querying Telegram.
//
// Two consequences shape the UI. A recipient has to have messaged the bot at least
// once (hence the bot's handle is shown, so the operator knows who to tell people
// to message), and the manual field has to stay available — a chat id worked out by
// the flow as `{{$.path}}` is a real capability the picker cannot express.

const recipients = ref<TelegramRecipient[]>([])
const bot = ref<TelegramBotProfile | null>(null)
const discovering = ref(false)
const discoverError = ref<string | null>(null)
const discoverNote = ref<string | null>(null)
// A webhook on the bound bot disables the polling this channel runs on, silently.
// It is tracked separately from discoverNote because it is not a note about this
// sweep — it is a standing fault that no amount of messaging the bot will clear.
const webhook = ref<TelegramWebhookInfo | null>(null)

/** Address the chat by hand instead of picking: a `{{$.path}}` the run resolves, a
 *  public `@channelname`, or a raw id. Turned on automatically for a node whose
 *  chat is not one of the known recipients, so an existing binding is never
 *  silently reinterpreted as "nothing selected". */
const manualChat = ref(false)

const selectedRecipient = computed(() =>
  recipients.value.find((r) => r.chatId === telegramChatId.value),
)

/** The select's value: a known recipient's chat id, the custom sentinel, or ''. */
const CUSTOM = '__custom__'
const chatChoice = computed<string>({
  get: () => (manualChat.value ? CUSTOM : telegramChatId.value),
  set: (v) => {
    if (v === CUSTOM) {
      manualChat.value = true
      return
    }
    manualChat.value = false
    telegramChatId.value = v
  },
})

/** Load the directory for the bound bot. Cheap and gateway-free, so it runs
 *  whenever the panel or the bot binding changes. */
async function loadRecipients() {
  if (!hasBackend) return
  discoverError.value = null
  try {
    recipients.value = await hitlApi.recipients(telegramConnection.value, telegramAlias.value)
  } catch {
    // The directory is a convenience; a node stays editable without it.
    recipients.value = []
  }
  // Fall back to the manual field for a chat the directory does not know — which
  // includes every `{{$.path}}` binding, and any node authored before this picker.
  manualChat.value = !!telegramChatId.value && !selectedRecipient.value
}

/** Ask the backend to sweep the bot's pending updates into the directory. This is
 *  the "someone just messaged the bot, pick them up" action. */
async function discover() {
  if (!hasBackend || discovering.value) return
  discovering.value = true
  discoverError.value = null
  discoverNote.value = null
  const before = recipients.value.length
  try {
    const res = await hitlApi.discoverRecipients(telegramConnection.value, telegramAlias.value)
    bot.value = res.bot
    recipients.value = res.recipients
    webhook.value = res.webhook?.url ? res.webhook : null
    manualChat.value = !!telegramChatId.value && !selectedRecipient.value
    // Nothing new is an ordinary outcome, not an error — the sweep only sees
    // updates nothing has consumed yet. Say why so it does not read as a failure.
    // Unless a webhook is set, in which case the sweep can never see anything and
    // the webhook banner below is the only accurate thing to say.
    if (res.recipients.length === before && !webhook.value) {
      discoverNote.value =
        res.recipients.length === 0
          ? `No one has messaged ${res.bot.username ? '@' + res.bot.username : 'this bot'} yet, or Telegram has already dropped the message (it keeps them ~24h). Ask them to send it anything, then check again.`
          : 'No new chats — everyone Telegram still had pending was already listed.'
    }
  } catch (err) {
    discoverError.value = (err as Error).message
  } finally {
    discovering.value = false
  }
}

// The recipient directory belongs to one BOT: switching the bound bot changes who
// is reachable, and the previously fetched identity no longer applies.
watch(
  () => [channel.value, telegramConnection.value, telegramAlias.value] as const,
  ([ch]) => {
    if (ch !== 'telegram') return
    bot.value = null
    discoverNote.value = null
    webhook.value = null
    void loadRecipients()
  },
  { immediate: true },
)

function recipientLabel(r: TelegramRecipient): string {
  const name =
    r.title?.trim() ||
    [r.firstName, r.lastName].filter(Boolean).join(' ').trim() ||
    (r.username ? `@${r.username}` : '') ||
    r.chatId
  return r.type ? `${name} · ${r.type}` : name
}

const chatMissing = computed(() => channel.value === 'telegram' && !telegramChatId.value.trim())

// The facilitator is an LLM, and its provider profile is bound by the settings
// selector elsewhere in this drawer. For a Direct session a missing profile shows
// up the moment someone clicks Start; for a Telegram one nothing visible happens
// at all — the bridge simply cannot open the conversation — so it is worth saying
// here, where the channel was chosen.
const providerMissing = computed(() => !String(data().settingsId ?? '').trim())

// Shown in help text; kept in script so the braces don't collide with Vue's own
// interpolation (same reason as PATH_HINT above).
const CHAT_HINT = '{{$.lookup.chatId}}'
</script>

<template>
  <div class="space-y-4">
    <!-- ---- Mode: park or continue ---- -->
    <div class="space-y-1.5">
      <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
        When the flow reaches this node
      </label>
      <div class="grid grid-cols-2 gap-1.5">
        <button
          v-for="opt in HITL_MODES"
          :key="opt.id"
          type="button"
          class="flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors"
          :style="mode === opt.id
            ? { background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'var(--accent)' }
            : { color: 'var(--fg-muted)' }"
          :title="opt.hint"
          @click="mode = opt.id"
        >
          <Icon :name="opt.icon" :size="14" />
          {{ opt.label }}
        </button>
      </div>
      <p class="text-[11px] leading-relaxed text-fg-subtle">
        {{ HITL_MODES.find((m) => m.id === mode)?.hint }}
      </p>
    </div>

    <!-- ---- Conversation prompt ---- -->
    <div class="space-y-1.5">
      <div class="flex items-center justify-between">
        <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Conversation prompt</label>
        <div class="flex items-center gap-3">
          <PromptExpander v-model="prompt" label="Human prompt" />
          <PromptImporter v-model="prompt" label="Human prompt" />
        </div>
      </div>
      <textarea
        v-model="prompt"
        rows="5"
        spellcheck="false"
        class="input resize-none font-mono text-xs leading-relaxed"
        :placeholder="DEFAULT_HITL_PROMPT"
      />
      <p class="text-[11px] leading-relaxed text-fg-subtle">
        What the session has to establish with the person. Embed
        <span class="font-mono">{{ PATH_HINT }}</span> variables to pull in what the flow built up to here — a message
        stack from an MCP / LLM node, the point it got stuck on. They are resolved against the run's context before the
        task is recorded, so the session opens on the subject matter, not the paths. The questions themselves come out
        of the conversation: a flow reaches a person because it could not settle something, so what to ask is not
        knowable here.
      </p>
    </div>

    <!-- ---- Session channel ---- -->
    <div class="space-y-1.5">
      <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Session channel</label>
      <div class="grid grid-cols-3 gap-1.5">
        <button
          v-for="opt in HITL_CHANNELS"
          :key="opt.id"
          type="button"
          class="flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[12px] font-medium transition-colors"
          :class="opt.available ? '' : 'cursor-not-allowed opacity-50'"
          :style="channel === opt.id
            ? { background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'var(--accent)' }
            : { color: 'var(--fg-muted)' }"
          :disabled="!opt.available"
          :title="opt.available ? opt.hint : `${opt.hint} — not available yet`"
          @click="channel = opt.id"
        >
          <Icon :name="opt.icon" :size="15" />
          {{ opt.label }}
        </button>
      </div>
      <p class="text-[11px] leading-relaxed text-fg-subtle">
        {{ HITL_CHANNELS.find((c) => c.id === channel)?.hint }}
        <template v-if="channel === 'direct'">
          Open it from Operate → Human Tasks.
        </template>
      </p>
    </div>

    <!-- ---- Telegram delivery binding ----
         Only the chat is required. An empty connection means the default Connect
         connection and an empty bot the gateway's default account, both resolved
         at run time — so a single-bot setup needs nothing but a chat. -->
    <div v-if="channel === 'telegram'" class="space-y-3 rounded-lg border bg-surface-2 p-3">
      <div class="flex items-center justify-between gap-2">
        <label class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
          <Icon name="send" :size="13" />
          Telegram delivery
        </label>
        <Button
          v-if="hasBackend"
          variant="ghost"
          icon="refresh"
          :disabled="loading"
          @click="loadBots"
        >
          {{ loading ? 'Checking…' : 'Recheck' }}
        </Button>
      </div>

      <!-- No backend: nothing can deliver the session. -->
      <p v-if="!hasBackend" class="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
        <Icon name="info" :size="13" class="mt-0.5 shrink-0" />
        <span>
          Telegram sessions are delivered by the backend through OpenConnector. Without a connected API this node can be
          authored but the session will not be delivered — use Direct chat, or connect a backend.
        </span>
      </p>

      <template v-else>
        <!-- Which gateway holds the bot. Hidden when there is only one: naming a
             connection would be a choice with one option. -->
        <div v-if="connections.length > 1" class="space-y-1">
          <label class="text-[11px] font-medium text-fg-muted">OpenConnector connection</label>
          <select v-model="telegramConnection" class="input text-[13px]">
            <option value="">Default connection</option>
            <option v-for="c in connections" :key="c.id" :value="c.id">
              {{ c.label || c.baseUrl }}{{ c.isDefault ? ' (default)' : '' }}
            </option>
          </select>
        </div>

        <!-- Which connected bot the session speaks as. -->
        <div class="space-y-1">
          <label class="text-[11px] font-medium text-fg-muted">Bot account</label>

          <p v-if="loading" class="flex items-center gap-1.5 text-[11.5px] text-fg-subtle">
            <Icon name="refresh" :size="13" class="animate-spin" />
            Looking for connected Telegram bots…
          </p>

          <p v-else-if="loadError" class="flex items-start gap-1.5 text-[11px] leading-relaxed text-danger">
            <Icon name="info" :size="13" class="mt-0.5 shrink-0" />
            <span>Could not reach the OpenConnector gateway: {{ loadError }}</span>
          </p>

          <!-- Nothing connected: this is the one thing that must be fixed
               elsewhere, so say exactly where. -->
          <div
            v-else-if="usableBots.length === 0"
            class="space-y-1.5 rounded-lg border border-dashed px-3 py-2.5"
          >
            <p class="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-amber-600 dark:text-amber-400">
              <Icon name="info" :size="13" class="mt-0.5 shrink-0" />
              <span>No active Telegram bot on this OpenConnector account. Connect one before a run reaches this node.</span>
            </p>
            <RouterLink :to="{ name: 'connect' }" class="text-[11.5px] text-accent hover:underline">
              Connect a Telegram bot →
            </RouterLink>
          </div>

          <select v-else v-model="telegramAlias" class="input text-[13px]">
            <option value="">Default bot on this connection</option>
            <option v-for="b in usableBots" :key="b.id" :value="b.alias ?? ''">
              {{ ocAccountLabel(b) }}{{ b.status ? ` · ${b.status}` : '' }}
            </option>
          </select>

          <p v-if="staleAlias" class="flex items-start gap-1.5 text-[11px] leading-relaxed text-danger">
            <Icon name="info" :size="13" class="mt-0.5 shrink-0" />
            <span>
              The bot this node is bound to (<span class="font-mono">{{ telegramAlias }}</span>) is not among the
              connected accounts any more. Pick one above, or reconnect it in Connect.
            </span>
          </p>
        </div>

        <!-- Who the session is sent to. Picked from the bots's known chats where
             possible, typed where it cannot be (a flow-resolved chat id). -->
        <div class="space-y-1">
          <div class="flex items-center justify-between gap-2">
            <label class="text-[11px] font-medium text-fg-muted">Send to</label>
            <Button variant="ghost" icon="search" :disabled="discovering" @click="discover">
              {{ discovering ? 'Looking…' : 'Find recipients' }}
            </Button>
          </div>

          <select v-if="recipients.length" v-model="chatChoice" class="input text-[13px]">
            <option value="">Pick a recipient…</option>
            <option v-for="r in recipients" :key="r.id" :value="r.chatId">
              {{ recipientLabel(r) }}
            </option>
            <option :value="CUSTOM">Another chat, or one the flow works out…</option>
          </select>

          <!-- Nothing known yet: the picker cannot invent a list, and it is worth
               saying exactly why rather than showing an empty dropdown. -->
          <p v-else class="text-[11px] leading-relaxed text-fg-subtle">
            No recipients known for this bot yet. Telegram has no way to list a bot's users — it only learns a chat
            exists when someone messages it. Have them send
            <span v-if="bot" class="font-mono">{{ bot.username ? '@' + bot.username : bot.firstName }}</span>
            <span v-else>the bot</span>
            anything, then use <span class="font-medium">Find recipients</span>. Everyone who talks to a session is
            remembered from then on.
          </p>

          <!-- The typed field: shown when there is nothing to pick from, or when
               the binding is deliberately not a fixed chat. -->
          <input
            v-if="manualChat || !recipients.length"
            v-model="telegramChatId"
            class="input font-mono text-[12.5px]"
            spellcheck="false"
            placeholder="123456789, @channelname, or {{$.path}}"
          />

          <p v-if="manualChat || !recipients.length" class="text-[11px] leading-relaxed text-fg-subtle">
            A numeric chat id, a public <span class="font-mono">@username</span>, or a
            <span class="font-mono">{{ CHAT_HINT }}</span> variable resolved against the run's context — which is how a
            flow routes the session to whoever it just looked up, rather than to someone chosen on the canvas.
          </p>

          <!-- A standing fault, not a note about this sweep: while a webhook is set
               this bot cannot be polled at all, so the session could ask a question
               and never hear the answer. -->
          <p v-if="webhook" class="flex items-start gap-1.5 text-[11px] leading-relaxed text-danger">
            <Icon name="info" :size="13" class="mt-0.5 shrink-0" />
            <span>
              This bot has a webhook set (<span class="font-mono">{{ webhook.url }}</span>), which disables the polling
              FloMorphic uses — Telegram sends every update there instead, so the bot could ask but never hear an answer.
              Remove the webhook on the bot, or give Human-in-the-Loop a bot of its own. Sessions on this bot will not
              open until then.
            </span>
          </p>

          <p v-if="discoverError" class="flex items-start gap-1.5 text-[11px] leading-relaxed text-danger">
            <Icon name="info" :size="13" class="mt-0.5 shrink-0" />
            <span>{{ discoverError }}</span>
          </p>
          <p v-else-if="discoverNote" class="flex items-start gap-1.5 text-[11px] leading-relaxed text-fg-subtle">
            <Icon name="info" :size="13" class="mt-0.5 shrink-0" />
            <span>{{ discoverNote }}</span>
          </p>

          <p v-if="chatMissing" class="flex items-start gap-1.5 text-[11px] leading-relaxed text-danger">
            <Icon name="info" :size="13" class="mt-0.5 shrink-0" />
            <span>Required — without a recipient the session has nowhere to be delivered and the task will sit unopened.</span>
          </p>
        </div>

        <p v-if="providerMissing" class="flex items-start gap-1.5 text-[11px] leading-relaxed text-danger">
          <Icon name="info" :size="13" class="mt-0.5 shrink-0" />
          <span>
            No chat provider profile is bound, so there is no assistant to hold the conversation and the session will not
            open. Fix it in the profile row at the top of this drawer: pick a profile, or press
            <span class="font-mono">+</span> to make one (provider, model and access token — the same provider fields as
            the LLM node). The token stays in the settings store, never on the flow.
          </span>
        </p>

        <p class="border-t pt-2 text-[11px] leading-relaxed text-fg-subtle">
          When the flow reaches this node the bot opens the conversation in that chat and the person answers there. They
          have three commands, since a chat has no buttons: <span class="font-mono">/done</span> finishes the session —
          for a <span class="font-medium">Park</span> node that is also what releases the run —
          <span class="font-mono">/status</span> shows what has been asked and answered, and
          <span class="font-mono">/help</span> explains the rest. Every turn is mirrored onto the task under Operate →
          Human Tasks, which stays the record of the session.
        </p>
      </template>
    </div>
  </div>
</template>
