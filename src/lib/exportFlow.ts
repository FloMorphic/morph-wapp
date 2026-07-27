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
 * The other artefact this module serves is the canvas snapshot, a PNG rendered
 * by the canvas itself (see WorkflowCanvas.captureImage).
 */

import { graphToPatch, type AiGraphPatch } from '@/lib/aiGraph'
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
