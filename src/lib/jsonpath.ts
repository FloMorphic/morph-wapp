/**
 * A small, dependency-free JSONPath evaluator, sized to the one job it has on
 * the context page: let a designer type the same `{{$.path}}` expression a node
 * carries and see, against a real document, exactly which values it resolves to
 * — the *scope* that node covers. It mirrors the subset the runtime resolves in
 * a node's `op` template (see the note in `lib/hitl.ts`), plus the selectors an
 * operator reaches for while exploring: wildcards, recursive descent, slices and
 * unions. It deliberately stops short of filter expressions (`[?(@.x>1)]`) —
 * those belong to querying, not to naming a scope.
 *
 * `queryJsonPath` returns one `PathMatch` per hit, each with a normalized,
 * copy-pasteable path (dot notation where a key is a bare identifier, bracket
 * notation otherwise) and the value found there. Syntax errors throw with a
 * caret pointing at the offending character so the query bar can show them.
 */

export interface PathMatch {
  /** Normalized location, e.g. `$.llm.messages[0].role` or `$['a-b'][2]`. */
  path: string
  value: unknown
}

/** One step in a compiled path. Recursive descent is its own step that expands
 * the working set to every descendant before the following step selects. */
type Segment =
  | { t: 'key'; key: string }
  | { t: 'index'; index: number }
  | { t: 'wildcard' }
  | { t: 'recurse' }
  | { t: 'slice'; start?: number; end?: number; step?: number }
  | { t: 'union'; items: (string | number)[] }

export class JsonPathError extends Error {
  constructor(
    message: string,
    /** 0-based index into the source expression the problem sits at. */
    readonly pos: number,
  ) {
    super(message)
    this.name = 'JsonPathError'
  }
}

// ---- Parsing ----------------------------------------------------------------

const IDENT_START = /[A-Za-z_$]/
const IDENT_PART = /[A-Za-z0-9_$]/

function parse(expr: string): Segment[] {
  const segments: Segment[] = []
  let i = 0
  const n = expr.length

  const fail = (msg: string, at = i): never => {
    throw new JsonPathError(msg, at)
  }

  // Leading `$` is optional — a bare `foo.bar` reads as `$.foo.bar`.
  if (expr[i] === '$') i++

  while (i < n) {
    const c = expr[i]
    if (c === '.') {
      if (expr[i + 1] === '.') {
        // `..` recursive descent — must be followed by a selector.
        segments.push({ t: 'recurse' })
        i += 2
        if (i >= n || expr[i] === '.') fail('Expected a name, "*" or "[…]" after ".."')
        if (expr[i] === '[') continue // bracket selector handled below
        if (expr[i] === '*') {
          segments.push({ t: 'wildcard' })
          i++
          continue
        }
        segments.push({ t: 'key', key: readIdent() })
        continue
      }
      i++ // consume the single dot
      if (expr[i] === '*') {
        segments.push({ t: 'wildcard' })
        i++
        continue
      }
      if (!IDENT_START.test(expr[i] ?? '')) fail('Expected a property name after "."')
      segments.push({ t: 'key', key: readIdent() })
      continue
    }
    if (c === '[') {
      segments.push(readBracket())
      continue
    }
    if (c === '*') {
      // Bare `*` as the first step, e.g. `$*` is unusual; treat as wildcard.
      segments.push({ t: 'wildcard' })
      i++
      continue
    }
    if (segments.length === 0 && IDENT_START.test(c)) {
      // Implicit root child: `foo.bar`.
      segments.push({ t: 'key', key: readIdent() })
      continue
    }
    fail(`Unexpected character "${c}"`)
  }

  return segments

  function readIdent(): string {
    const start = i
    if (!IDENT_START.test(expr[i] ?? '')) fail('Expected a property name')
    i++
    while (i < n && IDENT_PART.test(expr[i])) i++
    return expr.slice(start, i)
  }

  function readBracket(): Segment {
    const open = i
    i++ // consume '['
    skipWs()
    if (expr[i] === '*') {
      i++
      skipWs()
      expect(']')
      return { t: 'wildcard' }
    }
    if (expr[i] === "'" || expr[i] === '"') {
      // Quoted key(s): ['a'] or ['a','b'].
      const keys: string[] = [readString()]
      skipWs()
      while (expr[i] === ',') {
        i++
        skipWs()
        keys.push(readString())
        skipWs()
      }
      expect(']')
      return keys.length === 1 ? { t: 'key', key: keys[0] } : { t: 'union', items: keys }
    }
    // Numbers: index, slice or numeric union.
    const raw = readUntilBracketClose(open)
    return parseNumericBracket(raw, open + 1)
  }

  function parseNumericBracket(body: string, at: number): Segment {
    const trimmed = body.trim()
    if (trimmed.includes(':')) {
      const parts = trimmed.split(':')
      if (parts.length > 3) fail('A slice takes at most start:end:step', at)
      const [start, end, step] = parts.map((p) => (p.trim() === '' ? undefined : toInt(p, at)))
      return { t: 'slice', start, end, step }
    }
    if (trimmed.includes(',')) {
      const items = trimmed.split(',').map((p) => toInt(p, at))
      return { t: 'union', items }
    }
    return { t: 'index', index: toInt(trimmed, at) }
  }

  function readString(): string {
    const quote = expr[i]
    i++ // opening quote
    let out = ''
    while (i < n && expr[i] !== quote) {
      if (expr[i] === '\\' && i + 1 < n) {
        i++
        out += expr[i]
      } else {
        out += expr[i]
      }
      i++
    }
    if (i >= n) fail('Unterminated string in "[…]"')
    i++ // closing quote
    return out
  }

  function readUntilBracketClose(open: number): string {
    const start = i
    while (i < n && expr[i] !== ']') i++
    if (i >= n) fail('Missing "]"', open)
    const body = expr.slice(start, i)
    i++ // consume ']'
    return body
  }

  function toInt(s: string, at: number): number {
    const t = s.trim()
    if (!/^-?\d+$/.test(t)) fail(`Expected an integer, got "${t}"`, at)
    return parseInt(t, 10)
  }

  function expect(ch: string) {
    if (expr[i] !== ch) fail(`Expected "${ch}"`)
    i++
  }

  function skipWs() {
    while (i < n && /\s/.test(expr[i])) i++
  }
}

// ---- Evaluation -------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Every descendant of `value` (children first, depth-first), excluding itself. */
function descendants(value: unknown, path: PathStep[], out: RawMatch[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, idx) => {
      const p = [...path, { kind: 'index' as const, index: idx }]
      out.push({ path: p, value: item })
      descendants(item, p, out)
    })
  } else if (isObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      const p = [...path, { kind: 'key' as const, key: k }]
      out.push({ path: p, value: v })
      descendants(v, p, out)
    }
  }
}

type PathStep = { kind: 'key'; key: string } | { kind: 'index'; index: number }
interface RawMatch {
  path: PathStep[]
  value: unknown
}

function applySegment(seg: Segment, m: RawMatch): RawMatch[] {
  const { value, path } = m
  switch (seg.t) {
    case 'key':
      return isObject(value) && seg.key in value
        ? [{ path: [...path, { kind: 'key', key: seg.key }], value: value[seg.key] }]
        : []
    case 'index': {
      if (!Array.isArray(value)) return []
      const idx = seg.index < 0 ? value.length + seg.index : seg.index
      return idx >= 0 && idx < value.length
        ? [{ path: [...path, { kind: 'index', index: idx }], value: value[idx] }]
        : []
    }
    case 'wildcard':
      if (Array.isArray(value)) {
        return value.map((v, idx) => ({ path: [...path, { kind: 'index', index: idx }], value: v }))
      }
      if (isObject(value)) {
        return Object.entries(value).map(([k, v]) => ({
          path: [...path, { kind: 'key', key: k }],
          value: v,
        }))
      }
      return []
    case 'slice': {
      if (!Array.isArray(value)) return []
      return sliceIndices(value.length, seg).map((idx) => ({
        path: [...path, { kind: 'index', index: idx }],
        value: value[idx],
      }))
    }
    case 'union': {
      const out: RawMatch[] = []
      for (const item of seg.items) {
        if (typeof item === 'number') {
          out.push(...applySegment({ t: 'index', index: item }, m))
        } else {
          out.push(...applySegment({ t: 'key', key: item }, m))
        }
      }
      return out
    }
    case 'recurse':
      // Handled by the driver loop; never reaches here.
      return [m]
  }
}

function sliceIndices(len: number, s: { start?: number; end?: number; step?: number }): number[] {
  const step = s.step ?? 1
  if (step === 0) return []
  const norm = (v: number | undefined, dflt: number): number => {
    if (v === undefined) return dflt
    return v < 0 ? Math.max(len + v, step > 0 ? 0 : -1) : Math.min(v, step > 0 ? len : len - 1)
  }
  const out: number[] = []
  if (step > 0) {
    const start = norm(s.start, 0)
    const end = norm(s.end, len)
    for (let i = start; i < end; i += step) out.push(i)
  } else {
    const start = norm(s.start, len - 1)
    const end = norm(s.end, -1)
    for (let i = start; i > end; i += step) out.push(i)
  }
  return out
}

function renderPath(path: PathStep[]): string {
  let out = '$'
  for (const step of path) {
    if (step.kind === 'index') {
      out += `[${step.index}]`
    } else if (IDENT_START.test(step.key) && [...step.key].every((c) => IDENT_PART.test(c))) {
      out += `.${step.key}`
    } else {
      out += `['${step.key.replace(/'/g, "\\'")}']`
    }
  }
  return out
}

/**
 * Evaluate a JSONPath expression against `root` and return every match.
 * Throws {@link JsonPathError} on a malformed expression.
 */
export function queryJsonPath(root: unknown, expr: string): PathMatch[] {
  const trimmed = expr.trim()
  if (trimmed === '' || trimmed === '$') {
    return [{ path: '$', value: root }]
  }
  const segments = parse(trimmed)

  let current: RawMatch[] = [{ path: [], value: root }]
  for (const seg of segments) {
    if (seg.t === 'recurse') {
      const expanded: RawMatch[] = []
      for (const m of current) {
        expanded.push(m)
        descendants(m.value, m.path, expanded)
      }
      current = expanded
      continue
    }
    const next: RawMatch[] = []
    for (const m of current) next.push(...applySegment(seg, m))
    current = next
  }

  return current.map((m) => ({ path: renderPath(m.path), value: m.value }))
}
