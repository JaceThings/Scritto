import { BROWSER, ServerSafeHTMLElement, visibleClip } from './helpers'
import { SHRINK_EASING, WIDTH_ANIM } from './const'
import type { Transition } from './types'

export type ScrittoChangeDetail = { phase: 'before' | 'after'; animate: boolean }

type FlowHost = HTMLElement & {
  transition: Transition
  _exitTailMs?: () => number
  _exitEndPx?: () => number
}
type Box = { left: number; top: number; width: number; height: number }

const isFlowHost = (el: EventTarget | null): el is FlowHost => el instanceof HTMLElement && 'transition' in el
type Play = (el: HTMLElement, frames: Keyframe[], done?: () => void) => Animation

/** Roughly a word space: what a ghost clears so it isn't fading on top of its old neighbour. */
const GAP = 6

/** Slack on the teardown backstop, so it lands after the last frame rather than on it. */
const SETTLE_SLACK = 50

// Fades in the gutters past the text, not on the content box: 1rem occupies a
// 16px stage padding exactly, where more would be clipped by the card.
const GUTTER = '1rem'
const CLIP_STYLE = `position:absolute;top:0;bottom:0;left:-${GUTTER};right:-${GUTTER};overflow:hidden;pointer-events:none;mask-image:linear-gradient(90deg,transparent,#000 ${GUTTER},#000 calc(100% - ${GUTTER}),transparent)`

/** Flow-relative, since ghosts are positioned inside the clip. */
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

// Every flow reads before any writes, so an interrupted roll picks up where it
// stands rather than where the last one began.
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
    // Ghosts are placed against this box, and an inline box has no single one
    // across lines — left inline, every word measured negative.
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
    if (!(event instanceof CustomEvent) || !isFlowHost(event.target)) return
    if (event.target.closest('scritto-flow') !== this) return
    const { phase, animate } = event.detail
    if (phase === 'before') {
      this._pending.add(event.target)
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
    // Flow-relative, not viewport: the two measurements straddle a layout
    // change, and a scroll in between would read as every word changing line.
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

  // The words this generation touched, not the measured slice: the slice moves
  // with the scroll, so a word can fall outside it and stay hidden for good.
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

  // Each animation cleans its own node; a shared teardown would cancel every
  // in-flight ghost the moment the first one ended.
  private _run(anim: Animation, gen: number, done?: () => void) {
    this._anims.push(anim)
    anim.onfinish = () => {
      if (gen !== this._gen) return
      done?.()
    }
  }

  /** Backstop for ghosts whose own finish never fired. Never before `duration`. */
  private _settle = (gen: number) => {
    if (gen !== this._gen) return
    this._drop()
    this._resetWords()
  }

  _playMeasured() {
    const gen = this._gen
    const hosts = [...this._pending]
    this._pending.clear()
    // A roll keeps fading a staggered tail past its own duration, and anything
    // paced here has to outlast it or it lands on glyphs still on screen.
    let duration = 0
    for (const host of hosts) {
      duration = Math.max(duration, host.transition.duration + (host._exitTailMs?.() ?? 0))
    }
    const t0 = document.timeline.currentTime
    // Everything here is displaced by the host's edge, so it rides the edge's
    // own ease; on the roll's spring it would outrun the shrink and overshoot.
    const play: Play = (el, frames, done) => {
      const anim = el.animate(frames, { duration, easing: SHRINK_EASING, fill: 'forwards' })
      if (t0 !== null) anim.startTime = t0
      this._run(anim, gen, done)
      return anim
    }

    const clipped = this._playHosts(hosts, play)
    this._playWords(play)
    if (!this._anims.length && !clipped) return
    this._settleTimer = setTimeout(this._settle, duration + SETTLE_SLACK, gen)
  }

  /**
   * Resizes each host and decides whether its row is clipped. The clip earns
   * its keep when something can be drawn under the host's glyphs: any word
   * moving this time, or a word following it on its line with old glyphs
   * reaching past the box. A value that keeps its width has nothing past its
   * edge, so its glyphs dissolve in the clear instead of under the band.
   */
  private _playHosts(hosts: FlowHost[], play: Play) {
    const { _first: first, _last: last } = this
    const lineH = first[0]?.height || 1
    const disturbed =
      last.length > 0 &&
      first.some((a, i) => {
        const b = last[i]
        return !!b && (Math.abs(b.left - a.left) >= 0.5 || Math.abs(b.top - a.top) >= lineH * 0.5)
      })
    // Vertical overlap, not equal tops: a word box is the whole line box, an
    // inline host's box only its glyphs.
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
      const overhang = (host._exitEndPx?.() ?? 0) > Math.min(fromW, toW) + 0.5
      if (disturbed || (overhang && (followed(first, from) || followed(last, to)))) {
        host.setAttribute('data-shrink-clip', '')
        clipped = true
      }
      // The box already sits where it will end up, but its row was placed
      // relative to the row's start, so a line that re-centred slides the host
      // in from where it was. A host that changed line does not fly there.
      if (from && to && Math.abs(from.top - to.top) < Math.min(from.height, to.height) * 0.5) {
        const shift = this._rtl ? from.left + from.width - (to.left + to.width) : from.left - to.left
        if (Math.abs(shift) >= 0.5) {
          host.style.transform = `translateX(${shift}px)`
          this._touched.push(host)
          play(host, [{ transform: `translateX(${shift}px)` }, { transform: 'none' }], () => {
            host.style.transform = ''
          })
        }
      }
      if (Math.abs(toW - fromW) < 0.5) continue
      host.style.display = 'inline-block'
      host.style.width = `${fromW}px`
      host.style.marginRight = `${toW - fromW}px`
      // The glyphs were placed against the final layout, so the content has to
      // sit there from the first frame rather than re-centre in the old width.
      host.style.textAlign = 'start'
      const anim = play(
        host,
        [
          { width: `${fromW}px`, marginRight: `${toW - fromW}px` },
          { width: `${toW}px`, marginRight: '0px' },
        ],
        () => this._clearHost(host),
      )
      anim.id = WIDTH_ANIM
    }
    return clipped
  }

  /**
   * A word keeping its line slides along it. One changing line never travels
   * there — flying it diagonally drags the eye through unrelated text — but
   * hands off between two ghosts, one carrying on past the end of the line it
   * left and one arriving from before the start of the line it joined, both
   * dissolved by the clip's edge mask so it reads as going round the corner.
   */
  private _playWords(play: Play) {
    const { _first: first, _last: last, _wordEls: words, _lo: lo } = this
    const lineH = first[0]?.height || 1
    const wrapped = first.map((a, i) => !!last[i] && Math.abs(last[i].top - a.top) >= lineH * 0.5)

    // Words that wrap together travel as a group, sharing one shift per line:
    // the width of everything leaving or joining it. Sliding out by its own
    // width alone, a word would still be on the line when it faded.
    const enterShift = new Map<number, number>()
    const leaveShift = new Map<number, number>()
    for (let i = 0; i < first.length; i++) {
      if (!wrapped[i]) continue
      const a = first[i]
      const b = last[i]
      const down = b.top > a.top
      enterShift.set(Math.round(b.top), (enterShift.get(Math.round(b.top)) ?? 0) + (down ? -1 : 1) * (b.width + GAP))
      leaveShift.set(Math.round(a.top), (leaveShift.get(Math.round(a.top)) ?? 0) + (down ? 1 : -1) * (a.width + GAP))
    }

    const gutterPx = this.getBoundingClientRect().left - this._clip.getBoundingClientRect().left
    const pin = (word: HTMLElement, at: Box) => {
      // SAFETY: cloning an HTMLElement yields one; `cloneNode` is typed as Node.
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
