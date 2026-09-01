export type Slab = {
  turn: number
  tilt: number
  roll: number
  scale: number
  thick: number
  /** Screen-space nudge, since a turned slab's ink does not sit centred on its own origin. */
  lift: number
}

export const slab = (turn: number, tilt: number, roll = 0, scale = 1, thick = 1, lift = 0): Slab => ({
  turn,
  tilt,
  roll,
  scale,
  thick,
  lift,
})

export type Mark = {
  size: number
  depth: number
  gap: number
  focus: 'each' | 'shared'
  a: Slab
  b: Slab
  camera: number
  shade: number
  weight: number
  mode: 'solid' | 'outline' | 'both'
  ink: string
  line: string
  pad: number
}

export const DEFAULTS: Mark = {
  size: 100,
  depth: 22,
  gap: 62,
  focus: 'each',
  a: slab(0, 0),
  b: slab(0, 28),
  camera: 620,
  shade: 0.3,
  weight: 0,
  mode: 'solid',
  ink: '#f7f6f2',
  line: '#f7f6f2',
  pad: 24,
}

type Vec = [number, number, number]
type Point = [number, number]

/**
 * Corners of a box centred on its own origin, in the order the faces index. The
 * slab is a square standing on edge: as tall and as deep as the square, and only
 * as wide as its thickness, so head on it is the flat bar and a tilt turns it
 * like a wheel, bringing the top face over.
 */
const corners = (w: number, h: number, d: number): Vec[] => [
  [-w, -h, -d],
  [w, -h, -d],
  [w, h, -d],
  [-w, h, -d],
  [-w, -h, d],
  [w, -h, d],
  [w, h, d],
  [-w, h, d],
].map(([x, y, z]) => [x / 2, y / 2, z / 2] as Vec)

/** Wound counter-clockwise seen from outside, so the normal points out of the box. */
const FACES: [number, number, number, number][] = [
  [4, 5, 6, 7],
  [1, 0, 3, 2],
  [5, 1, 2, 6],
  [0, 4, 7, 3],
  [4, 0, 1, 5],
  [3, 7, 6, 2],
]

const rad = (deg: number) => (deg * Math.PI) / 180

// Tilt is negated so a positive one brings the top face over, the way a wheel
// turns towards you, rather than tipping the slab away and showing its foot.
const spin = ([x, y, z]: Vec, { turn, tilt, roll }: Slab): Vec => {
  const [sx, cx] = [Math.sin(rad(-tilt)), Math.cos(rad(-tilt))]
  const [sy, cy] = [Math.sin(rad(turn)), Math.cos(rad(turn))]
  const [sz, cz] = [Math.sin(rad(roll)), Math.cos(rad(roll))]
  const y1 = y * cx - z * sx
  const z1 = y * sx + z * cx
  const x2 = x * cy + z1 * sy
  const z2 = -x * sy + z1 * cy
  return [x2 * cz - y1 * sz, x2 * sz + y1 * cz, z2]
}

const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

const minus = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]

const LIGHT: Vec = [-0.35, -0.5, 0.79]

export type Facet = { points: Point[]; depth: number; light: number }

/**
 * One slab's visible faces, projected. The camera sits on +z looking back at the
 * origin, so a point nearer the lens is magnified by `camera / (camera - z)` and
 * a face whose normal turns away from the lens is dropped.
 */
const facets = (mark: Mark, piece: Slab, offset: number): Facet[] => {
  // Each slab keeps its own camera axis by default, so one left flat reads as
  // flat rather than showing the side face the lens would find off-centre.
  const shared = mark.focus === 'shared'
  const k = piece.scale
  const points = corners(mark.depth * k * piece.thick, mark.size * k, mark.size * k)
    .map((v) => spin(v, piece))
    .map(([x, y, z]) => [shared ? x + offset : x, y, z] as Vec)
  const out: Facet[] = []
  for (const face of FACES) {
    const [a, b, c] = [points[face[0]], points[face[1]], points[face[2]]]
    const normal = cross(minus(b, a), minus(c, b))
    const length = Math.hypot(...normal) || 1
    const unit = normal.map((n) => n / length) as Vec
    const eye = minus([0, 0, mark.camera], a)
    if (unit[0] * eye[0] + unit[1] * eye[1] + unit[2] * eye[2] <= 0) continue
    out.push({
      points: face.map((i) => {
        const [x, y, z] = points[i]
        const k = mark.camera / (mark.camera - z)
        return [x * k + (shared ? 0 : offset), y * k + piece.lift] as Point
      }),
      depth: face.reduce((sum, i) => sum + points[i][2], 0) / 4,
      light: unit[0] * LIGHT[0] + unit[1] * LIGHT[1] + unit[2] * LIGHT[2],
    })
  }
  return out
}

const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1)

const toRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  return hex.length === 4
    ? [((n >> 8) & 15) * 17, ((n >> 4) & 15) * 17, (n & 15) * 17]
    : [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** The face's own tone: lit faces keep the ink, turned ones fall towards black. */
const tone = (ink: string, light: number, shade: number) => {
  const k = 1 - shade * (1 - clamp01(light * 0.5 + 0.5))
  const [r, g, b] = toRgb(ink).map((c) => Math.round(c * k))
  return `rgb(${r} ${g} ${b})`
}

export type Span = 'height' | 'width'

/** `scale` sizes the whole slab; `thick` sizes only the edge it shows head on. */
export type Grow = 'scale' | 'thick'

const edgesOf = (mark: Mark, piece: Slab, axis: 0 | 1) => {
  const ns = facets(mark, piece, 0).flatMap((f) => f.points.map((p) => p[axis]))
  return ns.length ? { lo: Math.min(...ns), hi: Math.max(...ns) } : { lo: 0, hi: 0 }
}

const spanOf = (mark: Mark, piece: Slab, span: Span) => {
  const { lo, hi } = edgesOf(mark, piece, span === 'height' ? 1 : 0)
  return hi - lo
}

export const alignTop = (mark: Mark, piece: Slab, against: Slab) => {
  const shift = edgesOf(mark, against, 1).lo - edgesOf(mark, piece, 1).lo
  return Math.round((piece.lift + shift) * 100) / 100
}

/**
 * The scale that draws `piece` the same size as `against`. Perspective makes the
 * span a curve rather than a line, so each guess is refined against a fresh
 * measurement instead of being solved outright.
 */
export const matchScale = (mark: Mark, piece: Slab, against: Slab, span: Span, grow: Grow = 'scale') => {
  const target = spanOf(mark, against, span)
  let factor = piece[grow] || 1
  for (let i = 0; i < 4; i++) {
    const drawn = spanOf(mark, { ...piece, [grow]: factor }, span)
    if (!drawn) break
    factor *= target / drawn
  }
  return Math.round(factor * 1000) / 1000
}

export const build = (mark: Mark) => {
  const half = (mark.gap + mark.depth) / 2
  const all = [...facets(mark, mark.a, -half), ...facets(mark, mark.b, half)]
  all.sort((x, y) => x.depth - y.depth)
  const xs = all.flatMap((f) => f.points.map((p) => p[0]))
  const ys = all.flatMap((f) => f.points.map((p) => p[1]))
  const pad = mark.pad + mark.weight
  const box = {
    x: Math.min(...xs) - pad,
    y: Math.min(...ys) - pad,
    width: Math.max(...xs) - Math.min(...xs) + pad * 2,
    height: Math.max(...ys) - Math.min(...ys) + pad * 2,
  }
  return { facets: all, box }
}

const round = (n: number) => Math.round(n * 100) / 100

export const toSvg = (mark: Mark, title = 'scritto') => {
  const { facets: visible, box } = build(mark)
  const body = visible
    .map((facet) => {
      const points = facet.points.map(([x, y]) => `${round(x)},${round(y)}`).join(' ')
      const fill = mark.mode === 'outline' ? 'none' : tone(mark.ink, facet.light, mark.shade)
      const stroke =
        mark.mode === 'solid' && !mark.weight ? '' : ` stroke="${mark.line}" stroke-width="${mark.weight || 1}"`
      return `<polygon points="${points}" fill="${fill}"${stroke} />`
    })
    .join('\n    ')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(box.x)} ${round(box.y)} ${round(box.width)} ${round(box.height)}" width="${round(box.width)}" height="${round(box.height)}" role="img" aria-label="${title}">
    <g stroke-linejoin="round">
    ${body}
    </g>
  </svg>`
}
