/**
 * Taking a workflow *out* of FloMorphic — the mirror of the AI importer, and
 * written in its language: the exported file **is** a graph patch
 * ({@link AiGraphPatch}, see lib/aiGraph) under a small header.
 *
 * That is the whole point of the format. The patch is the model-facing,
 * human-readable form of a workflow — designer refs instead of generated ids,
 * ports named the way the designer prompt teaches them, and only the settings a
 * node actually changed — so one document serves every direction: save it as a
 * file, paste it into "Build with AI" to put it back on a canvas, or hand it to
 * an assistant and ask for a change. `parseAiGraph` reads `nodes` / `edges` and
 * ignores the header, so the file needs no unwrapping to be pasted anywhere the
 * importer accepts text.
 *
 * It is a *design-time* document: nodes, wiring and configured values, never a
 * run, a context or a credential. Canvas ids and the local extension identity
 * are dropped on the way out (see {@link graphToPatch}) — a file is meant to
 * land on another install — so a re-import mints fresh ids and re-stamps the
 * plugin rows from that install's own table. A node's settings profile leaves by
 * reference only (its `settingsId`); the profile's resolved values — which hold
 * the provider token — are never written to the file, and the importing install
 * re-resolves the id against its own profiles.
 *
 * Reading one back ({@link parseWorkflowFile}) is deliberately forgiving: any
 * document with a `nodes` array is accepted, header or not, so a bare patch a
 * model wrote is as importable as a file this app exported. Everything past
 * that point is the same road the pasted-patch path takes — planPatch validates
 * it and the review shows what would land before anything is applied.
 *
 * The other artefact this module serves is the canvas snapshot, a PNG rendered
 * by the canvas itself (see WorkflowCanvas.captureImage).
 */

import { graphToPatch, parseAiGraph, type AiGraphPatch } from '@/lib/aiGraph'
import type { VueFlowGraph } from '@/types/api'

/** Bumped only if the header's shape changes — the patch versions with the catalog. */
export const WORKFLOW_FILE_VERSION = 1

/**
 * One imported plugin a workflow depends on, recorded so a target install can
 * tell the designer what to install before the flow will run.
 *
 * The match key is `actions`, not a plugin id. An install's `pluginId` is a
 * per-install *address* — `slug(name)-<uuid>`, minted by the backend on
 * registration and never portable (see flomorphic-api resolvePluginID) — so it
 * cannot identify the same plugin on another machine. What *is* stable is the
 * action method names the plugin declares in its `@actions` (`qdrant.points.
 * search`, …): the same on every install of that plugin. The target checks those
 * against the methods its own registered plugins expose to know what's missing,
 * and `repo` / `name` answer "which plugin, and where do I get it".
 *
 * Nothing here is required to import: a file with no manifest still imports, it
 * just can't name a repo for a plugin the target is missing.
 */
export interface PluginManifestEntry {
  /** The plugin's display name on the exporting install, for the note. */
  name: string
  /** The action methods this flow uses from the plugin (e.g. `qdrant.points.
   *  search`) — the portable key the target matches against its own plugins. */
  actions: string[]
  /** Git remote to clone, when the exporting install registered one. */
  repo?: string
  /** Branch / tag / commit, when pinned. */
  ref?: string
  /** Path inside the repo, for a multi-plugin repo. */
  subdir?: string
}

/** What the exporting install knows about one of its registered plugins — the
 *  source `buildWorkflowExport` draws a manifest entry's name/repo from, keyed by
 *  the install-local `pluginId` only to group the graph's nodes (never written). */
export interface AvailablePlugin {
  pluginId: string
  name: string
  repo?: string
  ref?: string
  subdir?: string
}

/**
 * Stamped onto a plugin node at import when the target has no plugin providing
 * its action — the "unrecognized plugin" marker the canvas badges and the node
 * drawer turns into an install / pick-a-plugin helper. It carries only what the
 * node needs to name the plugin and offer its repo; it is cleared the moment the
 * node is bound to a local plugin (see WorkflowCanvas.stampPluginRef).
 */
export interface MissingPlugin {
  name: string
  repo?: string
  ref?: string
  subdir?: string
}

export interface WorkflowExport extends AiGraphPatch {
  flomorphic: {
    kind: 'workflow'
    version: number
    /** ISO 8601, for the reader's benefit — nothing reads it back. */
    exportedAt: string
  }
  title: string
  /** The imported plugins this flow uses, when it uses any — the import dialog
   *  diffs these against what the target has installed (see parseWorkflowFile). */
  plugins?: PluginManifestEntry[]
}

/**
 * `available` is the plugins the exporting install has, keyed however the caller
 * fetched them; only the ones this graph actually references are written, and a
 * referenced plugin missing from `available` is still listed by id so the target
 * can at least name it (it just has no repo to offer).
 */
export function buildWorkflowExport(
  title: string,
  graph: VueFlowGraph,
  available: AvailablePlugin[] = [],
): WorkflowExport {
  const plugins = pluginManifest(graph, available)
  return {
    flomorphic: { kind: 'workflow', version: WORKFLOW_FILE_VERSION, exportedAt: new Date().toISOString() },
    title: title.trim() || 'Untitled workflow',
    ...(plugins.length ? { plugins } : {}),
    ...graphToPatch(graph),
  }
}

/** Pretty-printed on purpose: the file is meant to be read, diffed and pasted into a chat. */
export function workflowExportJson(title: string, graph: VueFlowGraph, available: AvailablePlugin[] = []): string {
  return `${JSON.stringify(buildWorkflowExport(title, graph, available), null, 2)}\n`
}

/**
 * One manifest entry per plugin the graph's `plugin` nodes reach, carrying the
 * action methods used and the name/repo of the plugin behind them. Nodes are
 * grouped by their install-local `pluginId` (so one plugin's methods land in one
 * entry) but that id is never written — only the portable `actions` are.
 */
function pluginManifest(graph: VueFlowGraph, available: AvailablePlugin[]): PluginManifestEntry[] {
  const byId = new Map(available.map((p) => [p.pluginId, p]))
  const groups = new Map<string, { info?: AvailablePlugin; actions: Set<string> }>()
  for (const n of graph.nodes ?? []) {
    if (n.type !== 'plugin') continue
    const data = n.data as Record<string, unknown> | undefined
    const pluginId = String(data?.pluginId ?? '').trim()
    const action = String(data?.action ?? '').trim()
    // Group by the plugin (its local id), or by the action alone when a node
    // carries no id — either way the entry is keyed for the target by `actions`.
    const key = pluginId || action
    if (!key) continue
    const g = groups.get(key) ?? { info: byId.get(pluginId), actions: new Set<string>() }
    if (action) g.actions.add(action)
    groups.set(key, g)
  }
  const out: PluginManifestEntry[] = []
  for (const [key, g] of groups) {
    const actions = [...g.actions].sort()
    out.push({
      name: g.info?.name || namespaceOf(actions[0]) || key,
      actions,
      repo: g.info?.repo,
      ref: g.info?.ref,
      subdir: g.info?.subdir,
    })
  }
  return out
}

/** The plugin's namespace — the token an action method leads with (`qdrant` of
 *  `qdrant.points.search`) — a readable last-resort label when nothing named it. */
export function namespaceOf(action: string | undefined): string {
  return String(action ?? '').split('.')[0] ?? ''
}

export interface WorkflowFile {
  /** The patch to plan and apply, or null when the text isn't one. */
  patch: AiGraphPatch | null
  /** Why it could not be read, for the dialog to show. */
  error: string | null
  /** The workflow's own name, when the file carries a header. */
  title?: string
  /** Set when the header claims a format newer than this app writes. */
  newerVersion?: number
  /** The imported plugins the file declares it depends on, when it carries a
   *  manifest — the source the import dialog names a missing plugin's repo from. */
  plugins?: PluginManifestEntry[]
}

/**
 * The distinct action methods a patch's `plugin` nodes call — the portable ids a
 * target install checks against the methods its own plugins expose to warn about
 * the missing ones. Reads straight off the nodes, so it works on any patch, with
 * or without a manifest; the manifest only adds the name and repo for display.
 */
export function referencedActions(patch: AiGraphPatch): string[] {
  const actions = new Set<string>()
  for (const n of patch.nodes ?? []) {
    if (n.kind !== 'plugin') continue
    const action = String((n.data as Record<string, unknown> | undefined)?.action ?? '').trim()
    if (action) actions.add(action)
  }
  return [...actions]
}

/**
 * Read an exported workflow (or any patch JSON) back into something planPatch
 * can take. The header is optional — a file's `title` is used to name the
 * workflow, and a `version` from the future is reported rather than refused,
 * since a newer file is usually still readable and the review will show what
 * this app made of it.
 */
export function parseWorkflowFile(text: string): WorkflowFile {
  const { patch, error } = parseAiGraph(text)
  if (!patch) return { patch: null, error: error ?? 'That file holds no workflow — expected a JSON object with a "nodes" array.' }

  const header = readHeader(text)
  return {
    patch,
    error: null,
    title: header.title,
    newerVersion: header.version && header.version > WORKFLOW_FILE_VERSION ? header.version : undefined,
    plugins: header.plugins,
  }
}

/** The envelope fields around the patch, when the document has them. */
function readHeader(text: string): { title?: string; version?: number; plugins?: PluginManifestEntry[] } {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>
    const meta = (raw?.flomorphic ?? {}) as Record<string, unknown>
    return {
      title: typeof raw?.title === 'string' && raw.title.trim() ? raw.title.trim() : undefined,
      version: typeof meta.version === 'number' ? meta.version : undefined,
      plugins: readManifest(raw?.plugins),
    }
  } catch {
    // Fenced or prose-wrapped JSON still planned fine above; it just has no header.
    return {}
  }
}

/** The `plugins` array of the header, kept only where an entry names actions. */
function readManifest(value: unknown): PluginManifestEntry[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: PluginManifestEntry[] = []
  for (const raw of value) {
    const row = raw as Record<string, unknown> | null
    const actions = Array.isArray(row?.actions)
      ? row.actions.map((a) => String(a ?? '').trim()).filter(Boolean)
      : []
    if (!actions.length) continue
    out.push({
      name: String(row?.name ?? '').trim() || namespaceOf(actions[0]) || 'Plugin',
      actions,
      repo: str(row?.repo),
      ref: str(row?.ref),
      subdir: str(row?.subdir),
    })
  }
  return out.length ? out : undefined
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/** Workflow title → a safe, readable file-name stem. */
export function fileBase(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return slug || 'workflow'
}

/** Save `data` (a Blob or a data URL) to the user's downloads as `filename`. */
export function downloadFile(data: Blob | string, filename: string): void {
  const url = typeof data === 'string' ? data : URL.createObjectURL(data)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Only our own object URLs are ours to release; a data: URL has nothing to free.
  if (typeof data !== 'string') setTimeout(() => URL.revokeObjectURL(url), 0)
}
