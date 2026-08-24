import type { EdgeFade, ScrittoOptions, Transition, Trend, Value } from './types'
import {
  ServerSafeHTMLElement,
  createEl,
  createChar,
  releaseChar,
  BROWSER,
  flip,
  isReducedMotion,
  isOnscreen,
  boundsOf,
  diff,
  reconcileWords,
  clearAnimStyle,
  crossingFraction,
  cubicBezierEase,
  resetAnim,
  finishIdentityAnim,
  trendOf,
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
  blockSlackPx,
  edgeSlackPx,
} from './const'
import { ScrittoFlow, playFlows, prepareFlows } from './flow'

let styleSheet: CSSStyleSheet
if (BROWSER) {
  styleSheet = new CSSStyleSheet()
  styleSheet.replaceSync(STYLES)
}

/** SHRINK_EASING in JS. Keep the two in step. */
const shrinkEase = cubicBezierEase(0.22, 1, 0.36, 1)

const ENVELOPE_STEPS = 32

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

type Glyph = { offset: number; width: number }
type QueuedExit = { group: HTMLElement; nodes: HTMLElement[]; glyphs: Glyph[]; entry: [HTMLElement, number] }

const centerX = (rect: DOMRect) => (rect.left + rect.right) * 0.5

/** Words carry the run's travel, so they carry the styles it leaves behind. */
const clearRun = (section: HTMLElement) => {
  for (let i = 0; i < section.children.length; i++) clearAnimStyle(section.children[i] as HTMLElement)
}

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
  /** Held across commits: rapid updates leave earlier exit groups standing. */
  private _exitEnd = 0
  /** Where the box holds still as it resizes: 0 start, 1 end, 0.5 middle. */
  private _anchor: number | null = null
  private _room = { start: Infinity, end: Infinity }
  private _exitTail = 0
  /** Held apart from `_anims`, which every commit cancels. */
  private _widthAnims: Animation[] = []
  private _widthTo: number | null = null
  private _widthTiming: { duration: number; easing: string; fill: 'forwards' } | null = null
  private _widthDx = 0
  /** How far each glyph's ink reaches, and while when it needs the box to cover it. */
  private _inkSpans: { end: number; from: number; ramp: number; until: number }[] = []
  private _widthTravel: number[] | null = null
  /** When the last arriving glyph starts to read, which is the box's deadline. */
  private _widthLead = 0
  private _blockified = false
  /** Wrapping this value is on hold while the box is pinned mid-transition. */
  private _wrapHeld = false
  private _isRTL = false
  private _value = ''
  private _prevValue = ''
  private _plain = document.createTextNode('')
  private _readyPlan: Plan | null = null
  private _anims: Animation[] = []

  public transition: Transition = DEFAULT_TRANSITION
  public trend: Trend = 0
  public edgeFade: EdgeFade = 'auto'
  public respectMotionPreference = true
  public bounce = false

  constructor() {
    super()
    const shadow = this.attachShadow({ mode: 'open' })
    if (styleSheet) shadow.adoptedStyleSheets = [styleSheet]
    this._exits.toggleAttribute('inert', true)
    // Exits first: its static position is what puts ghosts on the value's line,
    // and last in the shadow that position falls to a second line whenever the
    // value wraps.
    shadow.append(this._exits, this._prefix, this._middle, this._suffix, this._tail)
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

  setOptions({ bounce, transition, trend, respectMotionPreference, edgeFade }: ScrittoOptions) {
    if (bounce === true || bounce === false) this.bounce = bounce
    if (transition || bounce === true || bounce === false) {
      this.transition = { ...(this.bounce ? BOUNCE_TRANSITION : DEFAULT_TRANSITION), ...transition }
    }
    if (trend === -1 || trend === 0 || trend === 1) this.trend = trend
    if (edgeFade === 'auto' || edgeFade === 'always' || edgeFade === 'never') this.edgeFade = edgeFade
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
    this._room = this._roomAtRest()
    this._readyPlan = this._buildPlan()
  }

  /**
   * Free space each side of the value inside the box a reader sees as holding
   * it, plus whether anything sits beside it on the line. Read while the layout
   * is still at rest: once the box starts moving, a container that hugs the
   * value is moving with it and nothing measured against it means anything.
   */
  private _roomAtRest() {
    const box = this.getBoundingClientRect()
    const bounds = boundsOf(this)
    const beside = this._besideOnLine(box, Math.max(box.width, bounds.width - box.width))
    const before = box.left - bounds.left
    const after = bounds.right - box.right
    const rtl = this._isRTL
    const room = {
      start: beside.start ? 0 : rtl ? after : before,
      end: beside.end ? 0 : rtl ? before : after,
    }
    return room
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
    clearRun(this._prefix)
    clearRun(this._suffix)
  }

  _finishAnimated() {
    const plan = this._readyPlan
    this._readyPlan = null
    if (!plan) return
    // A transition in flight pins the box, so the width below has to come from
    // the content instead. Re-aim by landing the box and starting from here.
    let reached: number | null = null
    if (this._widthAnims.length && this._widthTo !== null) {
      const natural = this._naturalWidth()
      if (Math.abs(natural - this._widthTo) >= 0.5) {
        reached = this.getBoundingClientRect().width - edgeSlackPx(this)
        for (let i = 0; i < this._widthAnims.length; i++) this._widthAnims[i].cancel()
        this._widthAnims.length = 0
        this._clearWidth()
      }
    }
    const newPrefix = this._prefix.getBoundingClientRect()
    const newSuffix = this._suffix.getBoundingClientRect()
    const prefixAnchor = plan.prefixCount ? this._chars[0].getBoundingClientRect() : null
    const suffixAnchor = plan.suffixCount ? this._chars[plan.midEnd].getBoundingClientRect() : null
    const edge = startOf(newPrefix, this._isRTL)
    const toW = this.getBoundingClientRect().width
    const exits = plan.exitGlyphs.concat(plan.tailGlyphs)
    const enterGlyphs = this._glyphsOf(plan.enters, edge)
    const exitDelayAt = this._sweep(exits)
    const enterDelayAt = this._sweep(enterGlyphs)
    const enterDelays = enterGlyphs.map((g) => enterDelayAt(g.offset))
    this._startExits(plan.trend, exitDelayAt)
    this._exitEnd = exits.reduce((end, g) => Math.max(end, g.offset + g.width), this._exitEnd)
    // Arriving ink is laid out at its final position while the box is still
    // widening, so the box tracks it as it fades in rather than letting it
    // stand outside. Ink leaving keeps the box it already has: the edge fade
    // covers its overhang, and holding the box out for it would stall the roll.
    const nowMs = performance.now()
    const duration = this.transition.duration
    const showsAt = crossingFraction(this.transition.easing, 0.15) * duration
    const solidAt = crossingFraction(this.transition.easing, 0.35) * duration
    const blurPad = (parseFloat(getComputedStyle(this).fontSize) || 16) * CONFIG.blur * 2
    for (let i = this._inkSpans.length - 1; i >= 0; i--) {
      if (this._inkSpans[i].until <= nowMs) this._inkSpans.splice(i, 1)
    }
    let lastShows = 0
    for (let i = 0; i < enterGlyphs.length; i++) {
      const g = enterGlyphs[i]
      this._inkSpans.push({
        end: Math.min(g.offset + g.width + blurPad, toW),
        from: nowMs + enterDelays[i] + showsAt,
        ramp: Math.max(solidAt - showsAt, 1),
        until: nowMs + enterDelays[i] + duration,
      })
      lastShows = Math.max(lastShows, enterDelays[i] + showsAt)
    }
    this._widthLead = lastShows
    const total = this.transition.duration + this._exitTail
    // A flow re-flows the row under the host, so old ink is placed against the
    // row's start rather than the page.
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
    // Not the roll's own spring: a kept run would outrun the shrink.
    this._flipRun(this._prefix, prefixDx, total)
    this._flipRun(this._suffix, suffixDx, total)
    this._armEnters(plan.enters, plan.trend, enterDelays)
    // A wrapped host has a box per line, so it has no single width to animate:
    // the lines it fills are the layout, and the roll rides them as they are.
    if (!inFlow && this.getClientRects().length < 2) this._transitionWidth(reached ?? plan.fromW, toW, edge)
  }

  /**
   * A kept run slides by its words, not by the section holding them: a section
   * is inline so the value can break across lines, and an inline box takes no
   * transform. Every word in the run travels the same distance either way.
   */
  private _flipRun(section: HTMLElement, dx: number, total: number) {
    for (let i = 0; i < section.children.length; i++) {
      const anim = flip(section.children[i] as HTMLElement, dx, total, SHRINK_EASING, true)
      if (anim) this._anims.push(anim)
    }
  }

  /**
   * A value with a space in it reads as text and wraps like text. One without
   * has nowhere to break anyway, and letting it try would break a number
   * between two of its own sections.
   */
  private _setWrap() {
    this.toggleAttribute('data-wrap', /\s/.test(this._value))
  }

  /**
   * Whoever pins this box narrower than its ink, here or in a flow, holds the
   * wrapping off for as long as the pin lasts: ink free to wrap would take a
   * second line inside the pin and grow the paragraph under it.
   */
  _holdWrap(held: boolean) {
    if (held) {
      this._wrapHeld = this.hasAttribute('data-wrap')
      this.removeAttribute('data-wrap')
      return
    }
    if (!this._wrapHeld) return
    this._wrapHeld = false
    this._setWrap()
  }

  private _glyphsOf(nodes: HTMLElement[], from: number): Glyph[] {
    return nodes.map((el) => {
      const rect = el.getBoundingClientRect()
      return { offset: Math.abs(startOf(rect, this._isRTL) - from), width: rect.width }
    })
  }

  /** Delay by position, so a glyph and the one replacing it move together. */
  private _sweep(glyphs: Glyph[]) {
    let lo = Infinity
    let last = -Infinity
    for (const g of glyphs) {
      lo = Math.min(lo, g.offset)
      last = Math.max(last, g.offset)
    }
    const reach = last > lo ? last - lo : 1
    // Spans starts, not reach, and stops one step short: an even row gets the
    // ladder counting it would, and a narrow last glyph no more than its share.
    const step = (this.transition.duration * CONFIG.stagger * Math.max(glyphs.length - 1, 0)) / (glyphs.length || 1)
    return (offset: number) => (step * Math.min(Math.max(offset - lo, 0), reach)) / reach
  }

  /**
   * An inline host turns inline-block for the duration, its vertical padding and
   * border cancelled by margins so the line's height holds, and its content
   * indented back by however far the start edge travels.
   */
  private _transitionWidth(fromW: number, toW: number, edge: number) {
    // Already on its way there. A ghost born now still joins the compensation,
    // at the phase the run has reached.
    if (this._widthAnims.length && this._widthTiming) {
      const elapsed = Number(this._widthAnims[0].currentTime ?? 0)
      for (const [group, x] of this._exitingChars) {
        if (group.getAnimations().length) continue
        this._widthAnims.push(
          group.animate(this._rideFrames(x - edge, this._widthDx), { ...this._widthTiming, delay: -elapsed }),
        )
      }
      return
    }
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
    this._holdWrap(true)
    const total = this.transition.duration + this._exitTail
    const envelope = this._inkEnvelope(fromW, toW, total)
    const timing = { duration: total, easing: envelope ? 'linear' : SHRINK_EASING, fill: 'forwards' as const }
    // The indent compensates for a box of exactly this width, so a flex parent
    // must not shrink it. The content overflowed at its natural width anyway.
    this.style.flexShrink = '0'
    // The end margin takes the mask's slack back out of the layout.
    const slack = edgeSlackPx(this)
    this.style.marginInlineEnd = `${-slack}px`
    // Pinned to fromW while the shifts below are measured: the envelope only
    // holds the box wider, and compensating for that would push content out of
    // it. Its samples go on once those are known.
    const anim = this.animate({ width: [`${fromW + slack}px`, `${toW + slack}px`] }, timing)
    anim.id = WIDTH_ANIM
    this._widthTo = toW
    this._widthTiming = timing
    this._widthTravel = envelope ? envelope.map((w) => (w - toW) / (fromW - toW)) : null
    const start = this.getBoundingClientRect()
    const rtl = this._isRTL
    // `start` is the border box: the slack sits on its end side.
    const startEdge = rtl ? start.right : start.left
    const endEdge = rtl ? start.left + slack : start.right - slack
    const startShift = (rtl ? box.right - startEdge : startEdge - box.left) || 0
    const endShift = (rtl ? box.left - endEdge : endEdge - box.right) || 0
    const startMoves = Math.abs(startShift) >= 0.5
    const endMoves = Math.abs(endShift) >= 0.5
    this._anchor = Math.abs(startShift) / (Math.abs(startShift) + Math.abs(endShift) || 1)
    // An edge earns its fade by travelling and by having something to protect.
    // Ghosts hold the old box's place, so they only need covering where that
    // reaches a neighbour on the line or the edge of whatever clips this
    // element. Text with room around it fades on its own opacity instead: a
    // band there would eat the ghosts for nothing.
    const reach = Math.max(Math.abs(startShift), Math.abs(endShift)) + blockSlackPx(this)
    const hemmed = (room: number) => this.edgeFade !== 'never' && (this.edgeFade === 'always' || reach > room)
    const clipStart = startMoves && hemmed(this._room.start)
    const clipEnd = endMoves && hemmed(this._room.end) && this._exitEnd > toW + 0.5
    if (clipStart || clipEnd) {
      this.setAttribute('data-shrink-clip', clipStart && clipEnd ? 'both' : clipStart ? 'start' : 'end')
      // A ghost holds its old place while the box leaves it behind, so it reaches
      // as far past an edge as that edge travels, plus its blur.
      const room = Math.max(Math.abs(startShift), Math.abs(endShift)) + blockSlackPx(this)
      this.style.setProperty('--scritto-exit-room', `${Math.ceil(room)}px`)
    }
    const anims = [anim]
    const dx = rtl ? startShift : -startShift
    this._widthDx = startMoves ? dx : 0
    if (startMoves) {
      anims.push(this.animate(this._indentFrames(startShift), timing))
      for (const [group, x] of this._exitingChars) {
        anims.push(group.animate(this._rideFrames(x - edge, dx), timing))
      }
    }
    const effect = anim.effect
    if (envelope && effect instanceof KeyframeEffect) {
      effect.setKeyframes(envelope.map((w, k) => ({ width: `${w + slack}px`, offset: k / ENVELOPE_STEPS })))
    }
    anim.onfinish = () => {
      for (const a of this._widthAnims) a.cancel()
      this._widthAnims.length = 0
      this._clearWidth()
    }
    this._widthAnims.push(...anims)
  }

  /**
   * The width track sampled: the eased base, never below the reach of ink that
   * is still visible. Null when the plain two-keyframe track already covers it.
   */
  private _inkEnvelope(fromW: number, toW: number, total: number): number[] | null {
    const spans = this._inkSpans
    if (!spans.length) return null
    const now = performance.now()
    // Widening, the box lands by the time its glyphs read, so none of them
    // stands outside it. Narrowing keeps the roll's own pace.
    const lead = toW > fromW ? Math.min(Math.max(this._widthLead / total, 0.4), 1) : 1
    let binds = lead < 1
    let peak = Math.max(fromW, toW)
    const widths = Array.from<number>({ length: ENVELOPE_STEPS + 1 })
    for (let k = 0; k <= ENVELOPE_STEPS; k++) {
      const at = k / ENVELOPE_STEPS
      const base = fromW + (toW - fromW) * shrinkEase(Math.min(at / lead, 1))
      let w = base
      const t = now + at * total
      for (const s of spans) {
        if (t < s.from || t >= s.until) continue
        const eased = s.ramp > 0 ? base + (s.end - base) * Math.min((t - s.from) / s.ramp, 1) : s.end
        if (eased > w) {
          w = eased
          binds = true
        }
      }
      widths[k] = w
      if (w > peak) peak = w
    }
    if (!binds) return null
    // A span expiring between samples would drop the box a glyph's width in one
    // step: cap the descent, then walk it back so the track still lands on toW.
    const drop = ((peak - Math.min(fromW, toW)) * total) / ENVELOPE_STEPS / 180
    for (let k = 1; k <= ENVELOPE_STEPS; k++) {
      if (widths[k] < widths[k - 1] - drop) widths[k] = widths[k - 1] - drop
    }
    widths[ENVELOPE_STEPS] = toW
    for (let k = ENVELOPE_STEPS - 1; k > 0; k--) {
      if (widths[k] > widths[k + 1] + drop) widths[k] = widths[k + 1] + drop
    }
    return widths
  }

  /** Cancels the start edge's travel, so it moves with the box, not against it. */
  private _indentFrames(startShift: number): Keyframe[] | PropertyIndexedKeyframes {
    const travel = this._widthTravel
    if (!travel) return { textIndent: [`${-startShift}px`, '0px'] }
    return travel.map((r, k) => ({ textIndent: `${-startShift * r}px`, offset: k / ENVELOPE_STEPS }))
  }

  /** A ghost rides the box's travel, so it holds still while the box moves. */
  private _rideFrames(base: number, dx: number): Keyframe[] | PropertyIndexedKeyframes {
    const travel = this._widthTravel
    if (!travel) return { transform: [`translateX(${base + dx}px)`, `translateX(${base}px)`] }
    return travel.map((r, k) => ({ transform: `translateX(${base + dx * r}px)`, offset: k / ENVELOPE_STEPS }))
  }

  /** What the box would measure if a transition were not pinning it. */
  private _naturalWidth() {
    const css = getComputedStyle(this)
    const sections = [this._prefix, this._middle, this._suffix, this._tail]
    let content = 0
    for (let i = 0; i < sections.length; i++) content += sections[i].getBoundingClientRect().width
    return (
      content +
      (parseFloat(css.paddingInlineStart) || 0) +
      (parseFloat(css.paddingInlineEnd) || 0) +
      (parseFloat(css.borderInlineStartWidth) || 0) +
      (parseFloat(css.borderInlineEndWidth) || 0)
    )
  }

  private _anchorHint() {
    if (this._anchor !== null) return this._anchor
    const align = getComputedStyle(this).textAlign
    if (align === 'center') return 0.5
    if (align === 'end') return 1
    if (align === 'right') return this._isRTL ? 0 : 1
    if (align === 'left') return this._isRTL ? 1 : 0
    return 0
  }

  /** Whether anything sits beside this on its own line, within `reach` px. */
  private _besideOnLine(box: DOMRect, reach: number) {
    // The nearest ancestor owning a whole line: past inline wrappers, and past
    // a cell, whose neighbours sit in the next cell rather than the row.
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
    this._widthTo = null
    this._widthTiming = null
    this._widthDx = 0
    this._widthTravel = null
    this.style.flexShrink = ''
    if (this._blockified) {
      this.style.display = ''
      this.style.paddingTop = ''
      this.style.paddingBottom = ''
      this.style.marginTop = ''
      this.style.marginBottom = ''
      this._blockified = false
    }
    this.style.textAlign = ''
    this._holdWrap(false)
    this.style.marginInlineEnd = ''
    this.style.removeProperty('--scritto-exit-room')
    this.removeAttribute('data-shrink-clip')
  }

  private _buildLayout(): Layout | null {
    const found = diff(this._chars, this._value, this._anchorHint())
    const { prefixCount, suffixCount, labels } = found
    if (prefixCount === this._chars.length && prefixCount === labels.length) return null

    let oldSuffix = found.oldSuffix
    let midEnd = found.midEnd
    // A leading comma is a group arriving or leaving: it rolls alone while the
    // digits behind it are kept. Only sound with nothing kept from the end.
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
    if (!trend) trend = trendOf(this._prevValue, this._value)

    const oldPrefix = this._prefix.getBoundingClientRect()
    const oldSuffixRect = this._suffix.getBoundingClientRect()
    const midRect = this._middle.getBoundingClientRect()
    const oldTail = this._tail.getBoundingClientRect()
    const sectionRect = (el: HTMLElement | null) =>
      el === this._prefix ? oldPrefix : el === this._suffix ? oldSuffixRect : el === this._tail ? oldTail : midRect
    const sectionOf = (char: HTMLElement) => char.closest<HTMLElement>('.section')

    const exitX = (anchor: HTMLElement) => {
      const rect = sectionRect(sectionOf(anchor))
      const left = rect.left + anchor.offsetLeft
      return this._isRTL ? left + anchor.offsetWidth : left
    }

    const { prefixCount, suffixCount, oldSuffix, midEnd, exitingTail, next } = layout
    // offsetLeft rounds, and a rounded reference invents a sub-pixel FLIP.
    const prefixAnchor = prefixCount ? this._chars[0] : null
    const runAnchor = suffixCount ? this._chars[oldSuffix] : null
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
      oldPrefixTop: prefixAnchor ? sectionRect(sectionOf(prefixAnchor)).top : oldPrefix.top,
      oldRunX: runAnchorRect ? centerX(runAnchorRect) : 0,
      oldRunTop: runAnchor ? sectionRect(sectionOf(runAnchor)).top : oldSuffixRect.top,
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
    this._setWrap()
    reconcileWords(this._prefix, chars, 0, prefixCount)
    reconcileWords(this._middle, chars, prefixCount, midEnd)
    reconcileWords(this._suffix, chars, midEnd, midEnd + suffixCount)
    reconcileWords(this._tail, chars, midEnd + suffixCount, chars.length)
    // A survivor owns its roll; cancelling here cut it short. Clearing the
    // inline style is safe, since an effect outranks it.
    const kept = new Set(this._chars)
    for (let i = 0; i < chars.length; i++) {
      if (kept.has(chars[i])) clearAnimStyle(chars[i])
      else resetAnim(chars[i])
    }
    this._chars = chars
  }

  /** How far past `transition.duration` this update's exits run. */
  _exitTailMs() {
    return this._exitTail
  }

  _exitEndPx() {
    return this._exitEnd
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
          // Already released, and released again would take a live glyph.
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
    // A width transition still running owns the box; leave it and its styles be.
    if (!this._widthAnims.length) this._clearWidth()
  }

  private _reset() {
    for (let i = 0; i < this._widthAnims.length; i++) this._widthAnims[i].cancel()
    this._widthAnims.length = 0
    this._cancelTracked()
    clearRun(this._prefix)
    clearRun(this._middle)
    clearRun(this._suffix)
    clearRun(this._tail)
    for (let i = 0; i < this._chars.length; i++) resetAnim(this._chars[i])

    this._exitQueue = []
    this._exitEnd = 0
    this._inkSpans = []
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
    const dir = isOut ? -1 : 1
    const transform = `translateY(${dir * trend * CONFIG.y}em) scale(${CONFIG.scale}) rotateZ(${CONFIG.rotate}deg)`
    const filter = `blur(${CONFIG.blur}em)`
    // A space holds its slot on the same clock as the glyphs beside it, so it
    // runs an animation that does nothing rather than a wall-clock timer.
    const anim = el.animate(
      el.textContent === SPACE
        ? { opacity: 1 }
        : {
            opacity: isOut ? 0 : [0, 1],
            transform: isOut ? transform : [transform, ''],
            filter: isOut ? filter : [filter, ''],
          },
      { ...this.transition, fill: 'both', delay },
    )
    // Untracked on purpose: an exit plays on through the next update.
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
