import { CONFIG } from './const'
import type { Transition } from './types'

const BEZIERS: Record<string, [number, number, number, number]> = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
}

const bezier = (x1: number, y1: number, x2: number, y2: number) => {
  const at = (a: number, b: number, u: number) => ((1 - 3 * b + 3 * a) * u + (3 * b - 6 * a)) * u * u + 3 * a * u
  return (t: number) => {
    let lo = 0
    let hi = 1
    let u = t
    for (let i = 0; i < 24; i++) {
      const x = at(x1, x2, u)
      if (Math.abs(x - t) < 1e-4) break
      if (x < t) lo = u
      else hi = u
      u = (lo + hi) / 2
    }
    return at(y1, y2, u)
  }
}

const linear = (body: string) => {
  const stops = body.split(',').map((entry) => {
    const [value, ...pos] = entry.trim().split(/\s+/)
    return { v: parseFloat(value), p: pos.map((s) => parseFloat(s) / 100) }
  })
  const points: [number, number][] = []
  for (let i = 0; i < stops.length; i++) {
    const { v, p } = stops[i]
    if (!p.length) points.push([NaN, v])
    else for (const x of p) points.push([x, v])
  }
  points[0][0] = isNaN(points[0][0]) ? 0 : points[0][0]
  points[points.length - 1][0] = isNaN(points[points.length - 1][0]) ? 1 : points[points.length - 1][0]
  for (let i = 1; i < points.length; i++) {
    if (!isNaN(points[i][0])) {
      points[i][0] = Math.max(points[i][0], points[i - 1][0])
      continue
    }
    let j = i
    while (isNaN(points[j][0])) j++
    const step = (points[j][0] - points[i - 1][0]) / (j - i + 1)
    for (let k = i; k < j; k++) points[k][0] = points[i - 1][0] + step * (k - i + 1)
  }
  return (t: number) => {
    if (t <= points[0][0]) return points[0][1]
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = points[i - 1]
      const [x1, y1] = points[i]
      if (t <= x1) return x1 === x0 ? y1 : y0 + ((y1 - y0) * (t - x0)) / (x1 - x0)
    }
    return points[points.length - 1][1]
  }
}

/** Evaluates a CSS easing string as a function of normalised time. */
export const easingFn = (easing: string): ((t: number) => number) => {
  const s = easing.trim()
  if (s.startsWith('linear(')) return linear(s.slice(7, -1))
  const b = s.startsWith('cubic-bezier(') ? (s.slice(13, -1).split(',').map(Number) as [number, number, number, number]) : BEZIERS[s]
  return b && b.length === 4 && !b.some(isNaN) ? bezier(...b) : (t) => t
}

/** A glyph's place along the row, measured from the start edge. */
export type Glyph = { offset: number; width: number }

/** One glyph's contribution to the row's edge: it pushes (enter) or pulls (exit) by its width as it lands. */
export type Push = { delay: number; width: number; sign: 1 | -1 }

const overlap = (glyph: Glyph, others: Glyph[]) => {
  let sum = 0
  for (const o of others) {
    sum += Math.max(0, Math.min(glyph.offset + glyph.width, o.offset + o.width) - Math.max(glyph.offset, o.offset))
  }
  return sum
}

/**
 * Where an entering glyph stands on an exiting one, the two cross-fade in
 * place and move nothing; only the part of the row that one side has and the
 * other does not carries the edge. Pairing them off here rather than summing
 * signed pushes keeps a wholesale replacement from tugging the edge back and
 * forth while the two sides land on different curves.
 */
export const netPushes = (enters: Glyph[], exits: Glyph[], delayAt: (offset: number) => number): Push[] => {
  const pushes: Push[] = []
  const add = (glyphs: Glyph[], others: Glyph[], sign: 1 | -1) => {
    for (const g of glyphs) {
      const width = g.width - overlap(g, others)
      if (width > 0.01) pushes.push({ delay: delayAt(g.offset), width, sign })
    }
  }
  add(enters, exits, 1)
  add(exits, enters, -1)
  return pushes
}

const SAMPLES = 32

/**
 * The curve a displaced edge — the host's end, a kept run after the change,
 * every word after the host — follows over `total` ms, as `SAMPLES + 1` evenly
 * spaced values of its progress. Rather than run ahead of the roll on a fixed
 * ease, the edge is carried by the glyphs themselves: each entering glyph
 * pushes it by its own width and each exiting one pulls, in proportion to how
 * present the glyph looks, so the row reads as a wave the neighbours ride and
 * they arrive exactly as the last glyph does. Presence is the roll's progress
 * squared: a glyph fades, sharpens and scales up together, so it reads as
 * there later than its opacity alone says, and as gone sooner. A glyph only
 * starts to carry once it is `CONFIG.push` present, so the edge meets it
 * legible rather than sliding under a ghost, and it takes up and lays down
 * its share smoothly, so the sum of a row of them swells and settles instead
 * of ramping. Returns null when the pushes cancel out and there is no edge to
 * carry.
 */
export const edgeSamples = (pushes: Push[], transition: Transition, total: number) => {
  let final = 0
  for (const { width, sign } of pushes) final += width * sign
  if (Math.abs(final) < 0.5 || total <= 0) return null
  const roll = easingFn(transition.easing)
  const carried = (t: number, sign: 1 | -1) => {
    const p = t <= 0 ? 0 : t >= 1 ? 1 : roll(t)
    const presence = sign > 0 ? p * p : 1 - (1 - p) * (1 - p)
    const u = Math.min(1, Math.max(0, (presence - CONFIG.push) / (1 - CONFIG.push)))
    return u * u * (3 - 2 * u)
  }
  const out = new Array<number>(SAMPLES + 1)
  for (let i = 0; i <= SAMPLES; i++) {
    const t = (i / SAMPLES) * total
    let sum = 0
    for (const { delay, width, sign } of pushes) {
      sum += width * sign * carried((t - delay) / transition.duration, sign)
    }
    out[i] = i === SAMPLES ? 1 : sum / final || 0
  }
  return out
}

/** The same curve, started `lag` (a fraction of the whole) later; what has not landed by the end lands then. */
export const laggedSamples = (samples: number[], lag: number) => {
  const shift = lag * SAMPLES
  return samples.map((_, i) => {
    if (i === SAMPLES) return 1
    const at = i - shift
    if (at <= 0) return 0
    const lo = Math.floor(at)
    const f = at - lo
    return samples[lo] * (1 - f) + (samples[Math.min(lo + 1, SAMPLES)] ?? 1) * f
  })
}

/** Where along the whole the curve has landed, as a fraction. */
export const landedAt = (samples: number[]) => {
  let i = SAMPLES
  while (i > 0 && samples[i - 1] >= 0.999) i--
  return i / SAMPLES
}

export const linearOf = (samples: number[]) => `linear(${samples.map((v) => v.toFixed(4)).join(',')})`
