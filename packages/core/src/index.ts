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
  edgeSlackPx,
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
  fromW: number
  fromEdge: number
  enters: HTMLElement[]
  trend: number
  oldPrefixX: number
  oldPrefixTop: number
  oldRunX: number
  oldRunTop: number
  exitingX: number
  tailX: number
  exitGlyphs: Glyph[]
  tailGlyphs: Glyph[]
}

/** Where a glyph sits along the row: `offset` from the row's start edge. */
type Glyph = { offset: number; width: number }
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
  private _crowded = false
  /**
   * How far along the row the old ink still on screen reaches. Held across
   * commits, since rapid updates leave earlier groups standing, and cleared
   * once the last of them has gone.
   */
  private _exitEnd = 0
  /** Where the box holds still as it resizes: 0 start, 1 end, 0.5 middle. */
  private _anchor: number | null = null
  /** The longest exit delay this commit, so anything paced off the roll outlasts it. */
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
  public hurry = false

  constructor() {
    super()
    const shadow = this.attachShadow({ mode: 'open' })
    if (styleSheet) shadow.adoptedStyleSheets = [styleSheet]
    this._exits.toggleAttribute('inert', true)
    shadow.append(this._prefix, this._middle, this._suffix, this._tail, this._exits)
  }

  connectedCallback() {
    // Not in the constructor: adding children there makes createElement() fail.
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

  setOptions({ bounce, transition, trend, respectMotionPreference, hurry }: ScrittoOptions) {
    if (bounce === true || bounce === false) this.bounce = bounce
    if (transition || bounce === true || bounce === false) {
      this.transition = { ...(this.bounce ? BOUNCE_TRANSITION : DEFAULT_TRANSITION), ...transition }
    }
    if (trend === -1 || trend === 0 || trend === 1) this.trend = trend
    if (respectMotionPreference === true || respectMotionPreference === false) {
      this.respectMotionPreference = respectMotionPreference
    }
    if (hurry === true || hurry === false) this.hurry = hurry
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
    // Ink from an earlier change is still on screen, so this one lands on a
    // crowded row: its own outgoing glyphs are hurried too, once they exist.
    this._crowded = this._exitingChars.length > 0
    this._hurryExits()
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
    const edge = startOf(newPrefix, this._isRTL)
    const toW = this.getBoundingClientRect().width
    const exits = plan.exitGlyphs.concat(plan.tailGlyphs)
    const enterGlyphs = this._glyphsOf(plan.enters, edge)
    const delayAt = this._sweep(enterGlyphs.concat(exits))
    const enterDelays = enterGlyphs.map((g) => delayAt(g.offset))
    this._startExits(plan.trend, delayAt)
    if (this._crowded) this._hurryExits()
    this._exitEnd = exits.reduce((end, g) => Math.max(end, g.offset + g.width), this._exitEnd)
    const total = this.transition.duration + this._exitTail
    // A flow moves the row's own start as its line re-flows, and carries the
    // host across, so everything old is placed relative to that start. On its
    // own the box already sits where it will land, so the page is the reference.
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
    // One ease for everything the change displaces, running as long as the roll
    // does: on the roll's own spring a kept run would outrun the shrink.
    for (const anim of [
      flip(this._prefix, prefixDx, total, SHRINK_EASING, true),
      flip(this._suffix, suffixDx, total, SHRINK_EASING, true),
    ]) {
      if (anim) this._anims.push(anim)
    }
    this._armEnters(plan.enters, plan.trend, enterDelays)
    if (!inFlow) this._transitionWidth(plan.fromW, toW, edge)
  }

  private _glyphsOf(nodes: HTMLElement[], from: number): Glyph[] {
    return nodes.map((el) => {
      const rect = el.getBoundingClientRect()
      return { offset: Math.abs(startOf(rect, this._isRTL) - from), width: rect.width }
    })
  }

  /**
   * A glyph joins the roll by where it stands rather than by its index in its
   * own string, so an old glyph and the new one under it fade together. The
   * sweep spans the changed stretch alone: normalised by the whole row, a small
   * change in a long value would start late and unroll in a sliver of it.
   */
  private _sweep(glyphs: Glyph[]) {
    let lo = Infinity
    let hi = -Infinity
    for (const g of glyphs) {
      lo = Math.min(lo, g.offset)
      hi = Math.max(hi, g.offset + g.width)
    }
    const span = hi > lo ? hi - lo : 1
    const sweep = this.transition.duration * CONFIG.stagger
    return (offset: number) => (sweep * Math.min(Math.max(offset - lo, 0), span)) / span
  }

  /**
   * Settles the host's width over the transition so what follows it slides
   * rather than jumps. Width needs a box, so an inline host turns inline-block
   * for the duration, its vertical padding and border cancelled with margins
   * so the line it sits on keeps its height.
   *
   * Whichever way the box is anchored, the row holds where it will land: the
   * content is indented back by however far the start edge has to travel,
   * easing to nothing with the width, and the old glyphs ride the same shift.
   * An edge is masked only when it moves, a neighbour is within reach of it,
   * and the old row reaches past where the box is heading — a shrink. A value
   * standing alone, or one growing into space it will fill, rolls in the clear.
   */
  private _transitionWidth(fromW: number, toW: number, edge: number) {
    if (Math.abs(toW - fromW) < 0.5) return
    const box = this.getBoundingClientRect()
    const beside = this._besideOnLine(box, Math.abs(toW - fromW) + 1)
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
    const timing = { duration: total, easing: SHRINK_EASING, fill: 'forwards' as const }
    // Width carries the mask's slack and the end margin takes it back, so what
    // follows the host is pushed by the content alone.
    const slack = edgeSlackPx(this)
    this.style.marginInlineEnd = `${-slack}px`
    const anim = this.animate({ width: [`${fromW + slack}px`, `${toW + slack}px`] }, timing)
    anim.id = WIDTH_ANIM
    const start = this.getBoundingClientRect()
    const rtl = this._isRTL
    // `start` is the border box, so the slack is on its end side; the shifts
    // below are the content's.
    const startEdge = rtl ? start.right : start.left
    const endEdge = rtl ? start.left + slack : start.right - slack
    const startShift = (rtl ? box.right - startEdge : startEdge - box.left) || 0
    const endShift = (rtl ? box.left - endEdge : endEdge - box.right) || 0
    const startMoves = Math.abs(startShift) >= 0.5
    const endMoves = Math.abs(endShift) >= 0.5
    this._anchor = Math.abs(startShift) / (Math.abs(startShift) + Math.abs(endShift) || 1)
    const overhang = this._exitEnd > toW + 0.5
    const clipStart = overhang && startMoves && beside.start
    const clipEnd = overhang && endMoves && beside.end
    if (clipStart || clipEnd) {
      this.setAttribute('data-shrink-clip', clipStart && clipEnd ? 'both' : clipStart ? 'start' : 'end')
    }
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

  /** Measured on the last resize; until then, read off the inherited alignment. */
  private _anchorHint() {
    if (this._anchor !== null) return this._anchor
    const align = getComputedStyle(this).textAlign
    if (align === 'center') return 0.5
    if (align === 'end') return 1
    if (align === 'right') return this._isRTL ? 0 : 1
    if (align === 'left') return this._isRTL ? 1 : 0
    return 0
  }

  /** Whether anything else on the host's line sits within `reach` of its start or end edge. */
  private _besideOnLine(box: DOMRect, reach: number) {
    // The nearest ancestor owning a whole line — past inline wrappers, and past
    // a table's cells, whose neighbours sit in the next cell rather than the row.
    let block: HTMLElement | null = this.parentElement
    while (block && /^(inline|table)/.test(getComputedStyle(block).display)) block = block.parentElement
    const beside = { start: false, end: false }
    if (!block) return beside
    const range = document.createRange()
    range.selectNodeContents(block)
    const rects = range.getClientRects()
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i]
      if (r.width === 0) continue
      const overlap = Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top)
      if (overlap <= Math.min(r.height, box.height) * 0.5) continue
      if (r.left >= box.left - 0.5 && r.right <= box.right + 0.5) continue
      const after = r.left >= box.right - 0.5 && r.left <= box.right + reach
      const before = r.right <= box.left + 0.5 && r.right >= box.left - reach
      if (after) beside[this._isRTL ? 'start' : 'end'] = true
      if (before) beside[this._isRTL ? 'end' : 'start'] = true
    }
    range.detach()
    return beside
  }

  private _clearWidth() {
    if (this._blockified) {
      this.style.display = ''
      this.style.marginTop = ''
      this.style.marginBottom = ''
      this._blockified = false
    }
    this.style.textAlign = ''
    this.style.marginInlineEnd = ''
    this.removeAttribute('data-shrink-clip')
  }

  private _buildLayout(): Layout | null {
    const found = diff(this._chars, this._value, this._anchorHint())
    const { prefixCount, suffixCount, labels } = found
    if (prefixCount === this._chars.length && prefixCount === labels.length) return null

    let oldSuffix = found.oldSuffix
    let midEnd = found.midEnd
    // Commas at the front of the change are a group arriving or leaving: peel
    // them off to roll alone while the digits behind them are kept and shifted.
    // Only sound with nothing kept from the end, since kept chars are placed
    // straight after the peeled run.
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
    // A kept glyph is the only exact reference across the commit: measuring the
    // section instead invents a sub-pixel FLIP, since offsetLeft rounds.
    const prefixAnchor = prefixCount ? this._chars[0] : null
    const runAnchor = suffixCount ? this._chars[oldSuffix] : null
    // Its own roll carries no layout information but skews its measured centre.
    for (const anim of this._anims) {
      const target = anim.effect instanceof KeyframeEffect ? anim.effect.target : null
      if (target === prefixAnchor || target === runAnchor) anim.cancel()
    }
    const prefixAnchorRect = prefixAnchor?.getBoundingClientRect()
    const runAnchorRect = runAnchor?.getBoundingClientRect()
    const fromEdge = startOf(oldPrefix, this._isRTL)
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
      exitGlyphs: this._glyphsOf(this._chars.slice(prefixCount, oldSuffix), fromEdge),
      tailGlyphs: this._glyphsOf(exitingTail, fromEdge),
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

  /** How far along the row this update's exiting glyphs reach. */
  _exitEndPx() {
    return this._exitEnd
  }

  /**
   * A roll is left running when the next update lands, so a rapid change
   * stacks its outgoing glyphs rather than popping them. Spammed, that stacks
   * whole values: each is legible, and they pile up over each other. With
   * `hurry`, every change speeds the ink already on its way out instead, so
   * what is leaving keeps rolling and clears the screen for what is arriving.
   * It is opt-in: on a readout a drag is retiring one digit at a time, and
   * hurrying that reads as the number popping rather than rolling.
   */
  private _hurryExits() {
    if (!this.hurry) return
    for (let i = 0; i < this._exitingChars.length; i++) {
      const chars = this._exitingChars[i][0].querySelectorAll<HTMLElement>('.char')
      for (let j = 0; j < chars.length; j++) {
        const anims = chars[j].getAnimations()
        for (let k = 0; k < anims.length; k++) {
          anims[k].playbackRate = Math.min(CONFIG.hurryMax, anims[k].playbackRate * CONFIG.hurry)
        }
      }
    }
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
          // Releasing detaches, so a char no longer in the group was already
          // released — possibly into another value, where a second release
          // would take a live glyph off the screen.
          if (nodes[i].parentNode !== group) return
          releaseChar(nodes[i])
          if (--left === 0) {
            group.remove()
            const idx = this._exitingChars.indexOf(entry)
            if (idx !== -1) this._exitingChars.splice(idx, 1)
            if (!this._exitingChars.length) this._exitEnd = 0
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
    this._exitEnd = 0
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
      // Nothing to animate, so the release rides a timer the char owns and
      // `releaseChar` disarms — by the time it fires the char may be standing
      // in another value, where releasing would collapse the gap it holds.
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
    // Deliberately untracked: a glyph roll keeps playing through the next
    // update, so rapid changes stack outgoing glyphs instead of popping them.
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
