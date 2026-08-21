/**
 * Wire types mirroring the FloMorphic `flomorphic-api` (morph-api) backend.
 * Kept 1:1 with the Go models so the API client is drop-in when a backend is
 * configured (see src/api). When no backend is set, the same shapes are
 * persisted locally (see src/lib/localStore.ts).
 */

/** Every response is wrapped in this envelope. `error` is null on success. */
export interface ApiEnvelope<T> {
  data: T
  error: unknown
}

/**
 * Page-based list payload:
 * `{ data: { list, total, page, per_page, total_pages } }`.
 * The backend counts matching rows in SQL, so the pager knows its bounds up front.
 */
export interface Page<T> {
  list: T[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

export interface PaginationParams {
  /** 1-based page number. */
  page?: number
  per_page?: number
  search?: string
}

/* ---- Vue Flow graph (the `view_flow` field, matches compilers/vueFlow) ---- */

export interface FlowNode<TData = Record<string, unknown>> {
  id: string
  type: string
  position: { x: number; y: number }
  data: TData
  [key: string]: unknown
}

export interface FlowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  type?: string
  data?: { tags?: string[]; [key: string]: unknown }
  [key: string]: unknown
}

export interface VueFlowGraph {
  nodes: FlowNode[]
  edges: FlowEdge[]
  position?: { x: number; y: number; zoom: number }
}

/* ---- Records ---- */

export interface FlowRecord {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  view_flow: VueFlowGraph
}

/** GET /flow/id/:id/compile — the inflow compiler's output for a saved flow: the
 * resolved start node and the map of lowered inflow nodes keyed by node id (each
 * an inflow primitive — void / code / contract / plugin / extrinsic / goto — with
 * its wiring). A debug view of what a canvas graph becomes on the engine; the
 * node shape is the engine's, so it is left opaque here. */
export interface CompiledFlow {
  startNodeId: string
  nodes: Record<string, unknown>
}

/* ---- Palette extensions / node registry (backed by `/extension`) ----
 * Every row is one node in the canvas palette. `kind` separates admin-managed
 * builtins (seeded on first run; UI hard-coded in the front end) from
 * user-imported inflowv1 plugins (`extension`, whose settings form and actions
 * are fetched live over NATS via `pluginId`). This is NOT the ProjectExtension
 * repo-clone flow below — it is the node definition the palette lists.
 */
export type ExtensionKind = 'builtin' | 'extension'

/** The palette node type a stored extension carries. For user `extension` nodes
 * this is one of the two outward-facing execution generics (`plugin` /
 * `extrinsic`). For `builtin` nodes it is one of FloMorphic's 10 morphic types,
 * each of which the backend compiler lowers to an inflow primitive at compile
 * time (see inflow/compiler.go's NodeBuilder). */
export type ExtensionType =
  | 'plugin'
  | 'extrinsic'
  // FloMorphic builtin morphic types
  | 'startNode'
  | 'goto'
  | 'hitl'
  | 'docstore'
  | 'vecstore'
  | 'promissall'
  | 'llm'
  | 'mcp'
  | 'rule'
  | 'js'
  | 'opa'
  | 'until'
  | 'cast'

export interface ExtensionIcon {
  class: string
  name: string
  meta?: Record<string, unknown>
}

export interface FormParameters {
  schema: Record<string, unknown>
  ui: Record<string, unknown>
}

export interface ExtensionBind {
  topic_key: string
  values: Record<string, string>
}

export interface ExtensionRecord {
  id: string
  kind: ExtensionKind
  type: ExtensionType
  name: string
  description: string
  /** inflowv1 PLUGIN_ID. For user `extension` nodes it identifies the imported
   * plugin; for the plugin-backed builtins (llm / mcp / cast) it is a value
   * hard-coded in the server seed. Used to build `inflow.v1.<pluginId>.…`
   * subjects and to mint the plugin's runtime credential. Empty for the
   * non-plugin builtins. */
  pluginId: string
  icon: ExtensionIcon
  params: FormParameters
  bindTo: ExtensionBind
  /** How the user runs the plugin behind this row (source + env). Absent on
   * builtins and on rows registered without a repository. */
  install?: InstallSpec
  /** For a row synced from a plugin's `@actions`: the one method this palette
   * entry runs (a Jira plugin contributes an "add task" node, an "update task"
   * node, …). Empty on a plugin's own registration row and on builtins. It
   * compiles to the plugin node's `request`. */
  action?: string
  /** The registration row a synced action row came from. */
  parentId?: string
  /** Optional static branch declaration synced from the plugin's `@actions`
   * (SDK Action.Outbound). Each entry renders as an output port on the canvas
   * node, and edges drawn from it inherit the port's tags — which the plugin
   * fires at runtime (`next_tags`) to route the flow. Absent/empty means the
   * node keeps its single default source handle. Only user `extension` nodes
   * carry this; builtin node UIs are hard-coded. */
  outbound?: OutboundPort[]
  createdAt: number
  updatedAt: number
}

/** One declared branch of a plugin action (SDK OutboundPort). `title` labels the
 * port, `description` explains the branch, and `tags` are stamped onto every
 * edge drawn from it — the tags the plugin names in `next_tags` to fire it. */
export interface OutboundPort {
  title: string
  tags: string[]
  description?: string
}

/* ---- inflowv1 descriptors (read live from a running plugin) ----
 * Mirrors of the plugin SDK's wire shapes. Fetched through the backend's NATS
 * proxy; only what `sync` derives from `@actions` is ever stored.
 */

/** A plugin's form descriptor. `jsonschema` / `jsonui` are JSON documents
 * carried as *strings* — that is the SDK's format on the wire. */
export interface PluginFormBuilder {
  submit_to?: string
  jsonui?: string
  jsonschema?: string
}

/** `@intro` — who the plugin is, plus the settings it needs before any action
 * runs. That settings form is the plugin's onboarding: the portal renders it
 * into a reusable settings profile. */
export interface PluginIntro {
  name?: string
  author?: string
  version?: string
  settings?: PluginFormBuilder
}

/** One entry of `@actions` — a method the plugin exposes, with the label/icon a
 * palette needs and the form its parameters are collected through. */
export interface PluginAction {
  method: string
  title?: string
  description?: string
  icon?: { ref?: string; icon?: string }
  form?: PluginFormBuilder
}

/** POST /extension/id/:id/sync — what re-reading a plugin's descriptors did to
 * its palette rows. Derived rows are replaced, never merged, so `removed` is the
 * previous set and `added` the live one. */
export interface SyncResult {
  intro: PluginIntro
  actions: PluginAction[]
  added: number
  removed: number
  pluginId: string
}

/** One extra environment entry a plugin needs beyond the three the inflowv1 SDK
 * requires (PLUGIN_ID / INFRA_URL / INFRA_CRED) — an upstream API key, an
 * endpoint, a mode flag. */
export interface EnvVar {
  key: string
  value: string
}

/** How the generated installer builds and starts a plugin. `auto` detects it
 * from the checkout (go.mod → go, package.json → node, Dockerfile → docker). */
export type InstallRuntime = 'auto' | 'go' | 'node' | 'docker'

/** The "how do I run this plugin" half of an extension row. Every field is
 * optional: a plugin the user already has on disk only needs the env half. */
export interface InstallSpec {
  /** Git remote to clone. Empty ⇒ the user brings their own checkout. */
  repo: string
  /** Branch / tag / commit; empty ⇒ the remote's head. */
  ref: string
  /** Path inside the repo holding the plugin module, for multi-plugin repos. */
  subdir: string
  runtime: InstallRuntime
  /** Dotenv filename the plugin reads (SDK convention: `.env.inflow`). */
  envFile: string
  /** Plugin-specific variables written alongside the minted credential. */
  env: EnvVar[]
}

/** GET /extension/id/:id/env — the dotenv for a plugin the user already has
 * checked out. Carries a freshly minted, plugin-scoped credential. */
export interface PluginEnvResponse {
  env: string
  envFile: string
  cred: string
  pluginId: string
}

/** GET /extension/id/:id/install — everything needed to install and start a
 * plugin from source: the one-liner to paste, the script it pipes into bash,
 * and the env that script writes. Secret-bearing (the env holds the cred). */
export interface InstallInfo {
  /** `curl -fsSL <scriptUrl> | bash -s -- <dir>` */
  command: string
  scriptUrl: string
  script: string
  env: string
  envFile: string
  dir: string
  pluginId: string
}

/** How broad a minted plugin credential is: `multi` grants an open account
 * credential, `strict` scopes it to the one plugin's inflowv1 subjects. */
export type PluginCredAccess = 'multi' | 'strict'

/** POST /extension/plugin/cred — request a runtime credential for a plugin.
 * `strict` access requires `pluginId` (the credential is scoped to it); `multi`
 * access is account-wide and only requires `name`. */
export interface PluginCredRequest {
  pluginId?: string
  name?: string
  access?: PluginCredAccess
  spaceId?: string
}

/** The minted credential and a ready-to-use env block for running the plugin. */
export interface PluginCredResponse {
  cred: string
  env: string
}

/* ---- Connect: OpenConnector (oomol) integration ---- */

/** One configured OpenConnector gateway — hosted oomol or a self-hosted
 * instance. The raw `token` is write-only: it is sent on create/update but never
 * returned; reads carry `tokenSet` + a masked `tokenPreview` instead. */
export interface ConnectConnection {
  id: string
  label: string
  baseUrl: string
  /** Runtime token (`oct_…`) for `/v1` execution — send on upsert; omit on
   *  update to keep the stored one. */
  token?: string
  /** Admin token for `/api` management (browse/connect apps). Self-hosted only —
   *  the operator's OOMOL_CONNECT_ADMIN_TOKEN. Empty for hosted oomol. */
  adminToken?: string
  /** Read-only: a runtime token is stored. */
  tokenSet?: boolean
  /** Read-only: masked tail of the stored runtime token (e.g. "…a1b2"). */
  tokenPreview?: string
  /** Read-only: an admin token is stored. */
  adminTokenSet?: boolean
  /** Read-only: masked tail of the stored admin token. */
  adminTokenPreview?: string
  /** Free-form endpoint flavour, for display: 'hosted' | 'selfhosted'. */
  kind?: string
  isDefault?: boolean
  createdAt?: number
  updatedAt?: number
}

/** POST /connect/connections/test result — a reachability/token probe. */
export interface ConnectProbeResult {
  ok: boolean
  baseUrl: string
  /** The admin token reached the management surface (`/api`). */
  adminOk?: boolean
  /** The runtime token reached the execution surface (`/v1`). */
  runtimeOk?: boolean
}

/** Connection params an MCP node uses to reach its MCP server. Carried into the
 * plugin body at compile time (url / transport / auth) and also POSTed to the
 * "list tools" meta method so the plugin can connect and enumerate tools. */
export interface McpConnection {
  url: string
  /** Wire transport: 'streamable-http' | 'sse' | 'stdio' | 'websocket'. */
  transport?: string
  /** Auth material (bearer token / header value), if the server needs it. */
  auth?: string
}

/** One tool advertised by an MCP server, returned by the "list tools" meta
 * method. `name` is the tool id the model calls (and the outbound-port route
 * tag); `description` tells the model when to call it; `inputSchema` is the
 * tool's JSON-schema arguments (kept for reference / future arg forms). */
export interface McpTool {
  name: string
  title?: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export type ContextChangeType = 'flow' | 'manual'

export interface ContextRecord {
  id: string
  title: string
  context: string
  header: Record<string, unknown>
  updatedBy: { by: ContextChangeType; address: string }
  createdAt: number
  updatedAt: number
}

/** POST /ps — start a process instance. */
export interface ProcessRequestInput {
  flowId: string
  contextId: string
}

/* ---- Process runs (FloMorphic-specific) ----
 * A Process is one execution of a workflow on the inflow engine. Rows are
 * written by the backend when a process request is sent and closed out from the
 * engine's `proc.finish` event — the UI does not create them directly (it
 * launches via POST /process, then reads / stops). Backed by `/process`.
 *
 * Identity is `indexId`, an auto-increment integer echoed into the engine
 * request meta, so a run is addressable independently of its `pid` (a single
 * `pid` can back several rows — a human-in-the-loop pause finishes one row as
 * `waiting` and the answer starts a fresh row that resumes the same `pid`).
 *
 *   scheduled → recorded, waiting to reach its launch time (not yet dispatched)
 *   running   → dispatched, the engine is executing it
 *   waiting   → parked mid-run (e.g. a human-in-the-loop step)
 *   finished  → ran to completion
 *   stopped   → cancelled by a user or a timeout
 *   failed    → aborted on an error (`error` is set)
 */
export type ProcessStatus = 'scheduled' | 'running' | 'waiting' | 'finished' | 'stopped' | 'failed'

export interface Process {
  /** Auto-increment integer identity (the "indexId"). */
  indexId: number
  /** Engine process uuid — not unique across rows (see the type doc). */
  pid: string
  /** Correlation id shared by every run of one logical workflow instance: a run
   *  and every run that resumes it after a Human-in-the-Loop park carry the same
   *  instanceId (the first run's pid), while each keeps its own pid. */
  instanceId?: string
  flowId: string
  contextId: string
  startNodeId: string
  status: ProcessStatus
  resourceUrl?: string
  /** The ProcessRequest snapshot sent to the engine. */
  request?: Record<string, unknown>
  /** Backend-only object kept alongside the run (e.g. parked next-node list). */
  meta?: Record<string, unknown>
  error?: string
  /** Epoch millis a scheduled run should launch at; 0 for an immediate run. */
  scheduledAt: number
  startedAt: number
  finishedAt: number
  durationMs: number
  createdAt: number
  updatedAt: number
}

/** POST /process body — launch a workflow run. The engine request meta is
 * assembled server-side (its indexId is only known after the row is inserted),
 * so it is intentionally absent here. */
export interface StartProcessInput {
  flowId: string
  contextId: string
  startNodeId?: string
  meta?: Record<string, unknown>
  scheduledAt?: number
  /** Engine run settings (proc timeout, node-traversal limit, fallback request
   * timeout). Omitted or zero fields keep the engine defaults, so only what the
   * user changed need be sent. See {@link ProcessRunSettings}. */
  settings?: ProcessRunSettings
}

/** Caller-tunable engine run settings sent with a launch. Each is an override of
 * the engine default (proc_timeout 1h, proc_node_limit 500, svc_req_timeout 5s);
 * a 0/absent field leaves that default in place. */
export interface ProcessRunSettings {
  /** Process execute timeout, in seconds (`proc_timeout`). */
  executeTimeoutSec?: number
  /** Max node visits before the run is stopped (`proc_node_limit`). */
  processNodeLimit?: number
  /** Fallback per-request timeout, in seconds (`svc_req_timeout`). */
  requestTimeoutSec?: number
}

/* ---- Node settings profiles (FloMorphic-specific) ----
 * A reusable, named key/value config bound to a node — identified by
 * `nodeUniqId`, the node kind / plugin identity shared by every instance of that
 * node (all `llm` nodes, or all instances of one bound plugin). A node may own
 * several profiles (e.g. a distinct URL + token per environment); a canvas node
 * instance references one by id via its `data.settingsId`. `settings` is a
 * free-form key/value object (access token, provider, endpoints, …). Backed by
 * `/settings`.
 */
export interface NodeSetting {
  id: string
  /** The node kind / plugin identity this profile is bound to. */
  nodeUniqId: string
  /** The node's kind (e.g. "llm", "plugin", "http"). Set by the frontend from
   * the node being edited — not entered by the user — so the profile records
   * what kind of node it belongs to (nodeUniqId identifies which one). */
  nodeType: string
  /** Profile name shown in the selector (e.g. "OpenAI prod"). */
  title: string
  settings: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

/* ---- Memory stores (FloMorphic-specific) ----
 * Named, reusable stores referenced by the Memory node in a workflow. Two
 * shapes with different config: a Vector store (needs an embedding model +
 * token) and a Document store (needs a table/column schema).
 */
export type MemoryType = 'vector' | 'document'

export type VectorMetric = 'cosine' | 'dot' | 'euclidean'

export interface VectorMemoryConfig {
  /** Embedding provider, e.g. 'openai', 'anthropic', 'inflow', 'local'. */
  provider: string
  /** Embedding model, e.g. 'text-embedding-3-small'. */
  embeddingModel: string
  /** API token / key for the embedding model. */
  token: string
  dimensions: number
  metric: VectorMetric
  namespace: string
}

export type ColumnType = 'string' | 'text' | 'number' | 'boolean' | 'object' | 'array' | 'timestamp'

export interface TableColumn {
  name: string
  type: ColumnType
  /** Marks the primary key / lookup column. */
  primary?: boolean
}

export interface DocumentMemoryConfig {
  table: string
  columns: TableColumn[]
}

export interface MemoryStore {
  id: string
  name: string
  type: MemoryType
  description: string
  vector?: VectorMemoryConfig
  document?: DocumentMemoryConfig
  createdAt: number
  updatedAt: number
}

/* ---- Memory store records (data browser) ----
 * The rows a store actually holds, browsed by the store data view. A document
 * store exposes CRUD over DocumentRecord rows; a vector store exposes an
 * embed-backed similarity search (returning VectorMatch) plus insert. Backed by
 * the record endpoints under `/memory/:id`. Records only exist when a backend is
 * configured — there is no local fallback (they need a real SQL / vector index).
 */
export interface DocumentRecord {
  id: string
  /** The stored JSON document. Schema columns are a hint over these keys. */
  data: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

/** One hit from a vector similarity search: the stored doc, its source text and
 *  metadata, and the distance to the query vector (smaller is closer). */
export interface VectorMatch {
  docId: string
  content: string
  metadata?: Record<string, unknown>
  distance: number
}

/* ---- Prompt templates (FloMorphic-specific) ----
 * A reusable prompt template referenced by AI nodes. `template` is the prompt
 * text with `{{variable}}` placeholders; `variables` documents those
 * placeholders; `tags` group templates for search. Backed by `/prompt`.
 */
export interface PromptVariable {
  name: string
  description?: string
  default?: string
  required?: boolean
}

export interface PromptTemplate {
  id: string
  title: string
  description: string
  template: string
  variables: PromptVariable[]
  tags: string[]
  createdAt: number
  updatedAt: number
}

/* ---- Human-in-the-Loop tasks (FloMorphic-specific) ----
 * A HumanTask is created by the backend `hitl` svc handler when a running
 * workflow reaches a `humanInLoop` node — never through the UI (there is no
 * create/upsert). The web app lists them, opens one as a chat-style
 * conversation, answers its questions, and closes it. Backed by `/hitl`.
 *
 *   open     → created, awaiting answers
 *   answered → every question answered; ready to close
 *   closed   → the person is done. For a `park` task this is what releases the
 *              flow: the backend starts a fresh run on the captured next nodes
 */
export type HumanTaskStatus = 'open' | 'answered' | 'closed'

/** One question put to the person during the session. Questions are raised in
 *  the conversation — worked out from the run's history against the node's
 *  prompt — not declared on the node, so a freshly recorded task has none. */
export interface HumanTaskQuestion {
  id: string
  text: string
  answer: string
  answeredAt: number
}

/** One turn of the free-form chat thread used to understand the task context.
 * The assistant reply is produced client-side; the backend only stores it. */
export interface HumanTaskMessage {
  id: string
  role: 'human' | 'assistant' | 'system'
  text: string
  at: number
}

/** The outbound edge of the parked node, kept so the flow can resume from it. */
export interface HumanTaskNext {
  flowId: string
  nodeId: string
  tags: string[]
  active: number
}

export interface HumanTask {
  id: string
  title: string
  status: HumanTaskStatus
  /** Process instance the task belongs to. */
  pid: string
  flowId: string
  nodeId: string
  contextId: string
  /** How the node behaved when the run reached it — see lib/hitl's HitlMode. */
  mode?: 'park' | 'continue'
  /** Where the session is held. Only `direct` is served today. */
  channel?: 'direct' | 'telegram' | 'whatsapp'
  /** The conversation opener, ready to show. The node authors it with
   *  `{{$.path}}` variables and the runtime resolves them against the run's
   *  context before the svc handler records the task. */
  prompt?: string
  /** The node-settings profile id holding the conversation bot's LLM provider
   *  config (provider / model / token / base URL). The backend chat service reads
   *  the token from the settings store by this id, so it never rides on the task;
   *  in local mode the client resolves the profile the same way. */
  settingsId?: string
  /** The HITL node's result binding. Closing the task writes the conversation
   *  outcome into the run's context under `$.<key>`. */
  key?: string
  /** Raised during the session, not by the node. Empty on a fresh task. */
  questions: HumanTaskQuestion[]
  messages: HumanTaskMessage[]
  /** Scoped data snapshot recorded when the flow parked at this node. */
  data?: Record<string, unknown>
  /** The parked node's outbound edges — where a resumed run picks up. */
  nexts?: HumanTaskNext[]
  createdAt: number
  updatedAt: number
  closedAt: number
}

/* ---- Workflow triggers (FloMorphic-specific) ----
 * A Trigger is what starts a workflow from the outside — an inbound webhook or a
 * recurring schedule. It is a first-class resource, NOT part of the flow graph
 * (`view_flow`): the graph is an editable, exportable, AI-generated document, so
 * secrets (webhook signing keys), the public URL lifecycle, and delivery history
 * must live off it. Each trigger is bound to one flow and to the entry node it
 * launches (`startNodeId` — empty means the flow's own `startNode`), which is
 * exactly the `StartNodeIDs` the backend's StartWorkflow accepts. Surfaced in the
 * UI from the Start node's settings drawer, but stored/served under `/trigger`.
 *
 * Note the split from the run scheduler: the backend `Scheduler` fires a parked
 * process ONCE at its `scheduledAt` (the "Continue After" node). A ScheduleTrigger
 * is recurring — when due it starts a *fresh* run and re-arms for the next
 * occurrence — so it is a distinct concept, not a scheduled Process row.
 */
export type TriggerKind = 'webhook' | 'schedule'

/** How a fire obtains the process's context document. `existing` reuses one
 *  selected doc (the run mutates it in place); `new` mints a fresh context each
 *  fire (isolated runs, at the cost of extra rows). */
export type TriggerContextMode = 'existing' | 'new'

/** Fields shared by every trigger kind. */
export interface TriggerBase {
  id: string
  kind: TriggerKind
  /** The workflow this trigger launches. */
  flowId: string
  /** The entry node to launch at. Empty resolves the flow's `startNode` — the
   *  same semantics as StartWorkflow's `StartNodeIDs`. */
  startNodeId: string
  /** Human label shown in the drawer list (e.g. "GitHub push", "Nightly sync"). */
  title: string
  /** A disabled trigger is kept but never fires (webhook returns 404 / schedule
   *  does not arm). Lets a user pause a hook without losing its config + secret.
   *  A trigger can only be enabled once its run context resolves (an `existing`
   *  mode must name a doc). */
  enabled: boolean
  /** Where a fire's process context comes from. */
  contextMode: TriggerContextMode
  /** The selected context doc id, when `contextMode === 'existing'`. */
  contextId?: string
  /** Title for the context doc minted each fire, when `contextMode === 'new'`. */
  contextTitle?: string
  /** Optional engine run-setting overrides applied to each launched run — the
   *  same three the manual Run dialog collects. Omitted/zero fields keep defaults. */
  settings?: ProcessRunSettings
  createdAt: number
  updatedAt: number
}

/** How an inbound webhook request is authenticated. Mirrors the auth methods of
 *  the reference gateway: no header (IP allow-list only), a static shared token,
 *  HTTP Basic, a verified JWT, or an HMAC body signature. */
export type WebhookAuthMethod = 'none' | 'static' | 'basic' | 'jwt' | 'hmac'

export type WebhookHashAlgo = 'sha256' | 'sha384' | 'sha512'
export type WebhookDigest = 'base64' | 'hex'

export interface WebhookAuth {
  method: WebhookAuthMethod
  /** Request header carrying the credential (e.g. `Authorization`, `X-Signature`).
   *  Unused for `none`. */
  headerKey?: string
  /** Regex whose last capture group extracts the token from the header value
   *  (e.g. `^Bearer (.+)$`, `^sha256=([a-f0-9]+)$`). Unused for `none` / `static`. */
  headerPattern?: string
  /** HMAC hash for `hmac`. */
  hashAlgo?: WebhookHashAlgo
  /** How the signature token is encoded, for `hmac`. */
  digest?: WebhookDigest
  /** Write-only. The shared secret / token / HMAC key / JWT verification key. Sent
   *  on save, never returned by a read — the backend redacts it and reports its
   *  presence via {@link WebhookTrigger.hasSecret}. Undefined on save leaves the
   *  stored secret unchanged. */
  secret?: string
}

export interface WebhookTrigger extends TriggerBase {
  kind: 'webhook'
  /** Path segment of the public ingress URL (`/hooks/:slug`). Backend-assigned if
   *  omitted on create; must be unique. */
  slug: string
  /** Allowed HTTP methods (upper-case). Empty = accept any method. */
  methods: string[]
  auth: WebhookAuth
  /** CIDR allow-list. Empty = no IP restriction (except `none` auth, which
   *  requires at least one entry — an unauthenticated open hook is refused). */
  whitelistIp: string[]
  /** Read-only, backend-populated: the fully-qualified public URL to POST to. */
  url?: string
  /** Read-only: whether a secret is stored (the secret itself is never returned). */
  hasSecret?: boolean
  /** Read-only: recent delivery attempts, newest first (bounded, e.g. last 10). */
  recentHits?: TriggerHit[]
}

/** One recorded webhook delivery — the run log a user sees under the hook. */
export interface TriggerHit {
  at: number
  /** HTTP status returned to the caller (200/202 accepted, 401/403 rejected). */
  status: number
  ip?: string
  method?: string
  /** Short outcome message ("OK", "signature mismatch", "ip not in whitelist"). */
  message?: string
}

/** A recurring schedule. The UI offers two friendly ways to express it — a raw
 *  cron string or a plain interval (every N minutes/hours/…) — but the server
 *  normalizes an interval into a cron expression so the scheduler has a single
 *  representation to arm on (`cronEffective`). */
export type ScheduleMode = 'cron' | 'interval'

export interface ScheduleTrigger extends TriggerBase {
  kind: 'schedule'
  mode: ScheduleMode
  /** Cron expression when `mode === 'cron'` (e.g. `0 9 * * 1-5`). */
  cron?: string
  /** Fixed period in seconds when `mode === 'interval'`. The backend converts it
   *  to a cron on save (see {@link cronEffective}). */
  intervalSec?: number
  /** IANA timezone the cron is evaluated in (e.g. `Europe/Berlin`). Empty = UTC. */
  timezone?: string
  /** Read-only, backend-computed: the single cron the scheduler actually runs —
   *  the given `cron`, or the one derived from `intervalSec`. Lets the UI show
   *  what an interval resolves to. */
  cronEffective?: string
  /** Read-only, backend-computed: epoch millis of the next fire. */
  nextAt?: number
  /** Read-only: epoch millis of the last fire, 0 if never. */
  lastAt?: number
}

export type Trigger = WebhookTrigger | ScheduleTrigger

// --- Inflow engine dispatch pool ---------------------------------------------

/** One engine instance in the inflow dispatch pool, as the settings dialog sees
 *  it. Runtime-only: the pool lives in the inflow-fusion SDK, not the database,
 *  so these rows are never persisted locally. The resource's bearer token is
 *  never sent to the client. */
export interface InflowResource {
  name: string
  url: string
  tags: string[]
  /** True for the single resource all dispatch is currently pinned to. */
  pinned: boolean
}

/** GET /resource — the live dispatch pool plus the name of the pinned resource
 *  (empty when dispatch round-robins across the whole pool). */
export interface InflowResourcePool {
  list: InflowResource[]
  pinned: string
}

/** Body of POST /resource — add one engine instance by hand. */
export interface AddInflowResourceInput {
  name?: string
  url: string
  /** Bearer secret for this resource; blank falls back to the infra bearer. */
  token?: string
  tags?: string[]
  /** "Use just this one" — tag the resource so all dispatch pins to it. */
  pin?: boolean
}
