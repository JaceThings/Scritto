import type { ScrittoOptions, Transition, Trend, Value } from './types'
import {
  ServerSafeHTMLElement,
  createEl,
  createChar,
  releaseChar,
  BROWSER,
  flip,
  isReducedMotion,
  diff,
  reconcileChildren,
  clearAnimStyle,
  finishIdentityAnim,
  getRect,
  box,
  type Box,
} from './helpers'
import { BOUNCE_TRANSITION, CONFIG, DEFAULT_TRANSITION, SPACE, STYLES } from './const'
import { ScrittoFlow, playFlows, prepareFlows } from './flow'

let styleSheet: CSSStyleSheet
if (BROWSER) {
  styleSheet = new CSSStyleSheet()
  styleSheet.replaceSync(STYLES)
}

type Plan = {
  prefixCount: number
  mid: number
  suffixCount: number
  oldSuffix: number
  labels: string[]
  midEnd: number
  tail: number
  exitingTail: HTMLElement[]
  next: HTMLElement[]
  enters: HTMLElement[]
  trend: number
  oldPrefix: Box
  oldMiddle: Box
  oldSuffixBox: Box
  exitingX: number
  tailX: number
}

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
  let t = performance.now()
  for (const el of list) {
    if (!el.isConnected) continue
    el._emit('before', true)
  }
  prepareFlows()
  for (const el of list) {
    if (!el.isConnected) continue
    el._prepareAnimated()
  }
  flushStats.prepare += performance.now() - t
  t = performance.now()
  for (const el of list) {
    if (!el.isConnected) continue
    el._commitAnimated()
  }
  flushStats.commit += performance.now() - t
  t = performance.now()
  for (const el of list) {
    if (!el.isConnected) continue
    el._finishAnimated()
    el._emit('after', true)
  }
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
  private _enterGen = 0
  private _isRTL = false
  private _value = ''
  private _prevValue = ''
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
    this._isRTL = getComputedStyle(this).direction === 'rtl'
    this._render(false)
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
    const animate = withAnimation && !(this.respectMotionPreference && isReducedMotion())
    if (!animate) {
      this._emit('before', false)
      this._render(false)
      this._emit('after', false)
      return
    }
    enqueue(this)
  }

  _emit(phase: 'before' | 'after', animate: boolean) {
    this.dispatchEvent(new CustomEvent('scrittochange', { bubbles: true, detail: { phase, animate } }))
  }

  setOptions(opts: ScrittoOptions) {
    if (typeof opts.bounce === 'boolean') this.bounce = opts.bounce
    const base = this.bounce ? BOUNCE_TRANSITION : DEFAULT_TRANSITION
    if (opts.transition) this.transition = { ...base, ...opts.transition }
    else if (typeof opts.bounce === 'boolean') this.transition = { ...base }
    if (typeof opts.trend === 'number') this.trend = opts.trend
    if (typeof opts.respectMotionPreference === 'boolean') this.respectMotionPreference = opts.respectMotionPreference
  }

  private _render(animate: boolean) {
    if (!animate) {
      const plan = this._buildPlan(false)
      if (!plan) {
        this._reset()
        return
      }
      this._reset()
      for (let i = plan.prefixCount; i < plan.oldSuffix; i++) releaseChar(this._chars[i])
      for (let i = 0; i < plan.exitingTail.length; i++) releaseChar(plan.exitingTail[i])
      this._commit(plan.next, plan.prefixCount, plan.midEnd, plan.suffixCount)
      return
    }
    this._prepareAnimated()
    this._commitAnimated()
    this._finishAnimated()
  }

  _prepareAnimated() {
    this._readyPlan = this._buildPlan(true)
  }

  _commitAnimated() {
    const plan = this._readyPlan
    if (!plan) {
      this._reset()
      return
    }
    for (let i = 0; i < plan.enters.length; i++) if (plan.enters[i].textContent !== SPACE) plan.enters[i].style.opacity = '0'
    this._cancelTracked()
    this._queueExit(this._chars.slice(plan.prefixCount, plan.oldSuffix), plan.exitingX, plan.trend)
    this._queueExit(plan.exitingTail, plan.tailX, plan.trend)
    this._commit(plan.next, plan.prefixCount, plan.midEnd, plan.suffixCount)
    clearAnimStyle(this._prefix)
    clearAnimStyle(this._suffix)
  }

  _finishAnimated() {
    const plan = this._readyPlan
    this._readyPlan = null
    if (!plan) return
    const newPrefix = getRect(this._prefix)
    const newSuffix = getRect(this._suffix)
    const edge = this._isRTL ? newPrefix.right : newPrefix.left
    for (let i = 0; i < this._exitingChars.length; i++) {
      const [el, x] = this._exitingChars[i]
      el.style.transform = `translateX(${x - edge}px)`
    }
    const prefixFlip = flip(this._prefix, this._edgeDx(plan.oldPrefix, newPrefix, plan.oldMiddle, true), this.transition, true)
    const suffixFlip = flip(this._suffix, this._edgeDx(plan.oldSuffixBox, newSuffix, plan.oldMiddle, false), this.transition, true)
    if (prefixFlip) this._anims.push(prefixFlip)
    if (suffixFlip) this._anims.push(suffixFlip)
    this._armEnters(plan.enters, plan.trend)
  }

  private _buildPlan(animate: boolean): Plan | null {
    const { prefixCount, suffixCount, labels } = diff(this._chars, this._value)
    if (prefixCount === this._chars.length && prefixCount === labels.length) return null

    let mid = labels.length - prefixCount - suffixCount
    let tail = 0
    let peel = 0
    while (peel < mid && labels[prefixCount + peel] === ',') peel++
    if (peel > 0 && peel < mid) {
      tail = mid - peel
      mid = peel
    }
    let oldSuffix = this._chars.length - suffixCount
    let oldLead = 0
    while (prefixCount + oldLead < oldSuffix && this._chars[prefixCount + oldLead].textContent === ',') oldLead++
    if (oldLead > 0 && prefixCount + oldLead < oldSuffix) oldSuffix = prefixCount + oldLead
    const midEnd = prefixCount + mid
    const exitingTail = this._chars.slice(oldSuffix + suffixCount)
    const next = this._nextChars(prefixCount, mid, suffixCount, oldSuffix, labels)
    if (!animate) {
      return {
        prefixCount,
        mid,
        suffixCount,
        oldSuffix,
        labels,
        midEnd,
        tail,
        exitingTail,
        next,
        enters: [],
        trend: 0,
        oldPrefix: box(0, 0),
        oldMiddle: box(0, 0),
        oldSuffixBox: box(0, 0),
        exitingX: 0,
        tailX: 0,
      }
    }

    let trend = this.trend
    if (!trend) {
      const cur = parseFloat(this._value)
      const prev = parseFloat(this._prevValue)
      trend = !isNaN(cur) && !isNaN(prev) ? (cur > prev ? 1 : -1) : 1
    }

    const oldPrefix = getRect(this._prefix)
    const oldSuffixRect = getRect(this._suffix)
    const midRect = getRect(this._middle)
    const oldTail = getRect(this._tail)
    const oldMiddle = midRect.width ? midRect : oldPrefix.width && oldSuffixRect.width ? oldPrefix : midRect
    const sectionRect = (el: HTMLElement) =>
      el === this._prefix ? oldPrefix : el === this._suffix ? oldSuffixRect : el === this._tail ? oldTail : midRect

    const exitX = (anchor: HTMLElement) => {
      const parentRect = sectionRect(anchor.parentElement!)
      return this._isRTL
        ? parentRect.left + anchor.offsetLeft + anchor.offsetWidth
        : parentRect.left + anchor.offsetLeft
    }

    return {
      prefixCount,
      mid,
      suffixCount,
      oldSuffix,
      labels,
      midEnd,
      tail,
      exitingTail,
      next,
      enters: next.slice(prefixCount, midEnd).concat(tail ? next.slice(midEnd + suffixCount) : []),
      trend,
      oldPrefix: box(oldPrefix.left, oldPrefix.width),
      oldMiddle: box(oldMiddle.left, oldMiddle.width),
      oldSuffixBox: box(oldSuffixRect.left, oldSuffixRect.width),
      exitingX: prefixCount < oldSuffix ? exitX(this._chars[prefixCount]) : 0,
      tailX: exitingTail.length ? exitX(exitingTail[0]) : 0,
    }
  }

  private _nextChars(
    prefixCount: number,
    mid: number,
    suffixCount: number,
    oldSuffix: number,
    labels: string[],
  ) {
    const next = new Array<HTMLElement>(labels.length)
    for (let i = 0; i < prefixCount; i++) next[i] = this._chars[i]
    for (let i = 0; i < mid; i++) next[prefixCount + i] = createChar(labels[prefixCount + i])
    for (let i = 0; i < suffixCount; i++) next[prefixCount + mid + i] = this._chars[oldSuffix + i]
    for (let i = prefixCount + mid + suffixCount; i < labels.length; i++) next[i] = createChar(labels[i])
    return next
  }

  private _commit(chars: HTMLElement[], prefixCount: number, midEnd: number, suffixCount: number) {
    reconcileChildren(this._prefix, chars, 0, prefixCount)
    reconcileChildren(this._middle, chars, prefixCount, midEnd)
    reconcileChildren(this._suffix, chars, midEnd, midEnd + suffixCount)
    reconcileChildren(this._tail, chars, midEnd + suffixCount, chars.length)
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
    this._enterGen += 1
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
    this._enterGen += 1
    this._cancelTracked()
    clearAnimStyle(this._prefix)
    clearAnimStyle(this._middle)
    clearAnimStyle(this._suffix)
    clearAnimStyle(this._tail)
    for (let i = 0; i < this._chars.length; i++) clearAnimStyle(this._chars[i])

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

  private _edgeDx(oldRect: Box, newRect: Box, oldMiddle: Box, isPrefix: boolean) {
    if (this._isRTL === isPrefix) return (oldRect.width ? oldRect.right : oldMiddle.right) - newRect.right
    return (oldRect.width ? oldRect.left : oldMiddle.left) - newRect.left
  }

  private _animateChar(el: HTMLElement, isOut: boolean, trend: number, delay: number, onFinish?: () => void) {
    if (el.textContent === SPACE) {
      if (isOut && onFinish) setTimeout(onFinish, this.transition.duration + delay)
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
    this._anims.push(anim)

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
