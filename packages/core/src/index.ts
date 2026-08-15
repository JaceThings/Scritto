import type { NumericTextOptions, Transition, Trend, Value } from './types'
import {
  ServerSafeHTMLElement,
  createEl,
  createChar,
  releaseChar,
  getRect,
  BROWSER,
  flip,
  isReducedMotion,
  diff,
  reconcileChildren,
  resetAnim,
  finishIdentityAnim,
} from './helpers'
import { CONFIG, DEFAULT_TRANSITION, SPACE, STYLES } from './const'
import { NumericFlow } from './flow'

let styleSheet: CSSStyleSheet
if (BROWSER) {
  styleSheet = new CSSStyleSheet()
  styleSheet.replaceSync(STYLES)
}

class NumericText extends ServerSafeHTMLElement {
  private _prefix = createEl('span', 'section')
  private _middle = createEl('span', 'section')
  private _suffix = createEl('span', 'section')
  private _chars: HTMLElement[] = []
  private _exitingChars: [el: HTMLElement, left: number][] = []
  private _isRTL = false
  private _value = ''
  private _prevValue = ''

  public transition: Transition = DEFAULT_TRANSITION
  public trend: Trend = 0
  public respectMotionPreference = true

  constructor() {
    super()
    const shadow = this.attachShadow({ mode: 'open' })
    if (styleSheet) shadow.adoptedStyleSheets = [styleSheet]
    shadow.append(this._prefix, this._middle, this._suffix)
  }

  connectedCallback() {
    this._isRTL = getComputedStyle(this).direction === 'rtl'
    this._render(false)
  }

  disconnectedCallback() {
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
    this.dispatchEvent(new CustomEvent('numericchange', { bubbles: true, detail: { phase: 'before', animate } }))
    this._render(animate)
    this.dispatchEvent(new CustomEvent('numericchange', { bubbles: true, detail: { phase: 'after', animate } }))
  }

  setOptions(opts: NumericTextOptions) {
    if (opts.transition) this.transition = { ...DEFAULT_TRANSITION, ...opts.transition }
    if (typeof opts.trend === 'number') this.trend = opts.trend
    if (typeof opts.respectMotionPreference === 'boolean') this.respectMotionPreference = opts.respectMotionPreference
  }

  private _render(animate: boolean) {
    const { prefixCount, suffixCount, labels } = diff(this._chars, this._value)
    if (prefixCount === this._chars.length && prefixCount === labels.length) {
      this._reset()
      return
    }

    const mid = labels.length - prefixCount - suffixCount
    const oldSuffix = this._chars.length - suffixCount
    const midEnd = prefixCount + mid

    if (!animate) {
      this._reset()
      const next = this._nextChars(prefixCount, mid, suffixCount, oldSuffix, labels)
      for (let i = prefixCount; i < oldSuffix; i++) releaseChar(this._chars[i])
      this._commit(next, prefixCount, midEnd)
      return
    }

    let trend = this.trend
    if (!trend) {
      const cur = parseFloat(this._value)
      const prev = parseFloat(this._prevValue)
      trend = !isNaN(cur) && !isNaN(prev) ? (cur > prev ? 1 : -1) : 1
    }

    const oldPrefix = getRect(this._prefix)
    const oldSuffixRect = getRect(this._suffix)
    const oldMiddle = oldPrefix.width && oldSuffixRect.width ? oldPrefix : getRect(this._middle)

    let exitingX = 0
    if (prefixCount < oldSuffix) {
      const anchor = this._chars[prefixCount]
      const parent = anchor.parentElement!
      const parentRect = parent === this._prefix ? oldPrefix : parent === this._suffix ? oldSuffixRect : oldMiddle
      exitingX = this._isRTL
        ? parentRect.left + anchor.offsetLeft + anchor.offsetWidth
        : parentRect.left + anchor.offsetLeft
    }

    const next = this._nextChars(prefixCount, mid, suffixCount, oldSuffix, labels)
    const exiting = this._chars.slice(prefixCount, oldSuffix)
    this._queueExit(exiting, exitingX, trend)
    this._commit(next, prefixCount, midEnd)

    resetAnim(this._prefix)
    resetAnim(this._suffix)

    const newPrefix = getRect(this._prefix)
    const newSuffix = getRect(this._suffix)
    const edge = this._isRTL ? newPrefix.right : newPrefix.left
    for (let i = 0; i < this._exitingChars.length; i++) {
      const [el, x] = this._exitingChars[i]
      el.style.transform = `translateX(${x - edge}px)`
    }

    const enters = next.slice(prefixCount, midEnd)
    const stagger = this._stagger(enters)
    const hold =
      enters.length && (prefixCount > 0 || suffixCount > 0) ? this.transition.duration * CONFIG.enterHold : 0
    for (let i = 0; i < enters.length; i++) this._animateChar(enters[i], false, trend, hold + i * stagger)

    flip(this._prefix, this._edgeDx(oldPrefix, newPrefix, oldMiddle, true), this.transition, true)
    flip(this._suffix, this._edgeDx(oldSuffixRect, newSuffix, oldMiddle, false), this.transition, true)
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
    return next
  }

  private _commit(chars: HTMLElement[], prefixCount: number, midEnd: number) {
    reconcileChildren(this._prefix, chars, 0, prefixCount)
    reconcileChildren(this._middle, chars, prefixCount, midEnd)
    reconcileChildren(this._suffix, chars, midEnd, chars.length)
    this._chars = chars
  }

  private _queueExit(nodes: HTMLElement[], x: number, trend: number) {
    if (!nodes.length) return
    const group = createEl('span')
    group.toggleAttribute('inert', true)
    for (let i = 0; i < nodes.length; i++) group.appendChild(nodes[i])
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

  private _reset() {
    resetAnim(this._prefix)
    resetAnim(this._suffix)
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

  private _edgeDx(oldRect: DOMRect, newRect: DOMRect, oldMiddle: DOMRect, isPrefix: boolean) {
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

if (BROWSER && !customElements.get('numeric-text')) {
  customElements.define('numeric-text', NumericText)
}

declare global {
  interface HTMLElementTagNameMap {
    'numeric-text': NumericText
  }
}

export type * from './types'
export type { NumericChangeDetail } from './flow'
export { NumericText, NumericFlow, BROWSER }
