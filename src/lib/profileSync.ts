import type { NodeSetting } from '@/types/api'
import { ApiError } from '@/api/client'
import { nodeSettingsApi } from '@/api/nodeSettings'
import { usesSettingsProfile } from '@/lib/nodeSettings'

/**
 * Keeping a node's denormalized settings-profile copy in step with the store.
 *
 * A profile's resolved values are copied onto every canvas node bound to it
 * (`data.settings` / `data.settingsName`) so the backend compiler can ship them
 * without reading the profile store. That copy is frozen at save time, which
 * means a profile edited anywhere else leaves its nodes holding an older
 * version. This module is the one place that re-resolves those copies:
 *
 *   - `resolveNodeSettingsProfiles` — a background sweep over a graph (or a
 *     patch on its way in), fetching each DISTINCT profile id exactly once.
 *   - `applySettingsProfileCopy` — the in-place write every caller shares, so
 *     the drawer's save, the canvas sync and the open-flow sweep all write the
 *     same shape and the same reference-only rule.
 *
 * Two details keep the sweep quiet and correct:
 *
 *   - Values are compared with a key-order-insensitive fingerprint. The store
 *     can hand back an object with its keys in another order (JSONB, a Go map)
 *     while saying exactly the same thing; a plain JSON.stringify would call
 *     that a change on every open, which is what produced the endless "N nodes
 *     re-synced" notices.
 *   - A read that FAILS (network, server error) is not the same as a profile
 *     that does not exist. Only a definite "not found" clears a node's copy; a
 *     transient failure leaves the node alone, so a brief outage never wipes a
 *     profile's values out of the graph.
 */

/** The node shape this module needs — a canvas node, a planned patch node, etc. */
export interface ProfileBoundNode {
  type?: string
  data?: unknown
}

/** A key-order-insensitive rendering of a settings object, for comparisons. */
export function settingsFingerprint(value: unknown): string {
  return canonical(value)
}

function canonical(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`
}

/** Whether a node's `data.settings` already says exactly what the profile says. */
export function sameSettings(a: unknown, b: unknown): boolean {
  return settingsFingerprint(a) === settingsFingerprint(b)
}

/** True only for a definite "this id does not exist", not a transient failure. */
function isMissingProfile(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 404
  return /not found/i.test((err as Error)?.message ?? '')
}

/** `undefined` means "could not read, leave the node alone"; `null` means absent. */
type Lookup = NodeSetting | null | undefined

async function lookupProfile(id: string, cache: Map<string, Promise<Lookup>>): Promise<Lookup> {
  let pending = cache.get(id)
  if (!pending) {
    pending = nodeSettingsApi.get(id).catch((err) => (isMissingProfile(err) ? null : undefined))
    cache.set(id, pending)
  }
  return pending
}

/**
 * Write one profile onto a node's `data`, honoring the reference-only rule.
 *
 * Plugin-backed nodes denormalize the values (the compiler ships them); a
 * reference-only node — HITL, whose provider config the backend reads from the
 * store at run time — takes only the label and must never carry `settings`.
 * Returns whether anything actually changed, so callers can avoid marking a
 * flow dirty (or saving it) for a no-op.
 */
export function applySettingsProfileCopy(
  data: Record<string, unknown>,
  profile: NodeSetting | null,
  denormalizes: boolean,
): boolean {
  let changed = false
  const name = profile?.title ?? ''
  if (String(data.settingsName ?? '') !== name) {
    data.settingsName = name
    changed = true
  }
  if (denormalizes) {
    const next = profile ? { ...profile.settings } : {}
    if (!sameSettings(data.settings, next)) {
      data.settings = next
      changed = true
    }
  } else if ('settings' in data) {
    // A stray copy (an old save, an imported file) would write the token into
    // the graph; strip it. The reference-only node reads the store by id.
    delete data.settings
    changed = true
  }
  return changed
}

/**
 * Re-resolve every `settingsId` in `nodes` against the profile store, mutating
 * each node's `data` in place. Returns how many nodes changed.
 *
 * Async and shared by design: one request per distinct profile id (not per
 * node), so a flow with twenty nodes on one profile costs one read. Callers
 * that need the graph ready before rendering (import) await it; an opened flow
 * runs it in the background and repaints as the answers land.
 */
export async function resolveNodeSettingsProfiles(nodes: ReadonlyArray<ProfileBoundNode>): Promise<number> {
  const targets: Array<{ node: ProfileBoundNode; data: Record<string, unknown>; id: string }> = []
  for (const node of nodes) {
    if (!node || typeof node.data !== 'object' || node.data === null) continue
    const data = node.data as Record<string, unknown>
    const id = String(data.settingsId ?? '').trim()
    if (!id) continue
    targets.push({ node, data, id })
  }
  if (!targets.length) return 0

  const cache = new Map<string, Promise<Lookup>>()
  let changed = 0
  await Promise.all(
    targets.map(async ({ node, data, id }) => {
      const profile = await lookupProfile(id, cache)
      // Unreadable (not missing): keep the copy the node already has.
      if (profile === undefined) return
      // `data` may not carry the type; use the node's.
      const denormalizes = usesSettingsProfile(String(node.type ?? ''), data)
      if (applySettingsProfileCopy(data, profile, denormalizes)) changed++
    }),
  )
  return changed
}
