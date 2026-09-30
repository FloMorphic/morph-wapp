import type { InjectionKey } from 'vue'

/**
 * The canvas-level "peek at this node's scope" opener, shared with every node.
 *
 * A node's `scope` is a JSONPath into the run context, and until now reading it
 * meant leaving the canvas for the context page and retyping the expression
 * there. The nodes ask for the same answer in place instead: they hand their
 * identity and scope to the opener the canvas provides, and the canvas resolves
 * it against the context the flow last ran with (stores/lastRunContext) in one
 * dialog it owns — a node cannot host it itself, since a dialog inside a Vue Flow
 * node would ride the canvas transform.
 *
 * Provided as `null` where there is nothing to resolve against (no backend means
 * no runs, so no last context), which is how a node knows to hide the button.
 */
export interface NodeScopeProbe {
  nodeId: string
  /** The node's title, for the dialog header. */
  title: string
  /** Morphic node type, e.g. `llm` — shown beside the title. */
  type: string
  /** The node's JSONPath scope; empty reads as the whole document (`$`). */
  scope: string
  /** The node's result key, when it binds one — where its output lands. */
  key?: string
}

export type NodeScopeOpener = (probe: NodeScopeProbe) => void

export const OPEN_NODE_SCOPE: InjectionKey<NodeScopeOpener | null> = Symbol('openNodeScope')
