import { BROWSER, ServerSafeHTMLElement, visibleClip } from './helpers'
import { CONFIG, SHRINK_EASING, WIDTH_ANIM } from './const'
import { laggedSamples, landedAt, linearOf } from './edge'
import type { Transition } from './types'

export type ScrittoChangeDetail = { phase: 'before' | 'after'; animate: boolean }

type FlowHost = HTMLElement & {
  transition: Transition
  _exitTailMs?: () => number
  _edgeSamples?: (total: number) => number[] | null
}
type Box = { left: number; top: number; width: number; height: number }

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

// Reads first, across every flow, then writes: the reads capture the paragraph
// as it stands, mid-transition included, so an interrupted roll picks up from
// where it is instead of jumping back to where the last one began.
export const prepareFlows = () => {
  for (const flow of pendingFlows) flow._prepareReads()
  for (const flow of pendingFlows) flow._prepareWrites()
}

export const playFlows = () => {
  const list = [...pendingFlows]
  pendingFlows.clear()
  const measured = list.map((flow) => flow._measureLast())
  for (let i = 0; i < list.length; i++) {
    if (measured[i]) list[i]._playMeasured()
  }
}

class ScrittoFlow extends ServerSafeHTMLElement {
  private _clip = document.createElement('span')
  private _gen = 0
  private _anims: Animation[] = []
  private _first: Box[] = []
  private _fromBox = new Map<FlowHost, Box>()
  private _hosts = new Set<FlowHost>()
  private _wordEls: HTMLElement[] = []
  private _insetX = 0
  private _insetY = 0
  private _rtl = false
  private _pending = new Set<FlowHost>()
  private _last: Box[] = []
  private _toBox = new Map<FlowHost, Box>()
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
    // A flow is a paragraph: its ghosts are placed against its box, and an
    // inline box has no single one across lines. Left inline (the custom
    // element default) the words measured negative and nothing ever slid.
    if (css.display === 'inline') this.style.display = 'block'
    if (css.position === 'static') this.style.position = 'relative'
    this._rtl = css.direction === 'rtl'
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
      this._pending.add(event.target as FlowHost)
      pendingFlows.add(this)
      if (!animate) {
        this._prepareReads()
        this._prepareWrites()
        pendingFlows.delete(this)
        this._pending.clear()
      }
      return
    }
    if (!animate) pendingFlows.delete(this)
  }

  _prepareWrites() {
    if (!this._pending.size) return
    this._gen += 1
    this._drop()
    for (const prev of this._hosts) if (!this._pending.has(prev)) this._clearHost(prev)
    this._hosts = new Set(this._pending)
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
    if (!this._pending.size) return
    const [lo, hi] = this._visibleRange()
    this._lo = lo
    this._hi = hi
    this._first = this._measureSlice(lo, hi)
    this._fromBox.clear()
    for (const host of this._pending) this._fromBox.set(host, this._boxOf(host))
  }

  _measureLast() {
    if (!this._pending.size) return false
    this._last = this._measureSlice(this._lo, this._hi)
    this._toBox.clear()
    for (const host of this._pending) this._toBox.set(host, this._boxOf(host))
    return true
  }

  private _boxOf(el: HTMLElement) {
    return boxOf(el, this.getBoundingClientRect(), this._insetX, this._insetY)
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
    host.style.textAlign = ''
    host.removeAttribute('data-shrink-clip')
  }

  private _drop() {
    clearTimeout(this._settleTimer)
    this._settleTimer = undefined
    for (const anim of this._anims) anim.cancel()
    this._anims.length = 0
    this._clip.replaceChildren()
    for (const host of this._hosts) this._clearHost(host)
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

  _playMeasured() {
    const gen = this._gen
    const hosts = [...this._pending]
    this._pending.clear()
    // A host's roll can still be fading a staggered tail of characters after
    // its `duration` elapses (each exiting glyph starts `stagger` later than
    // the last). Everything this function paces — the width shrinks, a
    // same-line word's slide into the vacated space, a wrapped word's ghost
    // handoff — has to run at least as long as the longest of them, or it
    // arrives while old glyphs are still on screen and the two overlap.
    let duration = 0
    for (const host of hosts) {
      duration = Math.max(duration, host.transition.duration + (host._exitTailMs?.() ?? 0))
    }
    // Everything the flow moves is displaced by the host's edge, so it rides
    // the edge's own curve — the wave the host's glyphs carry — and lands as
    // the last of them does. On the roll's spring a neighbour would outrun the
    // shrink (and overshoot into it) and land on glyphs still dissolving. The
    // wave runs down the paragraph a line at a time: a line only reflows once
    // the line above has pushed a word onto it (or pulled one off), so each
    // line takes it up a little after the one before, as far as the time left
    // after the host's own line lands allows.
    const words = this._wordEls
    const last = this._last
    const first = this._first
    const lo = this._lo
    const t0 = document.timeline.currentTime
    const samples = hosts[0]?._edgeSamples?.(duration) ?? null
    const lineH = first[0]?.height || 1
    const linesAway = (box: Box, boxes: Map<FlowHost, Box>) => {
      let away = Infinity
      for (const host of hosts) {
        const b = boxes.get(host)
        if (b) away = Math.min(away, Math.round(Math.abs(box.top - b.top) / lineH))
      }
      return away === Infinity ? 0 : away
    }
    let farthest = 0
    for (let i = 0; i < first.length; i++) {
      if (!last[i]) continue
      farthest = Math.max(farthest, linesAway(first[i], this._fromBox), linesAway(last[i], this._toBox))
    }
    const hostD = hosts[0]?.transition.duration ?? duration
    const lag = samples ? Math.min((CONFIG.lineLag * hostD) / duration, (1 - landedAt(samples)) / (farthest || 1)) : 0
    const easings = new Map<number, string>()
    const easingFor = (away: number) => {
      if (!samples) return SHRINK_EASING
      let easing = easings.get(away)
      if (!easing) easings.set(away, (easing = linearOf(away ? laggedSamples(samples, away * lag) : samples)))
      return easing
    }
    const wave = easingFor(0)

    const play = (el: HTMLElement, frames: Keyframe[], easing: string, done?: () => void) => {
      const anim = el.animate(frames, { duration, easing, fill: 'forwards' })
      if (t0 !== null) anim.startTime = t0
      this._run(anim, gen, done)
    }

    // The clip only earns its keep when something can be drawn under the
    // host's glyphs: a word following it on its line, or any word moving
    // this time — a host that changes line leaves its old glyphs standing
    // where a ghost is now sliding out. Nothing following and nothing moving
    // means nothing to collide with, so the glyphs dissolve in the clear. It
    // is not tied to the direction of this change, nor to whether the edge
    // itself moves: an interrupted grow can leave glyphs standing well past
    // a host whose edge never got going, with the next word already beside it.
    const disturbed =
      last.length > 0 &&
      first.some((a, i) => {
        const b = last[i]
        return !!b && (Math.abs(b.left - a.left) >= 0.5 || Math.abs(b.top - a.top) >= lineH * 0.5)
      })
    // Same line means the boxes overlap vertically; a word box is the whole
    // line box, an inline host's only its glyphs, so tops alone do not match.
    const followed = (boxes: Box[], host: Box | undefined) =>
      !!host &&
      boxes.some(
        (b) =>
          Math.min(b.top + b.height, host.top + host.height) - Math.max(b.top, host.top) >
            Math.min(b.height, host.height) * 0.5 && b.left >= host.left + host.width - 0.5,
      )
    let clipped = false

    for (const host of hosts) {
      const from = this._fromBox.get(host)
      const to = this._toBox.get(host)
      const fromW = from?.width ?? 0
      const toW = to?.width ?? 0
      if (disturbed || followed(first, from) || followed(last, to)) {
        host.setAttribute('data-shrink-clip', '')
        clipped = true
      }
      // The host's box is already where it will end up; its row — old glyphs,
      // kept runs, the mask's edge — was placed relative to the row's start,
      // so when that start moved along the line (the line re-centred, say)
      // the host slides in from where it was, on the same curve as the words
      // beside it. A host that changed line does not fly there.
      if (from && to && Math.abs(from.top - to.top) < Math.min(from.height, to.height) * 0.5) {
        const shift = this._rtl ? from.left + from.width - (to.left + to.width) : from.left - to.left
        if (Math.abs(shift) >= 0.5) {
          host.style.transform = `translateX(${shift}px)`
          this._touched.push(host)
          play(host, [{ transform: `translateX(${shift}px)` }, { transform: 'none' }], wave, () => {
            host.style.transform = ''
          })
        }
      }
      if (Math.abs(toW - fromW) < 0.5) continue
      host.style.display = 'inline-block'
      host.style.width = `${fromW}px`
      host.style.marginRight = `${toW - fromW}px`
      // The glyph slides were measured against the final layout; content must
      // sit there from the first frame rather than re-centre in the old width.
      host.style.textAlign = 'start'
      const hostAnim = host.animate(
        { width: [`${fromW}px`, `${toW}px`], marginRight: [`${toW - fromW}px`, '0px'] },
        { duration, easing: wave, fill: 'forwards' },
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
        const easing = easingFor(linesAway(b, this._toBox))
        play(word, [{ transform: `translateX(${dx}px)` }, { transform: 'none' }], easing, () => {
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
        easingFor(linesAway(a, this._fromBox)),
        () => leaving.remove(),
      )
      const entering = pin(word, b)
      play(
        entering,
        [
          { opacity: 0, transform: `translateX(${enterX}px)` },
          { opacity: 1, transform: 'none' },
        ],
        easingFor(linesAway(b, this._toBox)),
        () => {
          entering.remove()
          word.style.visibility = ''
        },
      )
    }

    if (!this._anims.length && !clipped) return
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
