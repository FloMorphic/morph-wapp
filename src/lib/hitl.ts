/**
 * The Human-in-the-Loop node's design-time contract — the shape the drawer
 * edits, the node catalog previews, and the backend compiler lowers into the
 * Extrinsic's operation payload (`op`) on `svc.hitl.add`.
 *
 * The prompt is the node. A flow reaches a human because it could not settle
 * something itself — usually an LLM that ran out of certainty — so what the
 * person has to be asked is not knowable when the canvas is drawn. It is worked
 * out in the session, from the run's own history: the prompt tells the session
 * where to look and what to establish, and the questions come out of that
 * conversation. Hence no question list here, and no context-pointer list either.
 *
 * The prompt is written with `{{$.path}}` variables like any other node's
 * template, and they resolve the same way: the runtime resolves every
 * `{{JSONPATH}}` it finds in an extrinsic's `op` against the run's context
 * *before* handing the payload to the svc handler. So the session opens on real
 * text — the message stack an upstream MCP/LLM node built, the point it got
 * stuck on.
 */

import type { BaseNodeData } from '@/data/nodeCatalog'

/**
 * What the svc handler answers with when the run reaches the node.
 *
 *   park     → a `stop` command: the runtime drops this node's next and the run
 *              finishes here. The node's outbound edges are captured on the task
 *              and a resume run starts from all of them once the session closes.
 *   continue → a plain success reply with no command: the task is recorded (so a
 *              person can pick it up out of band) and the flow carries straight
 *              on through this node's next.
 */
export type HitlMode = 'park' | 'continue'

/** Where the conversation with the person happens. */
export type HitlChannel = 'direct' | 'telegram' | 'whatsapp'

export const HITL_MODES: { id: HitlMode; label: string; icon: string; hint: string }[] = [
  {
    id: 'park',
    label: 'Park',
    icon: 'node-until',
    hint: 'The run stops at this node and the workflow gets its finish signal. The outbound nodes are captured with the task, and the flow resumes from them once the session is closed.',
  },
  {
    id: 'continue',
    label: 'Continue',
    icon: 'play',
    hint: 'The task is recorded and the flow carries straight on through this node’s next — the person picks the record up out of band, without the run waiting for them.',
  },
]

export const HITL_CHANNELS: {
  id: HitlChannel
  label: string
  icon: string
  available: boolean
  hint: string
}[] = [
  {
    id: 'direct',
    label: 'Direct chat',
    icon: 'prompt',
    available: true,
    hint: 'The conversation happens in FloMorphic: the person clicks the task and answers in an in-app chat.',
  },
  {
    id: 'telegram',
    label: 'Telegram',
    icon: 'send',
    available: true,
    hint: 'The same conversation, held in a Telegram chat: the bot opens it, the person answers on their phone, and /done releases the flow (/status and /help too, since a chat has no buttons). Every turn is still recorded on the task.',
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    icon: 'phone',
    available: false,
    hint: 'The session is delivered as a WhatsApp conversation (needs a Business API integration).',
  },
]

/**
 * A Telegram session's delivery binding, as it lives on the node's `data`.
 *
 * FloMorphic holds no bot token. The bot is an account connected in
 * OpenConnector — oomol's hosted gateway or a self-hosted one — reached through
 * a stored Connect connection, so a Telegram node names three things rather than
 * a credential: which connection, which connected bot on it, and which chat to
 * talk to.
 *
 * They are stored FLAT (not as a nested object) because the backend ships them
 * flat in the node's `op` payload, where the runtime resolves `{{$.path}}`
 * variables — which is what lets `telegramChatId` be worked out by the flow
 * rather than typed on the canvas.
 */
export interface HitlTelegramBinding {
  /** Connect connection id, or '' for the default connection. */
  telegramConnection: string
  /** The connected bot's alias on that gateway, or '' for its default account. */
  telegramAlias: string
  /** The chat to hold the session in: a numeric chat id, an `@username`, or a
   *  `{{$.path}}` the runtime resolves before the task is recorded. */
  telegramChatId: string
}

/** The node-data keys a Telegram session's binding occupies. */
export const HITL_TELEGRAM_KEYS = [
  'telegramConnection',
  'telegramAlias',
  'telegramChatId',
] as const

/** Read the Telegram binding off a node's data, defaulting every field. */
export function hitlTelegramBinding(data: BaseNodeData): HitlTelegramBinding {
  return {
    telegramConnection: String(data.telegramConnection ?? ''),
    telegramAlias: String(data.telegramAlias ?? ''),
    telegramChatId: String(data.telegramChatId ?? ''),
  }
}

/**
 * What is still missing before a Telegram session can be delivered, phrased for
 * the designer. Only the chat is strictly required — an empty connection means
 * the default Connect connection and an empty alias the gateway's default bot,
 * both of which resolve at run time.
 */
export function hitlTelegramGap(data: BaseNodeData): string | null {
  if (data.channel !== 'telegram') return null
  if (!String(data.telegramChatId ?? '').trim()) {
    return 'No recipient selected — the session has nowhere to be delivered.'
  }
  return null
}

/** The node-data keys this node owns beyond the universal ones. */
export const HITL_DATA_KEYS = ['mode', 'prompt', 'channel', ...HITL_TELEGRAM_KEYS] as const

/**
 * The prompt a fresh node starts with — the node's philosophy written out, so a
 * designer who drops one and reads it understands what it is for. It is meant to
 * be edited: the path it reads and the ground it has to cover are specific to
 * the flow it sits in.
 */
export const DEFAULT_HITL_PROMPT = `Review what the flow has produced so far:

{{$.llm.messages}}

Identify the point it could not settle on its own, explain it to the person in plain language, and ask them the questions you need answered before the flow can continue.`

/**
 * Bring a node authored before this contract up to it.
 *
 * Three fields have been dropped along the way, and a node saved with any of
 * them keeps them forever unless they are cleared here: `operationData` (an
 * early key/value list the compiler never read), `refs` (context pointers the
 * runtime resolves on its own), and `questions` (a static list, which the node
 * cannot know — see the module note). Missing mode/channel default to the safe
 * pair: park, and the one channel that exists.
 */
export function migrateHitlData(data: BaseNodeData): void {
  const d = data as Record<string, unknown>
  delete d.operationData
  delete d.refs
  delete d.questions
  if (d.mode !== 'continue') d.mode = 'park'
  if (typeof d.prompt !== 'string') d.prompt = ''
  if (!HITL_CHANNELS.some((c) => c.id === d.channel)) d.channel = 'direct'
  // The Telegram binding is always present as strings so the editor can bind to
  // it without a v-model writing onto `undefined`. Empty is meaningful for two of
  // the three: default connection, default bot.
  for (const k of HITL_TELEGRAM_KEYS) {
    if (typeof d[k] !== 'string') d[k] = ''
  }
}
