import { BROWSER, ServerSafeHTMLElement } from './helpers'
import { SHRINK_EASING } from './const'
import type { Transition } from './types'

export type ScrittoChangeDetail = { phase: 'before' | 'after'; animate: boolean }

type FlowHost = HTMLElement & { transition: Transition }

const CLIP_STYLE = `position:absolute;inset:0;overflow:hidden;pointer-events:none;mask-image:linear-gradient(90deg,transparent,#000 1.1rem,#000 calc(100% - 1.1rem),transparent)`

const isWidthAnim = (anim: Animation) => {
  const effect = anim.effect
  return effect instanceof KeyframeEffect && effect.getKeyframes().some((frame) => frame.width != null)
}

const wordify = (root: HTMLElement) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
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
  private _first: DOMRect[] = []
  private _fromW = 0
  private _host: FlowHost | null = null
  private _wordEls: HTMLElement[] = []
  private _insetX = 0
  private _insetY = 0
  private _pendingHost: FlowHost | null = null
  private _last: DOMRect[] = []
  private _toW = 0

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
  }

  private _onChange = (event: Event) => {
    const custom = event as CustomEvent<ScrittoChangeDetail>
    if (!(custom.target instanceof HTMLElement)) return
    if (custom.target.closest('scritto-flow') !== this) return
    const host = custom.target as FlowHost
    if (custom.detail.phase === 'before') {
      this._pendingHost = host
      pendingFlows.add(this)
      if (!custom.detail.animate) {
        this._prepareWrites()
        this._prepareReads()
        pendingFlows.delete(this)
      }
      return
    }
    if (!custom.detail.animate) pendingFlows.delete(this)
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

  _prepareReads() {
    const host = this._pendingHost
    if (!host) return
    this._first = this._wordEls.map((word) => word.getBoundingClientRect())
    this._fromW = host.getBoundingClientRect().width
  }

  _measureLast() {
    const host = this._pendingHost
    if (!host) return null
    this._last = this._wordEls.map((word) => word.getBoundingClientRect())
    this._toW = host.getBoundingClientRect().width
    return host
  }

  private _resetWords() {
    for (const word of this._wordEls) {
      word.style.opacity = ''
      word.style.transform = ''
      word.style.visibility = ''
    }
  }

  private _clearHost(host: FlowHost | null) {
    if (!host) return
    for (const anim of host.getAnimations()) if (isWidthAnim(anim)) anim.cancel()
    host.style.width = ''
    host.style.marginRight = ''
    host.removeAttribute('data-shrink-clip')
  }

  private _drop() {
    for (const anim of this._anims) anim.cancel()
    this._anims.length = 0
    this._clip.replaceChildren()
    this._clearHost(this._host)
  }

  private _run(anim: Animation, gen: number, done?: () => void) {
    this._anims.push(anim)
    anim.onfinish = () => {
      if (gen !== this._gen) return
      done?.()
    }
  }

  _playMeasured(host: FlowHost) {
    const gen = this._gen
    const { duration, easing } = host.transition
    const widthEasing = SHRINK_EASING
    const words = this._wordEls
    const last = this._last
    const toW = this._toW
    const first = this._first
    const fromW = this._fromW

    host.style.width = `${fromW}px`
    host.style.marginRight = `${toW - fromW}px`
    if (toW < fromW) host.setAttribute('data-shrink-clip', '')
    const hostAnim = host.animate(
      { width: [`${fromW}px`, `${toW}px`], marginRight: [`${toW - fromW}px`, '0px'] },
      { duration, easing: widthEasing, fill: 'forwards' },
    )
    this._run(hostAnim, gen, () => {
      host.style.width = ''
      host.style.marginRight = ''
      host.removeAttribute('data-shrink-clip')
    })

    const t0 = document.timeline.currentTime
    if (t0 !== null) hostAnim.startTime = t0

    const lineH = first[0]?.height || 1
    const origin = this.getBoundingClientRect()
    const insetX = this._insetX
    const insetY = this._insetY
    const wrapped = words.map((_, i) => Math.abs((last[i]?.top ?? 0) - (first[i]?.top ?? 0)) >= lineH * 0.5)
    const enterShift = new Map<number, number>()
    const leaveShift = new Map<number, number>()
    for (let i = 0; i < words.length; i++) {
      if (!wrapped[i] || !first[i] || !last[i]) continue
      const down = last[i].top > first[i].top
      enterShift.set(Math.round(last[i].top), (enterShift.get(Math.round(last[i].top)) ?? 0) + (down ? -1 : 1) * (last[i].width + 6))
      leaveShift.set(Math.round(first[i].top), (leaveShift.get(Math.round(first[i].top)) ?? 0) + (down ? 1 : -1) * (first[i].width + 6))
    }

    const pin = (word: HTMLElement, rect: DOMRect) => {
      const ghost = word.cloneNode(true) as HTMLElement
      ghost.dataset.wrapGhost = ''
      ghost.removeAttribute('data-word')
      ghost.setAttribute('aria-hidden', 'true')
      ghost.style.cssText = `position:absolute;left:${rect.left - origin.left - insetX}px;top:${rect.top - origin.top - insetY}px;margin:0`
      this._clip.append(ghost)
      return ghost
    }

    for (let i = 0; i < words.length; i++) {
      const word = words[i]
      if (!first[i] || !last[i]) continue
      if (!wrapped[i]) {
        const dx = first[i].left - last[i].left
        if (Math.abs(dx) < 0.5) continue
        word.style.transform = `translateX(${dx}px)`
        const anim = word.animate({ transform: [`translateX(${dx}px)`, 'none'] }, { duration, easing, fill: 'forwards' })
        if (t0 !== null) anim.startTime = t0
        this._run(anim, gen, () => {
          word.style.transform = ''
        })
        continue
      }

      const down = last[i].top > first[i].top
      const enterX = enterShift.get(Math.round(last[i].top)) ?? (down ? -last[i].width : last[i].width)
      const leaveX = leaveShift.get(Math.round(first[i].top)) ?? (down ? 24 : -24)
      word.style.visibility = 'hidden'

      const leaving = pin(word, first[i])
      this._run(
        leaving.animate(
          { opacity: [1, 0], transform: ['none', `translateX(${leaveX}px)`] },
          { duration, easing, fill: 'forwards' },
        ),
        gen,
        () => leaving.remove(),
      )

      const entering = pin(word, last[i])
      this._run(
        entering.animate(
          { opacity: [0, 1], transform: [`translateX(${enterX}px)`, 'none'] },
          { duration, easing, fill: 'forwards' },
        ),
        gen,
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
