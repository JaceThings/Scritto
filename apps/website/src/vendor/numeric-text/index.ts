import type { NumericTextOptions, Transition, Trend, Value } from './types'
import { ServerSafeHTMLElement, createEl, getRect, cancelAnim, BROWSER, flip, isReducedMotion, diff } from './helpers'
import { CONFIG, DEFAULT_TRANSITION, SPACE, STYLES } from './const'

let styleSheet: CSSStyleSheet
if (BROWSER) {
  styleSheet = new CSSStyleSheet()
  styleSheet.replaceSync(STYLES)
}

class NumericText extends ServerSafeHTMLElement {
  private _prefix: HTMLElement
  private _middle: HTMLElement
  private _suffix: HTMLElement

  private _chars: HTMLElement[] = []
  private _exitingChars: [el: HTMLElement, left: number][] = []

  private _isRTL: boolean = false

  private _value: string = ''
  private _prevValue: string = ''

  public transition: Transition = DEFAULT_TRANSITION
  public trend: Trend = 0
  public respectMotionPreference: boolean = true

  constructor() {
    super()

    const shadow = this.attachShadow({ mode: 'open' })
    if (styleSheet) shadow.adoptedStyleSheets = [styleSheet]

    this._prefix = createEl('span', 'section')
    this._middle = createEl('span', 'section')
    this._suffix = createEl('span', 'section')

    shadow.append(this._prefix, this._middle, this._suffix)
  }

  connectedCallback() {
    this._isRTL = getComputedStyle(this).direction === 'rtl'
    this._render(false)
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

    const shouldAnimate = withAnimation && !(this.respectMotionPreference && isReducedMotion())
    this._render(shouldAnimate)
  }

  setOptions(opts: NumericTextOptions) {
    if (opts.transition) this.transition = { ...DEFAULT_TRANSITION, ...opts.transition }
    if (typeof opts.trend === 'number') this.trend = opts.trend
    if (typeof opts.respectMotionPreference === 'boolean') this.respectMotionPreference = opts.respectMotionPreference
  }

  private _render(animate: boolean) {
    const { prefixCount, suffixCount, middleLabels } = diff(this._chars, this._value)

    const newMiddleLen = middleLabels.length
    const oldSuffixStart = this._chars.length - suffixCount
    const totalLen = prefixCount + newMiddleLen + suffixCount

    if (!animate) {
      const nextChars = new Array(totalLen)
      const newSuffixStart = prefixCount + newMiddleLen

      for (let i = 0; i < prefixCount; i++) nextChars[i] = this._chars[i]
      for (let i = 0; i < newMiddleLen; i++) {
        nextChars[prefixCount + i] = createEl('span', 'char', middleLabels[i])
      }
      for (let i = 0; i < suffixCount; i++) {
        nextChars[newSuffixStart + i] = this._chars[oldSuffixStart + i]
      }

      for (let i = prefixCount; i < oldSuffixStart; i++) {
        this._chars[i].remove()
      }

      this._prefix.replaceChildren(...nextChars.slice(0, prefixCount))
      this._middle.replaceChildren(...nextChars.slice(prefixCount, newSuffixStart))
      this._suffix.replaceChildren(...nextChars.slice(newSuffixStart))

      this._chars = nextChars
      return
    }

    let trend = this.trend
    if (!trend) {
      const c = parseFloat(this._value)
      const p = parseFloat(this._prevValue)
      trend = !isNaN(c) && !isNaN(p) ? (c > p ? 1 : -1) : 1
    }

    const oldPrefixRect = getRect(this._prefix)
    const oldMiddleRect = getRect(this._middle)
    const oldSuffixRect = getRect(this._suffix)

    let exitingX = 0
    if (prefixCount < oldSuffixStart) {
      const exitingAnchor = this._chars[prefixCount]
      const parent = exitingAnchor.parentElement!
      const parentRect =
        parent === this._prefix ? oldPrefixRect : parent === this._suffix ? oldSuffixRect : oldMiddleRect

      if (this._isRTL) exitingX = parentRect.left + exitingAnchor.offsetLeft + exitingAnchor.offsetWidth
      else exitingX = parentRect.left + exitingAnchor.offsetLeft
    }

    const nextChars = new Array(totalLen)
    const exitingNodes = []
    for (let i = 0; i < prefixCount; i++) nextChars[i] = this._chars[i]
    for (let i = prefixCount; i < oldSuffixStart; i++) {
      exitingNodes.push(this._chars[i])
    }

    const newMiddleNodes = new Array(newMiddleLen)
    for (let i = 0; i < newMiddleLen; i++) {
      const el = createEl('span', 'char', middleLabels[i])
      newMiddleNodes[i] = el
      nextChars[prefixCount + i] = el
    }

    const newSuffixStart = prefixCount + newMiddleLen
    for (let i = 0; i < suffixCount; i++) {
      nextChars[newSuffixStart + i] = this._chars[oldSuffixStart + i]
    }

    if (exitingNodes.length) {
      const group = createEl('span')
      group.toggleAttribute('inert', true)

      for (const node of exitingNodes) group.appendChild(node)

      const newExitEntry = [group, exitingX] as [HTMLElement, number]
      this._exitingChars.push(newExitEntry)
      this.shadowRoot!.appendChild(group)

      let active = exitingNodes.length
      const exitStagger = this._getStagger(exitingNodes)
      for (let i = 0; i < exitingNodes.length; i++) {
        const node = exitingNodes[i]
        this._animateChar(node, true, trend, i * exitStagger, () => {
          node.remove()
          if (--active === 0) {
            group.remove()
            const idx = this._exitingChars.indexOf(newExitEntry!)
            if (idx !== -1) this._exitingChars.splice(idx, 1)
          }
        })
      }
    }

    this._prefix.replaceChildren(...nextChars.slice(0, prefixCount))
    this._middle.replaceChildren(...newMiddleNodes)
    this._suffix.replaceChildren(...nextChars.slice(newSuffixStart))
    this._chars = nextChars

    cancelAnim(this._prefix)
    cancelAnim(this._suffix)
    const newPrefixRect = getRect(this._prefix)
    const newSuffixRect = getRect(this._suffix)

    const exitingEdge = this._isRTL ? newPrefixRect.right : newPrefixRect.left
    for (const [el, x] of this._exitingChars) {
      const newX = x - exitingEdge
      el.style.transform = `translateX(${newX}px)`
    }

    const enterStagger = this._getStagger(newMiddleNodes)
    for (let i = 0; i < newMiddleLen; i++) {
      this._animateChar(newMiddleNodes[i], false, trend, i * enterStagger)
    }

    const pDx = this._getEdgeDx(oldPrefixRect, newPrefixRect, oldMiddleRect, true)
    const sDx = this._getEdgeDx(oldSuffixRect, newSuffixRect, oldMiddleRect, false)

    flip(this._prefix, pDx, this.transition)
    flip(this._suffix, sDx, this.transition)
  }

  private _getStagger(nodes: HTMLElement[]) {
    let animatingCount = 0
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].textContent !== SPACE) {
        animatingCount++
      }
    }

    return (this.transition.duration * CONFIG.stagger) / (animatingCount || 1)
  }

  private _getEdgeDx(oldRect: DOMRect, newRect: DOMRect, oldMiddle: DOMRect, isPrefix: boolean) {
    if (this._isRTL === isPrefix) {
      const oldEdge = oldRect.width ? oldRect.right : oldMiddle.right
      return oldEdge - newRect.right
    } else {
      const oldEdge = oldRect.width ? oldRect.left : oldMiddle.left
      return oldEdge - newRect.left
    }
  }

  private _animateChar(el: HTMLElement, isOut: boolean, trend: number, delay: number, onFinish?: () => void) {
    if (el.textContent === SPACE) {
      if (isOut && onFinish) setTimeout(onFinish, this.transition.duration + delay)
      return
    }

    const m = isOut ? -1 : 1
    const transform = `translateY(${m * trend * CONFIG.y}em) scale(${CONFIG.scale}) rotateZ(${CONFIG.rotate}deg)`
    const filter = `blur(${CONFIG.blur}em)`

    const anim = el.animate(
      {
        opacity: isOut ? 0 : [0, 1],
        transform: isOut ? transform : [transform, ''],
        filter: isOut ? filter : [filter, ''],
      },
      {
        duration: this.transition.duration,
        easing: this.transition.easing,
        fill: 'both',
        delay,
      },
    )
    if (onFinish) anim.onfinish = onFinish
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
export { NumericText, BROWSER }
