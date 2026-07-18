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
