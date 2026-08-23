import { SPACE } from './const'

export const BROWSER = 'window' in globalThis
export const ServerSafeHTMLElement = globalThis.HTMLElement ?? class {}

let reducedMotionQuery: MediaQueryList | undefined
export const isReducedMotion = () =>
  BROWSER && (reducedMotionQuery ??= window.matchMedia('(prefers-reduced-motion: reduce)')).matches

const CLIP_OVERFLOW = /auto|scroll|hidden|clip/

export const visibleClip = (el: HTMLElement) => {
  let top = 0
  let left = 0
  let bottom = window.innerHeight
  let right = window.innerWidth
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflow, overflowX, overflowY } = getComputedStyle(node)
    if (!CLIP_OVERFLOW.test(overflow) && !CLIP_OVERFLOW.test(overflowX) && !CLIP_OVERFLOW.test(overflowY)) continue
    const rect = node.getBoundingClientRect()
    top = Math.max(top, rect.top)
    left = Math.max(left, rect.left)
    bottom = Math.min(bottom, rect.bottom)
    right = Math.min(right, rect.right)
  }
  return { top, left, bottom, right }
}

/**
 * The box a ghost is expected to stay inside: the nearest ancestor that either
 * clips or paints an edge of its own, since that is what a reader sees as the
 * thing containing the value. Falls back to the viewport, which is why text
 * with a page around it reports acres of room and needs no fade.
 */
export const boundsOf = (el: HTMLElement) => {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node)
    const clips =
      CLIP_OVERFLOW.test(style.overflow) ||
      CLIP_OVERFLOW.test(style.overflowX) ||
      CLIP_OVERFLOW.test(style.overflowY)
    const paints =
      (style.backgroundImage !== 'none' ||
        (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent')) ??
      false
    const bordered = parseFloat(style.borderLeftWidth) > 0 || parseFloat(style.borderRightWidth) > 0
    if (clips || paints || bordered) return node.getBoundingClientRect()
  }
  return new DOMRect(0, 0, window.innerWidth, window.innerHeight)
}

export const isOnscreen = (el: HTMLElement) => {
  const clip = visibleClip(el)
  if (clip.bottom <= clip.top || clip.right <= clip.left) return false
  const rect = el.getBoundingClientRect()
  return rect.bottom > clip.top && rect.top < clip.bottom && rect.right > clip.left && rect.left < clip.right
}

/** A pooled glyph; `pooled` is the pool's claim on it. */
export type Char = HTMLElement & {
  pooled?: boolean
}

const CHAR_POOL: Char[] = []
const CHAR_POOL_MAX = 1024

export const createEl = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const el = document.createElement(tag)
  el.setAttribute('aria-hidden', 'true')
  if (className) el.className = className
  if (text) el.textContent = text
  return el
}

export const createChar = (text: string): Char => {
  const el = CHAR_POOL.pop()
  if (!el) return createEl('span', 'char', text)
  el.pooled = false
  resetAnim(el)
  el.textContent = text
  return el
}

export const releaseChar = (el: Char) => {
  // Teardown and the char's own exit callback both hand it back, in either order.
  if (el.pooled) return
  el.pooled = true
  resetAnim(el)
  el.remove()
  if (CHAR_POOL.length < CHAR_POOL_MAX) CHAR_POOL.push(el)
}

export const cancelAnim = (el: HTMLElement) => {
  const anims = el.getAnimations()
  for (let i = 0; i < anims.length; i++) anims[i].cancel()
}

export const clearAnimStyle = (el: HTMLElement) => {
  if (!el.hasAttribute('style')) return
  el.style.removeProperty('opacity')
  el.style.removeProperty('transform')
  el.style.removeProperty('filter')
  if (!el.getAttribute('style')) el.removeAttribute('style')
}

export const resetAnim = (el: HTMLElement) => {
  cancelAnim(el)
  clearAnimStyle(el)
}

export const finishIdentityAnim = (event: AnimationPlaybackEvent) => {
  const anim = event.currentTarget
  if (anim instanceof Animation && anim.playState === 'finished') anim.cancel()
}

export const flip = (el: HTMLElement, dx: number, duration: number, easing: string, alreadyCancelled = false) => {
  if (!dx) return
  if (!alreadyCancelled) cancelAnim(el)
  const anim = el.animate({ transform: [`translateX(${dx}px)`, ''] }, { duration, easing, fill: 'both' })
  anim.onfinish = finishIdentityAnim
  return anim
}

export const reconcileChildren = (parent: HTMLElement, nodes: HTMLElement[], start: number, end: number) => {
  let current = parent.firstChild
  for (let i = start; i < end; i++) {
    const node = nodes[i]
    if (node === current) current = current.nextSibling
    else parent.insertBefore(node, current)
  }
  while (current) {
    const next = current.nextSibling
    current.remove()
    current = next
  }
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

const splitGraphemes = (value: string): string[] => {
  const ascii = new Array<string>(value.length)
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code > 0x7f || (code === 0x0d && value.charCodeAt(i + 1) === 0x0a)) {
      const result: string[] = []
      for (const item of segmenter.segment(value)) result.push(item.segment === ' ' ? SPACE : item.segment)
      return result
    }
    ascii[i] = code === 0x20 ? SPACE : value[i]
  }
  return ascii
}

/** Alignments searched either side of the flush suffix, for an end that grew or shrank. */
const RUN_BAND = 2

/** One letter shared by two unrelated words ('seven' -> 'nine') is noise, not a run. */
const MIN_FLOAT_RUN = 2

/** A run buys its travel with its own length plus a separator's width. */
const GROUP_WIDTH = 2

const earnsTravel = (run: number, travel: number) => Math.abs(travel) <= run + GROUP_WIDTH

const NUMBER = /[-\u2212]?\d[\d,_' \u00A0\u202F]*(?:\.\d+)?/g

const read = (match: string) => {
  const n = parseFloat(match.replace(/[^\d.]/g, ''))
  if (!Number.isFinite(n)) return null
  return /^[-\u2212]/.test(match) ? -n : n
}

const numbersOf = (value: string) => {
  const out: number[] = []
  for (const match of value.match(NUMBER) ?? []) {
    const n = read(match)
    if (n !== null) out.push(n)
  }
  return out
}

/** The first number that differs decides; a changed count reads as a rise. */
export const trendOf = (prev: string, next: string) => {
  const before = numbersOf(prev)
  const after = numbersOf(next)
  if (!before.length || before.length !== after.length) return 1
  for (let i = 0; i < before.length; i++) {
    if (after[i] !== before[i]) return after[i] > before[i] ? 1 : -1
  }
  return 1
}

/**
 * Longest common prefix, then the longest run either value ends with, then one
 * flush with neither end. `anchor` is 0 start, 1 end, 0.5 middle.
 */
export const diff = (prev: HTMLElement[], newValue: string, anchor = 0) => {
  const labels = splitGraphemes(newValue)
  const lenOld = prev.length
  const lenNew = labels.length

  let start = 0
  while (start < lenOld && start < lenNew && prev[start].textContent === labels[start]) start++

  let best = 0
  const maxSuffix = Math.min(lenOld - start, lenNew - start)
  while (best < maxSuffix && prev[lenOld - 1 - best].textContent === labels[lenNew - 1 - best]) best++
  let oldSuffix = lenOld - best
  let midEnd = lenNew - best

  // `shift` aligns old index to new (new = old + shift), walking out from the
  // flush suffix, nearer side first, so ties travel least.
  const near = lenNew < lenOld ? 1 : -1
  for (let step = 0; step <= RUN_BAND * 2; step++) {
    const shift = lenNew - lenOld + ((step + 1) >> 1) * (step & 1 ? near : -near)
    const lo = shift < 0 ? start - shift : start // never reach back into the prefix
    let run = 0
    for (let i = Math.min(lenOld, lenNew - shift) - 1; i >= lo; i--) {
      if (prev[i].textContent === labels[i + shift]) {
        run++
        if (run > best && run >= MIN_FLOAT_RUN && earnsTravel(run, shift - anchor * (lenNew - lenOld))) {
          best = run
          oldSuffix = i
          midEnd = i + shift
        }
      } else run = 0
      if (run + i - lo <= best) break // cannot beat the run in hand
    }
  }

  return { prefixCount: start, suffixCount: best, oldSuffix, midEnd, labels }
}

/** y(x) for a CSS cubic-bezier, by Newton. */
export const cubicBezierEase = (x1: number, y1: number, x2: number, y2: number) => {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const xAt = (t: number) => ((ax * t + bx) * t + cx) * t
  const slopeAt = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  return (x: number) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 8; i++) {
      const off = xAt(t) - x
      if (Math.abs(off) < 1e-5) break
      const slope = slopeAt(t)
      if (Math.abs(slope) < 1e-6) break
      t -= off / slope
    }
    if (t < 0) t = 0
    else if (t > 1) t = 1
    return ((ay * t + by) * t + cy) * t
  }
}

/**
 * Where a `linear()` spring first reaches `target`, as a fraction of its run.
 * At 1 an exit's clamped opacity is 0, so its ink is gone. Anything unreadable
 * gets the conservative 1.
 */
export const crossingFraction = (easing: string, target: number) => {
  if (!easing.startsWith('linear(') || !easing.endsWith(')')) return 1
  const stops = easing.slice(7, -1).split(',').map(Number)
  if (stops.length < 2 || stops.some(Number.isNaN)) return 1
  for (let i = 1; i < stops.length; i++) {
    if (stops[i] >= target) {
      const lo = stops[i - 1]
      const within = lo >= target ? 0 : (target - lo) / (stops[i] - lo)
      return (i - 1 + within) / (stops.length - 1)
    }
  }
  return 1
}
