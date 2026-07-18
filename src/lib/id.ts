/** Short, URL-safe, time-ordered id — good enough for local records. */
export function createId(prefix = ''): string {
  const time = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  const id = `${time}${rand}`
  return prefix ? `${prefix}_${id}` : id
}

export function now(): number {
  return Date.now()
}
