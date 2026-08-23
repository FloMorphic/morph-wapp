/**
 * Orthogonal, obstacle-avoiding edge routing for the workflow canvas.
 *
 * Vue Flow's built-in edge types (bezier / smoothstep / step) draw the shortest
 * line between two ports with no awareness of the nodes in between, so an edge —
 * a loop-back one especially — runs straight over the node bodies sitting in its
 * way and disappears behind them (edges are painted in the pane *below* the
 * nodes). This routes each edge the way a person would: out of the port, through
 * the empty channels *around* the nodes with a fixed clearance, and into the
 * target port from the correct side.
 *
 * The method is the standard one for orthogonal connector routing:
 *
 *   1. inflate every node by `padding` — the clearance the route keeps
 *   2. build a lattice (a Hanan grid) from the inflated borders plus the two
 *      endpoints and an outer margin lane, so a route can also go around the
 *      *outside* of everything
 *   3. drop lattice points that fall inside a node, and lattice segments that
 *      cross one
 *   4. A* from the source stub to the target stub, charging a penalty per 90°
 *      turn so the result prefers a few long runs over a staircase
 *
 * Dependency-free and geometry-only: it takes rectangles and two port anchors
 * and returns the bend points. The caller ({@link WorkflowCanvas}) turns those
 * into an SVG path for a custom edge; when no path is found (nodes overlapping,
 * nothing measured yet) it returns null and the edge falls back to smoothstep.
 */

import type { InjectionKey, Ref } from 'vue'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
export interface Point {
  x: number
  y: number
}
export type Side = 'left' | 'right' | 'top' | 'bottom'

export interface RouteRequest {
  /** Port anchor the edge leaves from, and which side of its node it sits on. */
  source: Point
  sourceSide: Side
  /** Port anchor the edge arrives at, and which side of its node it sits on. */
  target: Point
  targetSide: Side
}

export interface RouteOptions {
  /** Clearance kept around every node (obstacles are inflated by this). */
  padding: number
  /** Straight stub a route runs off a port before it may turn. Keep > padding. */
  nub: number
  /** Cost added per 90° turn, in px, so a route prefers fewer bends. */
  bendPenalty: number
  /** Outer lane distance beyond the outermost node, so a route can go around. */
  margin: number
}

export const DEFAULT_ROUTE_OPTIONS: RouteOptions = {
  padding: 18,
  nub: 24,
  bendPenalty: 40,
  margin: 40,
}

/** Precomputed render data for one edge, shared canvas → custom edge. */
export interface RoutedPath {
  /** SVG path `d` with rounded corners. */
  path: string
  /** Midpoint of the routed polyline, for a label if one is ever shown. */
  labelX: number
  labelY: number
}

/** Injection key for the canvas-computed routes the custom edge reads. */
export const ROUTED_PATHS: InjectionKey<Ref<Map<string, RoutedPath>>> = Symbol('routedPaths')

/** Unit vector pointing out of a node from a port on the given side. */
function outward(side: Side): Point {
  switch (side) {
    case 'left':
      return { x: -1, y: 0 }
    case 'right':
      return { x: 1, y: 0 }
    case 'top':
      return { x: 0, y: -1 }
    case 'bottom':
      return { x: 0, y: 1 }
  }
}

const EPS = 0.5

/** Strictly inside the rect (points/segments on the border are allowed). */
function inside(px: number, py: number, r: Rect): boolean {
  return px > r.x + EPS && px < r.x + r.width - EPS && py > r.y + EPS && py < r.y + r.height - EPS
}

function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, width: r.width + by * 2, height: r.height + by * 2 }
}

function sortedUnique(values: number[]): number[] {
  const out = [...new Set(values.map((v) => Math.round(v)))]
  out.sort((a, b) => a - b)
  return out
}

/**
 * Route one edge around `nodes`. Returns the bend points (endpoints included) or
 * null when no orthogonal path exists — the caller then falls back to a plain
 * edge rather than drawing nothing.
 */
export function routeEdge(req: RouteRequest, nodes: Rect[], opts: RouteOptions): Point[] | null {
  const { padding, nub, bendPenalty, margin } = opts
  const obstacles = nodes.map((n) => inflate(n, padding))

  const sVec = outward(req.sourceSide)
  const tVec = outward(req.targetSide)
  // Stubs: the route commits to leaving/entering along the port's own side
  // before A* is free to turn, so an edge never peels sideways off a port.
  const s1: Point = { x: req.source.x + sVec.x * nub, y: req.source.y + sVec.y * nub }
  const t1: Point = { x: req.target.x + tVec.x * nub, y: req.target.y + tVec.y * nub }

  // Coordinate lines: every inflated border, the stub points, and an outer lane
  // beyond the bounding box so a route can wrap around the outside of the graph.
  const bxs = obstacles.flatMap((r) => [r.x, r.x + r.width])
  const bys = obstacles.flatMap((r) => [r.y, r.y + r.height])
  const allX = [...bxs, s1.x, t1.x]
  const allY = [...bys, s1.y, t1.y]
  const minX = Math.min(...allX) - margin
  const maxX = Math.max(...allX) + margin
  const minY = Math.min(...allY) - margin
  const maxY = Math.max(...allY) + margin

  const xs = sortedUnique([...bxs, s1.x, t1.x, minX, maxX])
  const ys = sortedUnique([...bys, s1.y, t1.y, minY, maxY])
  const nx = xs.length
  const ny = ys.length
  const xi = new Map(xs.map((v, i) => [v, i]))
  const yi = new Map(ys.map((v, i) => [v, i]))

  const si = xi.get(Math.round(s1.x))
  const sj = yi.get(Math.round(s1.y))
  const ti = xi.get(Math.round(t1.x))
  const tj = yi.get(Math.round(t1.y))
  if (si == null || sj == null || ti == null || tj == null) return null

  const idx = (i: number, j: number) => j * nx + i
  const startId = idx(si, sj)
  const goalId = idx(ti, tj)

  // A lattice point is usable unless it sits inside a node; the two stub points
  // are forced usable so a route can start/finish even if a node overlaps them.
  const passable = (i: number, j: number): boolean => {
    const id = idx(i, j)
    if (id === startId || id === goalId) return true
    const x = xs[i]
    const y = ys[j]
    for (const r of obstacles) if (inside(x, y, r)) return false
    return true
  }

  // A lattice segment is clear unless its midpoint lies inside a node. Because
  // every node border is a grid line, a segment between two adjacent lattice
  // points is uniformly inside or outside each node, so the midpoint decides it.
  const clearH = (i0: number, i1: number, j: number): boolean => {
    const mx = (xs[i0] + xs[i1]) / 2
    const y = ys[j]
    for (const r of obstacles) if (inside(mx, y, r)) return false
    return true
  }
  const clearV = (i: number, j0: number, j1: number): boolean => {
    const x = xs[i]
    const my = (ys[j0] + ys[j1]) / 2
    for (const r of obstacles) if (inside(x, my, r)) return false
    return true
  }

  // Direction codes for the bend penalty: which way we entered a lattice point.
  const DIR = { none: 0, xpos: 1, xneg: 2, ypos: 3, yneg: 4 } as const
  type Dir = (typeof DIR)[keyof typeof DIR]

  interface State {
    i: number
    j: number
    dir: Dir
  }
  const stateKey = (i: number, j: number, dir: Dir) => (j * nx + i) * 5 + dir

  const gScore = new Map<number, number>()
  const cameFrom = new Map<number, number>()
  const heap = new MinHeap<{ f: number; g: number; s: State }>((a, b) => a.f - b.f)

  const h = (i: number, j: number) => Math.abs(xs[i] - xs[ti]) + Math.abs(ys[j] - ys[tj])
  const startState: State = { i: si, j: sj, dir: DIR.none }
  gScore.set(stateKey(si, sj, DIR.none), 0)
  heap.push({ f: h(si, sj), g: 0, s: startState })

  let goalKey: number | null = null

  while (heap.size) {
    const { g, s } = heap.pop()!
    const curKey = stateKey(s.i, s.j, s.dir)
    if (g > (gScore.get(curKey) ?? Infinity)) continue
    if (s.i === ti && s.j === tj) {
      goalKey = curKey
      break
    }

    // Four orthogonal neighbours; each is a candidate next lattice point.
    const steps: [number, number, Dir][] = [
      [s.i + 1, s.j, DIR.xpos],
      [s.i - 1, s.j, DIR.xneg],
      [s.i, s.j + 1, DIR.ypos],
      [s.i, s.j - 1, DIR.yneg],
    ]
    for (const [ni2, nj2, dir] of steps) {
      if (ni2 < 0 || ni2 >= nx || nj2 < 0 || nj2 >= ny) continue
      if (!passable(ni2, nj2)) continue
      const horiz = dir === DIR.xpos || dir === DIR.xneg
      if (horiz ? !clearH(s.i, ni2, s.j) : !clearV(s.i, s.j, nj2)) continue
      const dist = horiz ? Math.abs(xs[ni2] - xs[s.i]) : Math.abs(ys[nj2] - ys[s.j])
      const turn = s.dir !== DIR.none && s.dir !== dir ? bendPenalty : 0
      const ng = g + dist + turn
      const nk = stateKey(ni2, nj2, dir)
      if (ng < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, ng)
        cameFrom.set(nk, curKey)
        heap.push({ f: ng + h(ni2, nj2), g: ng, s: { i: ni2, j: nj2, dir } })
      }
    }
  }

  if (goalKey == null) return null

  // Walk the came-from chain back to the start, turning state keys into points.
  const lattice: Point[] = []
  let k: number | undefined = goalKey
  while (k !== undefined) {
    const cell = Math.floor(k / 5)
    lattice.push({ x: xs[cell % nx], y: ys[Math.floor(cell / nx)] })
    k = cameFrom.get(k)
  }
  lattice.reverse()

  // Real endpoints bookend the stub points, then collapse the collinear runs the
  // lattice left behind so the edge is a handful of segments, not dozens.
  return simplify([req.source, ...lattice, req.target])
}

/** Drop points that lie on a straight run between their neighbours. */
function simplify(points: Point[]): Point[] {
  if (points.length <= 2) return points
  const out: Point[] = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1]
    const b = points[i]
    const c = points[i + 1]
    const collinear =
      (Math.abs(a.x - b.x) < EPS && Math.abs(b.x - c.x) < EPS) ||
      (Math.abs(a.y - b.y) < EPS && Math.abs(b.y - c.y) < EPS)
    if (!collinear && !(Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS)) out.push(b)
  }
  out.push(points[points.length - 1])
  return out
}

/**
 * SVG `d` for a polyline with rounded corners. Each bend is replaced by a
 * quadratic curve of the given radius, shrunk when a segment is too short to
 * give it the full radius, so the corners stay clean on tight routes.
 */
export function roundedPath(points: Point[], radius = 8): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x},${points[0].y}`
  let d = `M ${points[0].x},${points[0].y}`
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]
    const cur = points[i]
    const next = points[i + 1]
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y)
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y)
    const r = Math.min(radius, inLen / 2, outLen / 2)
    const start = lerp(cur, prev, r / (inLen || 1))
    const end = lerp(cur, next, r / (outLen || 1))
    d += ` L ${start.x},${start.y} Q ${cur.x},${cur.y} ${end.x},${end.y}`
  }
  const last = points[points.length - 1]
  d += ` L ${last.x},${last.y}`
  return d
}

/** Point `t` of the way from `a` toward `b`. */
function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

/** Midpoint of a polyline by arc length — where a label would sit. */
export function midpoint(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 }
  let total = 0
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  let half = total / 2
  for (let i = 1; i < points.length; i++) {
    const seg = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    if (half <= seg) return lerp(points[i - 1], points[i], seg ? half / seg : 0)
    half -= seg
  }
  return points[points.length - 1]
}

/** A tiny binary min-heap — the A* frontier, kept dependency-free. */
class MinHeap<T> {
  private a: T[] = []
  constructor(private cmp: (x: T, y: T) => number) {}
  get size(): number {
    return this.a.length
  }
  push(v: T): void {
    const a = this.a
    a.push(v)
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.cmp(a[i], a[p]) >= 0) break
      ;[a[i], a[p]] = [a[p], a[i]]
      i = p
    }
  }
  pop(): T | undefined {
    const a = this.a
    if (a.length === 0) return undefined
    const top = a[0]
    const last = a.pop()!
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < a.length && this.cmp(a[l], a[m]) < 0) m = l
        if (r < a.length && this.cmp(a[r], a[m]) < 0) m = r
        if (m === i) break
        ;[a[i], a[m]] = [a[m], a[i]]
        i = m
      }
    }
    return top
  }
}
