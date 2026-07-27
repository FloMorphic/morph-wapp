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
 * plugin rows from that install's own table.
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

export interface WorkflowExport extends AiGraphPatch {
  flomorphic: {
    kind: 'workflow'
    version: number
    /** ISO 8601, for the reader's benefit — nothing reads it back. */
    exportedAt: string
  }
  title: string
}

export function buildWorkflowExport(title: string, graph: VueFlowGraph): WorkflowExport {
  return {
    flomorphic: { kind: 'workflow', version: WORKFLOW_FILE_VERSION, exportedAt: new Date().toISOString() },
    title: title.trim() || 'Untitled workflow',
    ...graphToPatch(graph),
  }
}

/** Pretty-printed on purpose: the file is meant to be read, diffed and pasted into a chat. */
export function workflowExportJson(title: string, graph: VueFlowGraph): string {
  return `${JSON.stringify(buildWorkflowExport(title, graph), null, 2)}\n`
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
  }
}

/** The envelope fields around the patch, when the document has them. */
function readHeader(text: string): { title?: string; version?: number } {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>
    const meta = (raw?.flomorphic ?? {}) as Record<string, unknown>
    return {
      title: typeof raw?.title === 'string' && raw.title.trim() ? raw.title.trim() : undefined,
      version: typeof meta.version === 'number' ? meta.version : undefined,
    }
  } catch {
    // Fenced or prose-wrapped JSON still planned fine above; it just has no header.
    return {}
  }
}

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
