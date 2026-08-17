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
  type Char,
} from './helpers'
import { BOUNCE_TRANSITION, CONFIG, DEFAULT_TRANSITION, SPACE, STYLES } from './const'
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
  enters: HTMLElement[]
  trend: number
  oldPrefixX: number
  oldPrefixTop: number
  oldRunX: number
  oldRunTop: number
  exitingX: number
  tailX: number
}

const centerX = (rect: DOMRect) => (rect.left + rect.right) * 0.5
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
  private _chars: HTMLElement[] = []
  private _exitingChars: [el: HTMLElement, left: number][] = []
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

  constructor() {
    super()
    const shadow = this.attachShadow({ mode: 'open' })
    if (styleSheet) shadow.adoptedStyleSheets = [styleSheet]
    shadow.append(this._prefix, this._middle, this._suffix, this._tail)
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

  setOptions({ bounce, transition, trend, respectMotionPreference }: ScrittoOptions) {
    if (bounce === true || bounce === false) this.bounce = bounce
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
    this._queueExit(this._chars.slice(plan.prefixCount, plan.oldSuffix), plan.exitingX, plan.trend)
    this._queueExit(plan.exitingTail, plan.tailX, plan.trend)
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
    for (let i = 0; i < this._exitingChars.length; i++) {
      const [el, x] = this._exitingChars[i]
      el.style.transform = `translateX(${x - edge}px)`
    }
    const line = newPrefix.height || 1
    const prefixDx =
      !prefixAnchor || Math.abs(newPrefix.top - plan.oldPrefixTop) >= line * 0.5
        ? 0
        : plan.oldPrefixX - centerX(prefixAnchor)
    const suffixDx =
      !suffixAnchor || Math.abs(newSuffix.top - plan.oldRunTop) >= line * 0.5
        ? 0
        : plan.oldRunX - centerX(suffixAnchor)
    const prefixFlip = flip(this._prefix, prefixDx, this.transition, true)
    const suffixFlip = flip(this._suffix, suffixDx, this.transition, true)
    if (prefixFlip) this._anims.push(prefixFlip)
    if (suffixFlip) this._anims.push(suffixFlip)
    this._armEnters(plan.enters, plan.trend)
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
      const cur = parseFloat(this._value)
      const prev = parseFloat(this._prevValue)
      trend = !isNaN(cur) && !isNaN(prev) ? (cur > prev ? 1 : -1) : 1
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
    return {
      ...layout,
      enters: next.slice(prefixCount, midEnd).concat(next.slice(midEnd + suffixCount)),
      trend,
      oldPrefixX: prefixAnchorRect ? centerX(prefixAnchorRect) : 0,
      oldPrefixTop: prefixAnchor ? sectionRect(prefixAnchor.parentElement!).top : oldPrefix.top,
      oldRunX: runAnchorRect ? centerX(runAnchorRect) : 0,
      oldRunTop: runAnchor ? sectionRect(runAnchor.parentElement!).top : oldSuffixRect.top,
      exitingX: prefixCount < oldSuffix ? exitX(this._chars[prefixCount]) : 0,
      tailX: exitingTail.length ? exitX(exitingTail[0]) : 0,
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

  private _queueExit(nodes: HTMLElement[], x: number, trend: number) {
    if (!nodes.length) return
    const group = createEl('span')
    group.toggleAttribute('inert', true)
    for (let i = 0; i < nodes.length; i++) {
      clearAnimStyle(nodes[i])
      group.appendChild(nodes[i])
    }
    const entry: [HTMLElement, number] = [group, x]
    this._exitingChars.push(entry)
    this.shadowRoot!.appendChild(group)

    let left = nodes.length
    const stagger = this._stagger(nodes)
    for (let i = 0; i < nodes.length; i++) {
      this._animateChar(nodes[i], true, trend, i * stagger, () => {
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

  private _armEnters(enters: HTMLElement[], trend: number) {
    const pending = enters.filter((el) => el.textContent !== SPACE)
    if (!pending.length) return
    const stagger = this._stagger(pending)
    for (let i = 0; i < pending.length; i++) {
      pending[i].style.opacity = ''
      this._animateChar(pending[i], false, trend, i * stagger)
    }
  }

  private _cancelTracked() {
    for (let i = 0; i < this._anims.length; i++) this._anims[i].cancel()
    this._anims.length = 0
  }

  private _reset() {
    this._cancelTracked()
    clearAnimStyle(this._prefix)
    clearAnimStyle(this._middle)
    clearAnimStyle(this._suffix)
    clearAnimStyle(this._tail)
    for (let i = 0; i < this._chars.length; i++) resetAnim(this._chars[i])

    const exiting = this._exitingChars
    this._exitingChars = []
    for (let i = 0; i < exiting.length; i++) {
      const group = exiting[i][0]
      const nodes = group.querySelectorAll<HTMLElement>('.char')
      for (let j = 0; j < nodes.length; j++) releaseChar(nodes[j])
      group.remove()
    }
  }

  private _stagger(nodes: HTMLElement[]) {
    let n = 0
    for (let i = 0; i < nodes.length; i++) if (nodes[i].textContent !== SPACE) n++
    return (this.transition.duration * CONFIG.stagger) / (n || 1)
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
