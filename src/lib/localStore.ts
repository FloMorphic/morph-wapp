/**
 * Tiny namespaced localStorage helper used by the local persistence adapter,
 * so FloMorphic is fully usable with zero backend configured.
 */
const PREFIX = 'flomorphic:'

export function readCollection<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

export function writeCollection<T>(key: string, value: T[]): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch (err) {
    console.error('[FloMorphic] failed to persist', key, err)
  }
}

export function readValue<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function writeValue<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch (err) {
    console.error('[FloMorphic] failed to persist', key, err)
  }
}
