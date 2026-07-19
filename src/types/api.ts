/**
 * Wire types mirroring the Inflowenger `inspector-api` backend.
 * Kept 1:1 with the Go models so the API client is drop-in when a backend is
 * configured (see src/api). When no backend is set, the same shapes are
 * persisted locally (see src/lib/localStore.ts).
 */

/** Every response is wrapped in this envelope. `error` is null on success. */
export interface ApiEnvelope<T> {
  data: T
  error: unknown
}

/** Cursor-paginated list payload: `{ data: { list, next } }`. */
export interface PaginatedList<T> {
  list: T[]
  next: string
}

export interface PaginationParams {
  cursor?: string
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

export type ExtensionType = 'plugin' | 'extrinsic'

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
  type: ExtensionType
  name: string
  description: string
  icon: ExtensionIcon
  params: FormParameters
  bindTo: ExtensionBind
  createdAt: number
  updatedAt: number
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

/* ---- Project extensions (FloMorphic-specific) ----
 * Not the inspector's ExtensionRecord: a project extension is a source repo the
 * backend clones and runs with the given env so it can join the inflow
 * ecosystem. Once running it surfaces plugin nodes in the workflow palette.
 */
export type ExtensionStatus = 'registered' | 'installing' | 'running' | 'stopped' | 'error'

export interface EnvVar {
  key: string
  value: string
}

export interface ProjectExtension {
  id: string
  name: string
  /** Git repository to clone (e.g. https://github.com/org/inflow-plugin-x). */
  repo: string
  /** Optional branch / tag / commit. */
  ref: string
  description: string
  env: EnvVar[]
  status: ExtensionStatus
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
