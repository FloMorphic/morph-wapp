import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { GraphIndex, NamedEdge, NamedNode } from '@inflowenger/flow-trace'
import { flowsApi } from '@/api/flows'
import { portTags } from '@/data/nodeCatalog'
import type { FlowEdge, FlowNode } from '@/types/api'

/**
 * Lazy, read-only index of saved flow graphs, keyed by flow id.
 *
 * The runtime stream names things the only way it can: by id (`n_…`, `e_…`).
 * It deliberately carries no titles — the engine has no business shipping the
 * editor's labels, and an event that embedded them would be stale the moment
 * someone renames a node. So the drawer resolves ids against the *saved graph*
 * instead, fetching each referenced flow once and caching it here.
 *
 * This store is flow-trace's {@link GraphIndex}: hand it straight to
 * `resolveRefs` and any log line names itself.
 *
 * Everything is best-effort: an unresolvable id renders as itself. A flow that
 * fails to load is remembered as failed so a stream of events about it doesn't
 * turn into a stream of requests.
 */

/** A node as the editor draws it. Always has a `type`, unlike the base shape. */
export interface ResolvedNode extends NamedNode {
  type: string
}

export interface ResolvedEdge extends NamedEdge {
  sourceHandle?: string | null
}

interface CachedGraph {
  status: 'loading' | 'ready' | 'error'
  nodes: Record<string, ResolvedNode>
  edges: Record<string, ResolvedEdge>
}

/** A handler port on a node — `{ id, tags[], color }`, see NodeConfig.vue. */
interface Handler {
  id: string
  tags?: string[]
}

function indexNode(node: FlowNode): ResolvedNode {
  const title = String((node.data as Record<string, unknown>)?.title ?? '').trim()
  return { id: node.id, title: title || node.type, type: node.type }
}

/**
 * An edge's tags. A routed port carries them on the source node's port rather
 * than on the edge, so fall back to the port the edge leaves from — that is the
 * tag the user actually sees on the canvas. LLM function edges are stamped with
 * their tag on save, but graphs saved before that still need the derivation;
 * rule handlers only ever carry theirs on the node.
 */
function edgeTags(edge: FlowEdge, source?: FlowNode): string[] {
  const own = (edge.data?.tags ?? []) as string[]
  if (own.length > 0) return own
  const fromPort = portTags(source, edge.sourceHandle)
  if (fromPort?.length) return fromPort
  const handlers = ((source?.data as Record<string, unknown>)?.handlers ?? []) as Handler[]
  const handler = Array.isArray(handlers) ? handlers.find((h) => h.id === edge.sourceHandle) : undefined
  return handler?.tags ?? []
}

export const useFlowGraphsStore = defineStore('flowGraphs', () => {
  const graphs = ref<Record<string, CachedGraph>>({})
  // Flows already asked for, tracked outside Vue's reactivity: `ensure` is
  // called from render effects, and a reactive read there would re-run them
  // every time any graph resolves.
  const requested = new Set<string>()

  function ensure(flowId?: string): void {
    if (!flowId || requested.has(flowId)) return
    requested.add(flowId)
    graphs.value[flowId] = { status: 'loading', nodes: {}, edges: {} }
    void flowsApi
      .get(flowId)
      .then((record) => {
        const nodes: Record<string, ResolvedNode> = {}
        const byId = new Map<string, FlowNode>()
        for (const n of record.view_flow?.nodes ?? []) {
          byId.set(n.id, n)
          nodes[n.id] = indexNode(n)
        }
        const edges: Record<string, ResolvedEdge> = {}
        for (const e of record.view_flow?.edges ?? []) {
          edges[e.id] = {
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle ?? null,
            tags: edgeTags(e, byId.get(e.source)),
          }
        }
        graphs.value[flowId] = { status: 'ready', nodes, edges }
      })
      .catch(() => {
        // A deleted flow, or a run from a flow this user can't read. Ids stay.
        graphs.value[flowId] = { status: 'error', nodes: {}, edges: {} }
      })
  }

  /** Loaded node, or undefined while the graph is still (or never) loading. */
  function node(flowId: string | undefined, nodeId: string): ResolvedNode | undefined {
    if (!flowId) return undefined
    return graphs.value[flowId]?.nodes[nodeId]
  }

  function edge(flowId: string | undefined, edgeId: string): ResolvedEdge | undefined {
    if (!flowId) return undefined
    return graphs.value[flowId]?.edges[edgeId]
  }

  /**
   * Tooltip for one reference: the id, plus what the graph knows about it. An
   * edge is described by its endpoints — the pair the routing decision is about.
   */
  function describe(flowId: string | undefined, kind: 'node' | 'edge', id: string): string {
    if (kind === 'node') {
      const found = node(flowId, id)
      return found ? `${id} · ${found.type}` : id
    }
    const found = edge(flowId, id)
    if (!found) return id
    const from = node(flowId, found.source)?.title ?? found.source
    const to = node(flowId, found.target)?.title ?? found.target
    return `${id} · ${from} → ${to}`
  }

  /**
   * Re-read a flow (or every loaded flow) after a save — rows already on screen
   * only ask for a graph once, so a dropped entry has to be refilled here or the
   * drawer falls back to bare ids for the rest of the session.
   */
  function invalidate(flowId?: string): void {
    // Only flows already in the cache — saving a flow nobody is watching logs
    // for should not pull its graph down.
    const stale = flowId ? (graphs.value[flowId] ? [flowId] : []) : Object.keys(graphs.value)
    for (const id of stale) {
      requested.delete(id)
      delete graphs.value[id]
      ensure(id)
    }
  }

  // `node` / `edge` are flow-trace's GraphIndex, so the store itself can be
  // handed to resolveRefs.
  const index: GraphIndex = { node, edge }
  return { graphs, ensure, describe, invalidate, ...index }
})
