import { edgeSamples, linearOf, netPushes, type Glyph, type Push } from './edge'
import type { ScrittoOptions, Transition, Trend, Value } from './types'
import {
  ServerSafeHTMLElement,
  createEl,
  createChar,
  releaseChar,
  BROWSER,
  flip,
  isReducedMotion,
  isOnscreen,
  diff,
  reconcileChildren,
  clearAnimStyle,
  resetAnim,
  finishIdentityAnim,
  numberOf,
  type Char,
} from './helpers'
import {
  BOUNCE_TRANSITION,
  CONFIG,
  DEFAULT_TRANSITION,
  SHRINK_EASING,
  SPACE,
  STYLES,
  WIDTH_ANIM,
} from './const'
import { ScrittoFlow, playFlows, prepareFlows } from './flow'

let styleSheet: CSSStyleSheet
if (BROWSER) {
  styleSheet = new CSSStyleSheet()
  styleSheet.replaceSync(STYLES)
}

type Layout = {
  prefixCount: number
  suffixCount: number
  oldSuffix: number
  midEnd: number
  exitingTail: HTMLElement[]
  next: HTMLElement[]
}

type Plan = Layout & {
  /** Host width before the commit, for the standalone width transition. */
  fromW: number
  /** The row's start edge before the commit; everything old is placed relative to it. */
  fromEdge: number
  enters: HTMLElement[]
  trend: number
  oldPrefixX: number
  oldPrefixTop: number
  oldRunX: number
  oldRunTop: number
  exitingX: number
  tailX: number
  /** Each exiting glyph's distance along the row from the old start edge, and its width. */
  exitGlyphs: Glyph[]
  tailGlyphs: Glyph[]
}

type QueuedExit = { group: HTMLElement; nodes: HTMLElement[]; glyphs: Glyph[]; entry: [HTMLElement, number] }

const centerX = (rect: DOMRect) => (rect.left + rect.right) * 0.5
const startOf = (rect: DOMRect, rtl: boolean) => (rtl ? rect.right : rect.left)
const pending = new Set<Scritto>()
let flushScheduled = false
export const flushStats = { prepare: 0, commit: 0, finish: 0, hosts: 0 }

const enqueue = (el: Scritto) => {
  pending.add(el)
  if (flushScheduled) return
  flushScheduled = true
  queueMicrotask(flushAnimated)
}

const flushAnimated = () => {
  flushScheduled = false
  const list = [...pending]
  pending.clear()
  const each = (fn: (el: Scritto) => void) => {
    for (const el of list) if (el.isConnected) fn(el)
  }

  let t = performance.now()
  each((el) => el._emit('before', true))
  prepareFlows()
  each((el) => el._prepareAnimated())
  flushStats.prepare += performance.now() - t

  t = performance.now()
  each((el) => el._commitAnimated())
  flushStats.commit += performance.now() - t

  t = performance.now()
  each((el) => {
    el._finishAnimated()
    el._emit('after', true)
  })
  playFlows()
  flushStats.finish += performance.now() - t
  flushStats.hosts += list.length
}

class Scritto extends ServerSafeHTMLElement {
  private _prefix = createEl('span', 'section')
  private _middle = createEl('span', 'section')
  private _suffix = createEl('span', 'section')
  private _tail = createEl('span', 'section')
  private _exits = createEl('span', 'exits')
  private _chars: HTMLElement[] = []
  private _exitingChars: [el: HTMLElement, left: number][] = []
  private _exitQueue: QueuedExit[] = []
  private _pushes: Push[] = []
  private _exitEnd = 0
  // The last exiting char finishes at `duration + its delay`, not at
  // `duration` — a listener pacing itself off `transition.duration` alone
  // (the flow's same-line word slide, notably) finishes early and arrives
  // while the tail end of the roll is still fading. Reset per commit, grown
  // by `_startExits` to the longest delay actually queued this round.
  private _exitTail = 0
  private _blockified = false
  private _isRTL = false
  private _value = ''
  private _prevValue = ''
  private _plain = document.createTextNode('')
  private _readyPlan: Plan | null = null
  private _anims: Animation[] = []

  public transition: Transition = DEFAULT_TRANSITION
  public trend: Trend = 0
  public respectMotionPreference = true
  public bounce = false
  public wave = false

  constructor() {
    super()
    const shadow = this.attachShadow({ mode: 'open' })
    if (styleSheet) shadow.adoptedStyleSheets = [styleSheet]
    this._exits.toggleAttribute('inert', true)
    shadow.append(this._prefix, this._middle, this._suffix, this._tail, this._exits)
  }

  connectedCallback() {
    // A custom element constructor must not add children: doing so makes
    // document.createElement() fail and return an HTMLUnknownElement.
    if (this._plain.parentNode !== this) this.append(this._plain)
    this._isRTL = getComputedStyle(this).direction === 'rtl'
    this._render()
  }

  disconnectedCallback() {
    pending.delete(this)
    this._readyPlan = null
    this._reset()
  }

  get value() {
    return this._value
  }
  set value(v: Value) {
    this.update(v, false)
  }

  update(v: Value, withAnimation = true) {
    v = v + ''
    if (v === this._value) return
    this._prevValue = this._value
    this._value = v
    this._plain.nodeValue = v
    const animate =
      withAnimation && !(this.respectMotionPreference && isReducedMotion()) && isOnscreen(this)
    if (!animate) {
      pending.delete(this)
      this._readyPlan = null
      this._emit('before', false)
      this._render()
      this._emit('after', false)
      return
    }
    enqueue(this)
  }

  _emit(phase: 'before' | 'after', animate: boolean) {
    this.dispatchEvent(new CustomEvent('scrittochange', { bubbles: true, detail: { phase, animate } }))
  }

  setOptions({ bounce, transition, trend, respectMotionPreference, wave }: ScrittoOptions) {
    if (bounce === true || bounce === false) this.bounce = bounce
    if (wave === true || wave === false) this.wave = wave
    if (transition || bounce === true || bounce === false) {
      this.transition = { ...(this.bounce ? BOUNCE_TRANSITION : DEFAULT_TRANSITION), ...transition }
    }
    if (trend === -1 || trend === 0 || trend === 1) this.trend = trend
    if (respectMotionPreference === true || respectMotionPreference === false) {
      this.respectMotionPreference = respectMotionPreference
    }
  }

  private _render() {
    const layout = this._buildLayout()
    this._reset()
    if (!layout) return
    for (let i = layout.prefixCount; i < layout.oldSuffix; i++) releaseChar(this._chars[i])
    for (let i = 0; i < layout.exitingTail.length; i++) releaseChar(layout.exitingTail[i])
    this._commit(layout.next, layout.prefixCount, layout.midEnd, layout.suffixCount)
  }

  _prepareAnimated() {
    this._readyPlan = this._buildPlan()
  }

  _commitAnimated() {
    const plan = this._readyPlan
    if (!plan) {
      this._reset()
      return
    }
    this._cancelTracked()
    this._exitTail = 0
    this._queueExit(this._chars.slice(plan.prefixCount, plan.oldSuffix), plan.exitingX, plan.exitGlyphs)
    this._queueExit(plan.exitingTail, plan.tailX, plan.tailGlyphs)
    this._commit(plan.next, plan.prefixCount, plan.midEnd, plan.suffixCount)
    for (let i = 0; i < plan.enters.length; i++) if (plan.enters[i].textContent !== SPACE) plan.enters[i].style.opacity = '0'
    clearAnimStyle(this._prefix)
    clearAnimStyle(this._suffix)
  }

  _finishAnimated() {
    const plan = this._readyPlan
    this._readyPlan = null
    if (!plan) return
    const newPrefix = this._prefix.getBoundingClientRect()
    const newSuffix = this._suffix.getBoundingClientRect()
    const prefixAnchor = plan.prefixCount ? this._chars[0].getBoundingClientRect() : null
    const suffixAnchor = plan.suffixCount ? this._chars[plan.midEnd].getBoundingClientRect() : null
    const edge = this._isRTL ? newPrefix.right : newPrefix.left
    const toW = this.getBoundingClientRect().width
    // The roll sweeps the row start to end over a fixed share of the duration,
    // and a glyph joins it by where it stands, not by its index in its own
    // string — so an old glyph and the new one under it fade together, rather
    // than a long tail of the old value still standing over the new one.
    const span = Math.max(plan.fromW, toW) || 1
    const sweep = this.transition.duration * CONFIG.stagger
    const delayAt = (offset: number) => (sweep * Math.min(offset, span)) / span
    const enterGlyphs: Glyph[] = plan.enters.map((el) => {
      const rect = el.getBoundingClientRect()
      return { offset: Math.abs(startOf(rect, this._isRTL) - edge), width: rect.width }
    })
    const enterDelays = enterGlyphs.map((g) => delayAt(g.offset))
    this._startExits(plan.trend, delayAt)
    // Everything after a change is carried by the change's own glyphs; the
    // suffix by the middle, the host's end (and so whatever follows it) by all.
    this._exitEnd = 0
    for (const g of plan.exitGlyphs.concat(plan.tailGlyphs)) this._exitEnd = Math.max(this._exitEnd, g.offset + g.width)
    const midEnters = plan.midEnd - plan.prefixCount
    const midPushes = netPushes(enterGlyphs.slice(0, midEnters), plan.exitGlyphs, delayAt)
    this._pushes = netPushes(enterGlyphs, plan.exitGlyphs.concat(plan.tailGlyphs), delayAt)
    const total = this.transition.duration + this._exitTail
    const midSamples = this.wave ? edgeSamples(midPushes, this.transition, total) : null
    const suffixEasing = midSamples ? linearOf(midSamples) : SHRINK_EASING
    // Inside a flow the row's own start can move — its line re-centres — and
    // the flow carries the host across, so old glyphs and kept runs are placed
    // by where they stood along the row and a run's slide is only the change
    // in its distance from the start. On its own the box is already where it
    // will end up, so everything is placed on the page: old glyphs where they
    // were, kept runs sliding from there, and the change rolling in place.
    const inFlow = !!this.closest('scritto-flow')
    const carried = inFlow ? plan.fromEdge - edge : 0
    for (let i = 0; i < this._exitingChars.length; i++) {
      const [el, x] = this._exitingChars[i]
      el.style.transform = `translateX(${x - edge - carried}px)`
    }
    const line = newPrefix.height || 1
    const prefixDx =
      !prefixAnchor || Math.abs(newPrefix.top - plan.oldPrefixTop) >= line * 0.5
        ? 0
        : plan.oldPrefixX - centerX(prefixAnchor) - carried
    const suffixDx =
      !suffixAnchor || Math.abs(newSuffix.top - plan.oldRunTop) >= line * 0.5
        ? 0
        : plan.oldRunX - centerX(suffixAnchor) - carried
    const prefixFlip = flip(this._prefix, prefixDx, total, this._edgeEasing(total), true)
    const suffixFlip = flip(this._suffix, suffixDx, total, suffixEasing, true)
    if (prefixFlip) this._anims.push(prefixFlip)
    if (suffixFlip) this._anims.push(suffixFlip)
    this._armEnters(plan.enters, plan.trend, enterDelays)
    if (!inFlow) this._transitionWidth(plan.fromW, toW, edge)
  }

  /**
   * On its own the host lets its width settle over the transition instead of
   * snapping, so whatever follows it slides rather than jumps — and, on a
   * shrink, the old glyphs dissolve at the edge rather than over the neighbour.
   * Width needs a box, so an inline host is made inline-block for the
   * duration; its vertical padding and border are cancelled out with margins
   * so the line it sits on does not change height while it is one. Inside a
   * <scritto-flow> the flow drives this itself, since it also has to carry
   * words round line ends, which layout alone cannot.
   *
   * The row itself stays where it will end up, turning in place, whichever
   * way the box is anchored: layout puts the box where its anchoring says —
   * a centred one grows both ways, an end-aligned one toward its start — and
   * the content is indented back by however far the start edge is from where
   * it will land, easing to nothing with the width, with the old glyphs
   * carried the same way. Whichever edges move are the ones that clip.
   */
  private _transitionWidth(fromW: number, toW: number, edge: number) {
    if (Math.abs(toW - fromW) < 0.5) return
    const box = this.getBoundingClientRect()
    const css = getComputedStyle(this)
    if (css.display === 'inline') {
      const top = (parseFloat(css.paddingTop) || 0) + (parseFloat(css.borderTopWidth) || 0)
      const bottom = (parseFloat(css.paddingBottom) || 0) + (parseFloat(css.borderBottomWidth) || 0)
      this.style.display = 'inline-block'
      if (top) this.style.marginTop = `${-top}px`
      if (bottom) this.style.marginBottom = `${-bottom}px`
      this._blockified = true
    }
    this.style.textAlign = 'start'
    const total = this.transition.duration + this._exitTail
    const timing = { duration: total, easing: this._edgeEasing(total), fill: 'forwards' as const }
    const anim = this.animate({ width: [`${fromW}px`, `${toW}px`] }, timing)
    anim.id = WIDTH_ANIM
    const start = this.getBoundingClientRect()
    const rtl = this._isRTL
    const startShift = (rtl ? box.right - start.right : start.left - box.left) || 0
    const endShift = (rtl ? box.left - start.left : start.right - box.right) || 0
    const startMoves = Math.abs(startShift) >= 0.5
    const endMoves = Math.abs(endShift) >= 0.5
    this.setAttribute('data-shrink-clip', startMoves && endMoves ? 'both' : startMoves ? 'start' : 'end')
    const anims = [anim]
    if (startMoves) {
      anims.push(this.animate({ textIndent: [`${-startShift}px`, '0px'] }, timing))
      const dx = rtl ? startShift : -startShift
      for (const [group, x] of this._exitingChars) {
        anims.push(
          group.animate({ transform: [`translateX(${x - edge + dx}px)`, `translateX(${x - edge}px)`] }, timing),
        )
      }
    }
    anim.onfinish = () => {
      for (const a of anims) a.cancel()
      this._clearWidth()
    }
    this._anims.push(...anims)
  }

  private _clearWidth() {
    if (this._blockified) {
      this.style.display = ''
      this.style.marginTop = ''
      this.style.marginBottom = ''
      this._blockified = false
    }
    this.style.textAlign = ''
    this.removeAttribute('data-shrink-clip')
  }

  private _buildLayout(): Layout | null {
    const found = diff(this._chars, this._value)
    const { prefixCount, suffixCount, labels } = found
    if (prefixCount === this._chars.length && prefixCount === labels.length) return null

    // Where the kept run starts on each side. Everything between the prefix and
    // it is replaced; everything past it is fresh on the new side and dropped on
    // the old one.
    let oldSuffix = found.oldSuffix
    let midEnd = found.midEnd
    // A run of commas at the front of the change is a group arriving or leaving,
    // so it is peeled off to roll on its own while the digits behind it are kept
    // and shifted. That only lines up while nothing is kept from the end of the
    // value: kept chars are placed straight after the peeled run, which is where
    // they belong only when they are the whole rest of the row.
    if (!suffixCount) {
      let peel = prefixCount
      while (peel < midEnd && labels[peel] === ',') peel++
      if (peel > prefixCount && peel < midEnd) midEnd = peel
      let oldLead = prefixCount
      while (oldLead < oldSuffix && this._chars[oldLead].textContent === ',') oldLead++
      if (oldLead > prefixCount && oldLead < oldSuffix) oldSuffix = oldLead
    }
    return {
      prefixCount,
      suffixCount,
      oldSuffix,
      midEnd,
      exitingTail: this._chars.slice(oldSuffix + suffixCount),
      next: this._nextChars(prefixCount, midEnd, suffixCount, oldSuffix, labels),
    }
  }

  private _buildPlan(): Plan | null {
    const layout = this._buildLayout()
    if (!layout) return null

    let trend = this.trend
    if (!trend) {
      const cur = numberOf(this._value)
      const prev = numberOf(this._prevValue)
      trend = cur !== null && prev !== null ? (cur > prev ? 1 : -1) : 1
    }

    const oldPrefix = this._prefix.getBoundingClientRect()
    const oldSuffixRect = this._suffix.getBoundingClientRect()
    const midRect = this._middle.getBoundingClientRect()
    const oldTail = this._tail.getBoundingClientRect()
    const sectionRect = (el: HTMLElement) =>
      el === this._prefix ? oldPrefix : el === this._suffix ? oldSuffixRect : el === this._tail ? oldTail : midRect

    const exitX = (anchor: HTMLElement) => {
      const parent = anchor.parentElement
      const rect = parent ? sectionRect(parent) : midRect
      const left = rect.left + anchor.offsetLeft
      return this._isRTL ? left + anchor.offsetWidth : left
    }

    const { prefixCount, suffixCount, oldSuffix, midEnd, exitingTail, next } = layout
    // The same kept glyph is the only exact reference on both sides of the
    // commit. offsetLeft/offsetWidth round its old edge to whole CSS pixels;
    // comparing that reconstructed edge with a fractional section rect invents
    // a sub-pixel FLIP even when layout did not move.
    const prefixAnchor = prefixCount ? this._chars[0] : null
    const runAnchor = suffixCount ? this._chars[oldSuffix] : null
    // Section boxes above retain an interrupted FLIP's current position. A
    // glyph's own roll carries no horizontal layout information and can skew
    // its visual centre, so cancel it now; the commit cancels it later in this
    // same microtask either way.
    for (let i = 0; i < this._anims.length; i++) {
      const effect = this._anims[i].effect
      const target = effect instanceof KeyframeEffect ? effect.target : null
      if (target && (target === prefixAnchor || target === runAnchor)) this._anims[i].cancel()
    }
    const prefixAnchorRect = prefixAnchor?.getBoundingClientRect()
    const runAnchorRect = runAnchor?.getBoundingClientRect()
    const fromEdge = startOf(oldPrefix, this._isRTL)
    const glyphsOf = (nodes: HTMLElement[]): Glyph[] =>
      nodes.map((el) => {
        const rect = el.getBoundingClientRect()
        return { offset: Math.abs(startOf(rect, this._isRTL) - fromEdge), width: rect.width }
      })
    return {
      ...layout,
      fromW: this.getBoundingClientRect().width,
      fromEdge,
      enters: next.slice(prefixCount, midEnd).concat(next.slice(midEnd + suffixCount)),
      trend,
      oldPrefixX: prefixAnchorRect ? centerX(prefixAnchorRect) : 0,
      oldPrefixTop: prefixAnchor ? sectionRect(prefixAnchor.parentElement!).top : oldPrefix.top,
      oldRunX: runAnchorRect ? centerX(runAnchorRect) : 0,
      oldRunTop: runAnchor ? sectionRect(runAnchor.parentElement!).top : oldSuffixRect.top,
      exitingX: prefixCount < oldSuffix ? exitX(this._chars[prefixCount]) : 0,
      tailX: exitingTail.length ? exitX(exitingTail[0]) : 0,
      exitGlyphs: glyphsOf(this._chars.slice(prefixCount, oldSuffix)),
      tailGlyphs: glyphsOf(exitingTail),
    }
  }

  private _nextChars(
    prefixCount: number,
    midEnd: number,
    suffixCount: number,
    oldSuffix: number,
    labels: string[],
  ) {
    const next = new Array<HTMLElement>(labels.length)
    for (let i = 0; i < prefixCount; i++) next[i] = this._chars[i]
    for (let i = prefixCount; i < midEnd; i++) next[i] = createChar(labels[i])
    for (let i = 0; i < suffixCount; i++) next[midEnd + i] = this._chars[oldSuffix + i]
    for (let i = midEnd + suffixCount; i < labels.length; i++) next[i] = createChar(labels[i])
    return next
  }

  private _commit(chars: HTMLElement[], prefixCount: number, midEnd: number, suffixCount: number) {
    reconcileChildren(this._prefix, chars, 0, prefixCount)
    reconcileChildren(this._middle, chars, prefixCount, midEnd)
    reconcileChildren(this._suffix, chars, midEnd, midEnd + suffixCount)
    reconcileChildren(this._tail, chars, midEnd + suffixCount, chars.length)
    for (let i = 0; i < chars.length; i++) resetAnim(chars[i])
    this._chars = chars
  }

  /** How much longer this update's exiting glyphs run past `transition.duration`. */
  _exitTailMs() {
    return this._exitTail
  }

  /** How far along the row, from its start, this update's exiting glyphs reach. */
  _exitEndPx() {
    return this._exitEnd
  }

  /** The curve everything displaced by this update's change follows over `total` ms, sampled. */
  _edgeSamples(total: number) {
    return this.wave ? edgeSamples(this._pushes, this.transition, total) : null
  }

  _edgeEasing(total: number) {
    const samples = this._edgeSamples(total)
    return samples ? linearOf(samples) : SHRINK_EASING
  }

  private _queueExit(nodes: HTMLElement[], x: number, glyphs: Glyph[]) {
    if (!nodes.length) return
    const group = createEl('span')
    group.toggleAttribute('inert', true)
    for (let i = 0; i < nodes.length; i++) {
      clearAnimStyle(nodes[i])
      group.appendChild(nodes[i])
    }
    const entry: [HTMLElement, number] = [group, x]
    this._exitingChars.push(entry)
    this._exits.appendChild(group)
    this._exitQueue.push({ group, nodes, glyphs, entry })
  }

  private _startExits(trend: number, delayAt: (offset: number) => number) {
    const queue = this._exitQueue
    this._exitQueue = []
    for (const { group, nodes, glyphs, entry } of queue) {
      let left = nodes.length
      for (let i = 0; i < nodes.length; i++) {
        const delay = delayAt(glyphs[i].offset)
        this._exitTail = Math.max(this._exitTail, delay)
        this._animateChar(nodes[i], true, trend, delay, () => {
          // The group owns these chars until they are released, and releasing one
          // detaches it. A char that has left the group was torn down early and is
          // already back in the pool, or already standing in another value, where
          // releasing it a second time would take a glyph off the screen.
          if (nodes[i].parentNode !== group) return
          releaseChar(nodes[i])
          if (--left === 0) {
            group.remove()
            const idx = this._exitingChars.indexOf(entry)
            if (idx !== -1) this._exitingChars.splice(idx, 1)
          }
        })
      }
    }
  }

  private _armEnters(enters: HTMLElement[], trend: number, delays: number[]) {
    for (let i = 0; i < enters.length; i++) {
      if (enters[i].textContent === SPACE) continue
      enters[i].style.opacity = ''
      this._animateChar(enters[i], false, trend, delays[i])
    }
  }

  private _cancelTracked() {
    for (let i = 0; i < this._anims.length; i++) this._anims[i].cancel()
    this._anims.length = 0
    this._clearWidth()
  }

  private _reset() {
    this._cancelTracked()
    clearAnimStyle(this._prefix)
    clearAnimStyle(this._middle)
    clearAnimStyle(this._suffix)
    clearAnimStyle(this._tail)
    for (let i = 0; i < this._chars.length; i++) resetAnim(this._chars[i])

    this._exitQueue = []
    const exiting = this._exitingChars
    this._exitingChars = []
    for (let i = 0; i < exiting.length; i++) {
      const group = exiting[i][0]
      const nodes = group.querySelectorAll<HTMLElement>('.char')
      for (let j = 0; j < nodes.length; j++) releaseChar(nodes[j])
      group.remove()
    }
  }

  private _animateChar(el: Char, isOut: boolean, trend: number, delay: number, onFinish?: () => void) {
    if (el.textContent === SPACE) {
      // A space has nothing to animate, so its release rides a bare timer. The
      // char keeps the handle because releasing the char has to disarm it: by
      // the time it would fire, the char can already be standing in another
      // value, and its release there would collapse the gap it was holding.
      if (isOut && onFinish) el.exitTimer = setTimeout(onFinish, this.transition.duration + delay)
      return
    }

    const dir = isOut ? -1 : 1
    const transform = `translateY(${dir * trend * CONFIG.y}em) scale(${CONFIG.scale}) rotateZ(${CONFIG.rotate}deg)`
    const filter = `blur(${CONFIG.blur}em)`
    const anim = el.animate(
      {
        opacity: isOut ? 0 : [0, 1],
        transform: isOut ? transform : [transform, ''],
        filter: isOut ? filter : [filter, ''],
      },
      { ...this.transition, fill: 'both', delay },
    )
    // Tracked animations are section FLIPs only. Glyph rolls keep playing
    // so a rapid update can stack outgoing digits instead of popping them.

    if (!onFinish) {
      anim.onfinish = finishIdentityAnim
      return
    }
    let done = false
    const finish = () => {
      if (done) return
      done = true
      onFinish()
    }
    anim.onfinish = finish
    anim.oncancel = finish
  }
}

if (BROWSER && !customElements.get('scritto-text')) {
  customElements.define('scritto-text', Scritto)
}

declare global {
  interface HTMLElementTagNameMap {
    'scritto-text': Scritto
  }
}

export type * from './types'
export type { ScrittoChangeDetail } from './flow'
export { Scritto, ScrittoFlow, BROWSER }
