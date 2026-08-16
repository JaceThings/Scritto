import { BROWSER, ServerSafeHTMLElement, visibleClip } from './helpers'
import { SHRINK_EASING } from './const'
import type { Transition } from './types'

export type ScrittoChangeDetail = { phase: 'before' | 'after'; animate: boolean }

type FlowHost = HTMLElement & { transition: Transition }
type Box = { left: number; top: number; width: number; height: number }

const WIDTH_ANIM = 'scritto-width'

/** Roughly a word space: what a ghost clears so it isn't fading on top of its old neighbour. */
const GAP = 6

/** Slack on the teardown backstop, so it lands after the last frame rather than on it. */
const SETTLE_SLACK = 50

// Fade lives in the gutters past the text, not on the content box. 1.1rem is
// 17.6px and would stick 1.6px past the 16px stage padding, where the figure
// clips the dissolve — 1rem occupies that padding exactly.
const GUTTER = '1rem'
const CLIP_STYLE = `position:absolute;top:0;bottom:0;left:-${GUTTER};right:-${GUTTER};overflow:hidden;pointer-events:none;mask-image:linear-gradient(90deg,transparent,#000 ${GUTTER},#000 calc(100% - ${GUTTER}),transparent)`

// Ghosts are positioned inside the clip. Measurements stay flow-relative.
const boxOf = (el: HTMLElement, origin: DOMRect, insetX: number, insetY: number): Box => {
  const rect = el.getBoundingClientRect()
  return {
    left: rect.left - origin.left - insetX,
    top: rect.top - origin.top - insetY,
    width: rect.width,
    height: rect.height,
  }
}

const lowerBound = (words: HTMLElement[], target: number) => {
  let lo = 0
  let hi = words.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (words[mid].offsetTop < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

const wordify = (root: HTMLElement) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) {
    if (walker.currentNode instanceof Text) nodes.push(walker.currentNode)
  }
  for (const node of nodes) {
    if (node.parentElement?.closest('scritto-text')) continue
    const parts = node.textContent?.split(/(\s+)/) ?? []
    if (parts.length < 2) continue
    const frag = document.createDocumentFragment()
    for (const part of parts) {
      if (!part) continue
      if (/^\s+$/.test(part)) {
        frag.append(part)
        continue
      }
      const span = document.createElement('span')
      span.dataset.word = ''
      span.style.display = 'inline-block'
      span.textContent = part
      frag.append(span)
    }
    node.replaceWith(frag)
  }
}

const pendingFlows = new Set<ScrittoFlow>()

export const prepareFlows = () => {
  for (const flow of pendingFlows) flow._prepareWrites()
  for (const flow of pendingFlows) flow._prepareReads()
}

export const playFlows = () => {
  const list = [...pendingFlows]
  pendingFlows.clear()
  const measured = list.map((flow) => flow._measureLast())
  for (let i = 0; i < list.length; i++) {
    const last = measured[i]
    if (last) list[i]._playMeasured(last)
  }
}

class ScrittoFlow extends ServerSafeHTMLElement {
  private _clip = document.createElement('span')
  private _gen = 0
  private _anims: Animation[] = []
  private _first: Box[] = []
  private _fromW = 0
  private _host: FlowHost | null = null
  private _wordEls: HTMLElement[] = []
  private _insetX = 0
  private _insetY = 0
  private _pendingHost: FlowHost | null = null
  private _last: Box[] = []
  private _toW = 0
  private _lo = 0
  private _hi = 0
  private _touched: HTMLElement[] = []
  private _settleTimer: ReturnType<typeof setTimeout> | undefined

  constructor() {
    super()
    this._clip.dataset.wrapClip = ''
    this._clip.setAttribute('aria-hidden', 'true')
    this._clip.style.cssText = CLIP_STYLE
  }

  connectedCallback() {
    const css = getComputedStyle(this)
    if (css.position === 'static') this.style.position = 'relative'
    this._insetX = parseFloat(css.borderLeftWidth) || 0
    this._insetY = parseFloat(css.borderTopWidth) || 0
    wordify(this)
    this._wordEls = [...this.querySelectorAll<HTMLElement>('[data-word]')]
    this.append(this._clip)
    this.addEventListener('scrittochange', this._onChange)
  }

  disconnectedCallback() {
    pendingFlows.delete(this)
    this.removeEventListener('scrittochange', this._onChange)
    this._drop()
    this._resetWords()
  }

  private _onChange = (event: Event) => {
    if (!(event instanceof CustomEvent) || !(event.target instanceof HTMLElement)) return
    if (event.target.closest('scritto-flow') !== this) return
    if (!('transition' in event.target)) return
    const { phase, animate } = event.detail
    if (phase === 'before') {
      this._pendingHost = event.target as FlowHost
      pendingFlows.add(this)
      if (!animate) {
        this._prepareWrites()
        this._prepareReads()
        pendingFlows.delete(this)
      }
      return
    }
    if (!animate) pendingFlows.delete(this)
  }

  _prepareWrites() {
    const host = this._pendingHost
    if (!host) return
    const prev = this._host
    this._host = host
    this._gen += 1
    this._drop()
    if (prev && prev !== host) this._clearHost(prev)
    this._resetWords()
  }

  private _visibleRange() {
    const words = this._wordEls
    if (!words.length) return [0, 0] as const
    const flow = this.getBoundingClientRect()
    const clip = visibleClip(this)
    const visibleTop = Math.max(flow.top, clip.top)
    const visibleBottom = Math.min(flow.bottom, clip.bottom)
    if (visibleBottom <= visibleTop) return [0, 0] as const
    const lo = lowerBound(words, visibleTop - flow.top)
    const hi = lowerBound(words, visibleBottom - flow.top)
    return [lo, Math.max(lo, hi)] as const
  }

  private _measureSlice(lo: number, hi: number) {
    const words = this._wordEls
    // Relative to the flow's own box, not the viewport: the two measurements
    // straddle a layout change, and if the document scrolls in between — losing a
    // line at the bottom of the page clamps scrollTop — viewport coordinates read
    // as every word having changed line, which turns the whole paragraph into
    // ghosts.
    const origin = this.getBoundingClientRect()
    const out = new Array<Box>(Math.max(0, hi - lo))
    for (let i = lo; i < hi; i++) out[i - lo] = boxOf(words[i], origin, this._insetX, this._insetY)
    return out
  }

  _prepareReads() {
    const host = this._pendingHost
    if (!host) return
    const [lo, hi] = this._visibleRange()
    this._lo = lo
    this._hi = hi
    this._first = this._measureSlice(lo, hi)
    this._fromW = host.getBoundingClientRect().width
  }

  _measureLast() {
    const host = this._pendingHost
    if (!host) return null
    this._last = this._measureSlice(this._lo, this._hi)
    this._toW = host.getBoundingClientRect().width
    return host
  }

  // Teardown walks the words this generation actually touched rather than the
  // measured slice: the slice is recomputed from the scroll position every
  // generation, so a word hidden under one slice can fall outside the next and
  // stay `visibility:hidden` with its ghost already dropped.
  private _resetWords() {
    for (const word of this._touched) {
      word.style.transform = ''
      word.style.visibility = ''
    }
    this._touched.length = 0
  }

  private _clearHost(host: FlowHost | null) {
    if (!host) return
    for (const anim of host.getAnimations()) if (anim.id === WIDTH_ANIM) anim.cancel()
    host.style.width = ''
    host.style.marginRight = ''
    host.style.display = ''
    host.removeAttribute('data-shrink-clip')
  }

  private _drop() {
    clearTimeout(this._settleTimer)
    this._settleTimer = undefined
    for (const anim of this._anims) anim.cancel()
    this._anims.length = 0
    this._clip.replaceChildren()
    this._clearHost(this._host)
  }

  // Each animation cleans its own node. A single tail-finish used to call
  // `_drop`, which cancelled every in-flight ghost the moment anything ended,
  // so the dissolve never read.
  private _run(anim: Animation, gen: number, done?: () => void) {
    this._anims.push(anim)
    anim.onfinish = () => {
      if (gen !== this._gen) return
      done?.()
    }
  }

  // Wall-clock only: leftover ghosts over hidden words are what left the edge
  // mask sitting on the real paragraph. Must not run until after `duration`.
  private _settle = (gen: number) => {
    if (gen !== this._gen) return
    this._drop()
    this._resetWords()
  }

  _playMeasured(host: FlowHost) {
    const gen = this._gen
    const { duration, easing } = host.transition
    const words = this._wordEls
    const last = this._last
    const toW = this._toW
    const first = this._first
    const fromW = this._fromW
    const lo = this._lo
    const t0 = document.timeline.currentTime

    if (Math.abs(toW - fromW) >= 0.5) {
      host.style.display = 'inline-block'
      host.style.width = `${fromW}px`
      host.style.marginRight = `${toW - fromW}px`
      if (toW < fromW) host.setAttribute('data-shrink-clip', '')
      const hostAnim = host.animate(
        { width: [`${fromW}px`, `${toW}px`], marginRight: [`${toW - fromW}px`, '0px'] },
        { duration, easing: SHRINK_EASING, fill: 'forwards' },
      )
      hostAnim.id = WIDTH_ANIM
      if (t0 !== null) hostAnim.startTime = t0
      this._run(hostAnim, gen, () => this._clearHost(host))
    }

    // A word that keeps its line just slides along it. One that changes line never
    // travels there: flying it diagonally across the paragraph draws the eye
    // through text it has nothing to do with. Instead it hands off between two
    // ghosts — one carrying on past the end of the line it left, one arriving from
    // before the start of the line it joined — and the clip's edge mask dissolves
    // both, so the word reads as having gone round the corner.
    const lineH = first[0]?.height || 1
    const wrapped = first.map((a, i) => !!last[i] && Math.abs(last[i].top - a.top) >= lineH * 0.5)

    // Words that wrap together travel as a group, so each line's ghosts share one
    // shift: the width of everything leaving or joining it. A word sliding out by
    // its own width alone would still be sitting on the line when it faded.
    const enterShift = new Map<number, number>()
    const leaveShift = new Map<number, number>()
    for (let i = 0; i < first.length; i++) {
      if (!wrapped[i]) continue
      const a = first[i]
      const b = last[i]
      const down = b.top > a.top
      const enterKey = Math.round(b.top)
      const leaveKey = Math.round(a.top)
      enterShift.set(enterKey, (enterShift.get(enterKey) ?? 0) + (down ? -1 : 1) * (b.width + GAP))
      leaveShift.set(leaveKey, (leaveShift.get(leaveKey) ?? 0) + (down ? 1 : -1) * (a.width + GAP))
    }

    const gutterPx = this.getBoundingClientRect().left - this._clip.getBoundingClientRect().left
    const pin = (word: HTMLElement, at: Box) => {
      const ghost = word.cloneNode(true) as HTMLElement
      ghost.dataset.wrapGhost = ''
      ghost.removeAttribute('data-word')
      ghost.setAttribute('aria-hidden', 'true')
      ghost.style.cssText = `position:absolute;left:${at.left + gutterPx}px;top:${at.top}px;margin:0`
      this._clip.append(ghost)
      return ghost
    }

    const play = (el: HTMLElement, frames: Keyframe[], done?: () => void) => {
      const anim = el.animate(frames, { duration, easing, fill: 'forwards' })
      if (t0 !== null) anim.startTime = t0
      this._run(anim, gen, done)
    }

    for (let i = 0; i < first.length; i++) {
      const word = words[lo + i]
      const a = first[i]
      const b = last[i]
      if (!word || !a || !b) continue

      if (!wrapped[i]) {
        const dx = a.left - b.left
        if (Math.abs(dx) < 0.5) continue
        word.style.transform = `translateX(${dx}px)`
        this._touched.push(word)
        play(word, [{ transform: `translateX(${dx}px)` }, { transform: 'none' }], () => {
          word.style.transform = ''
        })
        continue
      }

      const down = b.top > a.top
      const enterX = enterShift.get(Math.round(b.top)) ?? (down ? -b.width : b.width)
      const leaveX = leaveShift.get(Math.round(a.top)) ?? (down ? GAP * 4 : -GAP * 4)
      word.style.visibility = 'hidden'
      this._touched.push(word)

      const leaving = pin(word, a)
      play(
        leaving,
        [
          { opacity: 1, transform: 'none' },
          { opacity: 0, transform: `translateX(${leaveX}px)` },
        ],
        () => leaving.remove(),
      )
      const entering = pin(word, b)
      play(
        entering,
        [
          { opacity: 0, transform: `translateX(${enterX}px)` },
          { opacity: 1, transform: 'none' },
        ],
        () => {
          entering.remove()
          word.style.visibility = ''
        },
      )
    }

    if (!this._anims.length) return
    this._settleTimer = setTimeout(this._settle, duration + SETTLE_SLACK, gen)
  }
}

if (BROWSER && !customElements.get('scritto-flow')) {
  customElements.define('scritto-flow', ScrittoFlow)
}

declare global {
  interface HTMLElementTagNameMap {
    'scritto-flow': ScrittoFlow
  }
}

export { ScrittoFlow }
