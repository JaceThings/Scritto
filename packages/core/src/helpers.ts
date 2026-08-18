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

export const isOnscreen = (el: HTMLElement) => {
  const clip = visibleClip(el)
  if (clip.bottom <= clip.top || clip.right <= clip.left) return false
  const rect = el.getBoundingClientRect()
  return rect.bottom > clip.top && rect.top < clip.bottom && rect.right > clip.left && rect.left < clip.right
}

/** A pooled glyph: `pooled` is the pool's claim, `exitTimer` a release still armed. */
export type Char = HTMLElement & {
  pooled?: boolean
  exitTimer?: ReturnType<typeof setTimeout>
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
  // Teardown and the char's own exit callback both hand it back, in either
  // order; a second hand-back would put it in the pool twice.
  if (el.pooled) return
  el.pooled = true
  clearTimeout(el.exitTimer)
  el.exitTimer = undefined
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

/**
 * A run flush with neither end was found by searching, and nothing forces it to
 * move, so it buys its travel with its length plus a group separator's width —
 * what '11' -> '1,001' needs. Otherwise a short common word flies the length of
 * the value while everything around it rolls. Runs at an end are exempt: layout
 * carries them, and SwiftUI slides a matched suffix any distance at all
 * (measured: 'supercalifragilisticlight' -> 'light', 337px).
 */
const GROUP_WIDTH = 2

const earnsTravel = (run: number, travel: number) => Math.abs(travel) <= run + GROUP_WIDTH

/** Sign, digits and one decimal point; `parseFloat` stops at the first group separator. */
export const numberOf = (value: string) => {
  const match = /[-\u2212]?\d[\d,_' \u00A0\u202F]*(?:\.\d+)?/.exec(value)
  if (!match) return null
  const n = parseFloat(match[0].replace(/[^\d.]/g, ''))
  if (!Number.isFinite(n)) return null
  return /^[-\u2212]/.test(match[0]) ? -n : n
}

/**
 * Longest common prefix, then the longest run either value ends with, then a
 * search for a run flush with neither end. `anchor` is where the box holds
 * still as it resizes (0 start, 1 end, 0.5 middle), which decides how far a
 * floating run would actually travel on screen.
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

  // '1 second' -> '2 seconds' changes at both ends, so its kept run is flush
  // with neither. `shift` aligns old index to new (new = old + shift), walking
  // outwards from the flush suffix, nearer side first, so ties travel least.
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
