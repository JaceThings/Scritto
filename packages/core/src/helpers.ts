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

/**
 * Chars outlive the host that drew them: one pool feeds every host on the page,
 * so each char carries the two facts the pool needs. `pooled` is the pool's own
 * claim on it, and `exitTimer` is the deferred release still armed for the life
 * it is leaving.
 */
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
  // Teardown and a char's own exit callback can both hand it back, in either
  // order, so only the first hand-back counts: the pool must never hold the
  // same element twice, or a later value would be given a char that is already
  // standing in another one.
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

/**
 * How far from the end of a value the kept run may sit. A value that gains or
 * loses a char or two at the end — a plural 's', an ordinal suffix, a unit that
 * grew — moves the run it shares by that much, so the search covers the flush
 * alignment and a couple either side: 2 * RUN_BAND + 1 alignments, each walked
 * at most once, and pruned as soon as it cannot beat the run already found.
 */
const RUN_BAND = 2

/**
 * A run flush with neither end costs the row an extra torn-off tail, so it has
 * to earn that: one letter shared by two unrelated words ('seven' -> 'nine'
 * share an 'e') would fly across the value on its own while the rest rolled.
 */
const MIN_FLOAT_RUN = 2

/**
 * How far a run flush with neither end may travel to be kept rather than
 * rolled. A run at an end has no say in where it goes — the layout carries it,
 * and SwiftUI's own numeric text will slide a matched suffix any distance at
 * all (measured: 'supercalifragilisticlight' -> 'light' slides its five kept
 * letters 337px without blinking). A run in the middle is different: nothing
 * forces it to move, it was found by searching, and a short common word will
 * happily fly the length of the value on its own while everything around it
 * rolls — 'the light you seek is within you' -> 'you are the daylight' kept
 * 'you ' and flew it ten places left. So a floating run buys its travel with
 * its length, plus a group's width for the punctuation a number grows around
 * it: exactly what '11' -> '1,001' needs, one kept digit crossing a separator
 * and the two digits that came with it.
 *
 * Travel is what the run would move on screen, which depends on where the
 * box is anchored: measured from the start of a start-anchored box, from the
 * end of an end-anchored one — a right-aligned readout going 'Default – 0.20'
 * -> '0.21' keeps its '0.2' exactly where it stands — and from the middle of a
 * centred one.
 *
 * SwiftUI declines this trade entirely and matches only a common prefix and
 * suffix, so it never has to answer the question.
 */
const GROUP_WIDTH = 2

const earnsTravel = (run: number, travel: number) => Math.abs(travel) <= run + GROUP_WIDTH

/**
 * The number a value reads as, for working out which way it moved. Read the
 * way a person reads it: sign, digits, and one decimal point, with anything
 * else — currency, units, group separators, spaces — set aside. `parseFloat`
 * stopped at the first comma, so a grouped figure only ever compared its
 * leading group and '9,999' -> '10,000' read as falling.
 */
export const numberOf = (value: string) => {
  const match = /[-\u2212]?\d[\d,_' \u00A0\u202F]*(?:\.\d+)?/.exec(value)
  if (!match) return null
  const n = parseFloat(match[0].replace(/[^\d.]/g, ''))
  if (!Number.isFinite(n)) return null
  return /^[-\u2212]/.test(match[0]) ? -n : n
}

/** `anchor` is where the box holds still as it resizes: 0 at its start, 1 at its end, 0.5 in the middle. */
export const diff = (prev: HTMLElement[], newValue: string, anchor = 0) => {
  const labels = splitGraphemes(newValue)
  const lenOld = prev.length
  const lenNew = labels.length

  let start = 0
  while (start < lenOld && start < lenNew && prev[start].textContent === labels[start]) start++

  // The run both values end with, which is the whole answer whenever the value
  // only changed in front of it.
  let best = 0
  const maxSuffix = Math.min(lenOld - start, lenNew - start)
  while (best < maxSuffix && prev[lenOld - 1 - best].textContent === labels[lenNew - 1 - best]) best++
  let oldSuffix = lenOld - best
  let midEnd = lenNew - best

  // A value can change at both ends at once — '1 second' -> '2 seconds' differs
  // in its first char AND its last — and then the run it keeps is flush with
  // neither end. `shift` aligns an old index with a new one (new = old + shift):
  // the flush suffix sits at lenNew - lenOld, and the steps walk outwards from
  // there, the side nearer no movement first, so that an equally long run is the
  // one that travels least.
  const near = lenNew < lenOld ? 1 : -1
  for (let step = 0; step <= RUN_BAND * 2; step++) {
    const shift = lenNew - lenOld + ((step + 1) >> 1) * (step & 1 ? near : -near)
    // The run may not reach back into the prefix on either side.
    const lo = shift < 0 ? start - shift : start
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
      // What is left of this alignment can no longer beat the run in hand.
      if (run + i - lo <= best) break
    }
  }

  return { prefixCount: start, suffixCount: best, oldSuffix, midEnd, labels }
}
