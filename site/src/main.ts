import '@numeric-text/core'
import type { NumericText, Trend } from '@numeric-text/core'
import './styles.css'
import { bindThemeToggle } from './theme'

const MODE_CLASS = 'cursor-pointer rounded-xl border-0 bg-surface px-4 py-2 font-medium'
const TAB_CLASS =
  'relative cursor-pointer border-0 bg-transparent p-0 font-[inherit] opacity-40 transition-opacity duration-200 ease-out hover:opacity-65 data-[on]:opacity-100 data-[on]:hover:opacity-100'

const MODES = {
  Text: 'Creative | Create | Code | Code editor | Creator',
  Numbers: '24 | -20 | 10 | 5 | $2.5 | $2',
  Emoji: 'Hello 👋 | Hola 👋 | Hey 👋',
} as const

const ALIGN: Record<string, string> = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
  dynamic: 'center',
}

const EASING = {
  bouncy:
    'linear(0,.1052,.3155,.532,.7112,.8414,.9265,.9765,1.0023,1.013,1.0151,1.0133,1.01,1.0068,1.0041,1.0022,1.001,1)',
  smooth: 'linear(0,.1803,.4551,.6711,.8122,.8966,.9445,.9708,.9848,.9922,.996,.998,1)',
} as const

const TREND: Record<string, Trend> = { up: 1, auto: 0, down: -1 }
const FLOW_A = ['104', '1.3']
const FLOW_B = ['1,234,567', '12']

const el = document.querySelector<NumericText>('#test')!
const flowA = document.querySelector<NumericText>('#flow-a')!
const flowB = document.querySelector<NumericText>('#flow-b')!
const flowWrap = document.querySelector<HTMLElement>('#flow-wrap')!
const stage = document.querySelector<HTMLButtonElement>('#stage')!
const hint = document.querySelector<HTMLElement>('#hint')!
const variantsInput = document.querySelector<HTMLInputElement>('#variants')!

let variants = MODES.Text
let index = 0
let flowAIndex = 0
let flowBIndex = 0
let align = 'center'
let trend: keyof typeof TREND = 'auto'
let easing: keyof typeof EASING = 'bouncy'
let slow = false
let debug = false
let drift: Animation | null = null

const parts = () => variants.split('|').map((part) => part.trim()).filter(Boolean)

const options = () => ({
  trend: TREND[trend],
  respectMotionPreference: false,
  transition: { duration: slow ? 1100 : 550, easing: EASING[easing] },
})

const paint = (node: NumericText, value: string, animate: boolean) => {
  node.setOptions(options())
  node.update(value, animate)
  node.setAttribute('aria-label', value)
}

const wordify = (root: HTMLElement) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  for (const node of nodes) {
    if (node.parentElement?.closest('numeric-text')) continue
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
      span.className = 'inline-block'
      span.textContent = part
      frag.append(span)
    }
    node.replaceWith(frag)
  }
}

const isWidthAnim = (anim: Animation) => {
  const effect = anim.effect
  return effect instanceof KeyframeEffect && effect.getKeyframes().some((frame) => frame.width != null)
}

const wrapClip = document.createElement('span')
wrapClip.dataset.wrapClip = ''
wrapClip.setAttribute('aria-hidden', 'true')
flowWrap.append(wrapClip)

const clearWrap = () => {
  wrapClip.replaceChildren()
  for (const word of flowWrap.querySelectorAll<HTMLElement>('[data-word]')) {
    for (const anim of word.getAnimations()) anim.cancel()
    word.style.opacity = ''
    word.style.transform = ''
    word.style.visibility = ''
  }
  for (const anim of flowB.getAnimations()) if (isWidthAnim(anim)) anim.cancel()
  flowB.style.width = ''
  flowB.style.marginRight = ''
  flowB.style.overflow = ''
}

const flipWrap = (root: HTMLElement) => {
  clearWrap()
  const words = [...root.querySelectorAll<HTMLElement>('[data-word]')]
  const first = words.map((word) => word.getBoundingClientRect())
  const fromW = flowB.getBoundingClientRect().width
  return () => {
    const { duration, easing } = options().transition
    for (const anim of flowB.getAnimations()) if (isWidthAnim(anim)) anim.finish()
    const last = words.map((word) => word.getBoundingClientRect())
    const toW = flowB.getBoundingClientRect().width

    for (const anim of flowB.getAnimations()) if (isWidthAnim(anim)) anim.cancel()
    flowB.style.overflow = 'visible'
    flowB.style.width = `${fromW}px`
    flowB.style.marginRight = `${toW - fromW}px`
    flowB.animate(
      { width: [`${fromW}px`, `${toW}px`], marginRight: [`${toW - fromW}px`, '0px'] },
      { duration, easing, fill: 'forwards' },
    ).onfinish = () => {
      flowB.style.width = ''
      flowB.style.marginRight = ''
      flowB.style.overflow = ''
    }

    const lineH = first[0]?.height || 1
    const origin = root.getBoundingClientRect()
    const css = getComputedStyle(root)
    const insetX = parseFloat(css.borderLeftWidth)
    const insetY = parseFloat(css.borderTopWidth)
    const wrapped = words.map((_, i) => Math.abs(last[i].top - first[i].top) >= lineH * 0.5)
    const enterShift = new Map<number, number>()
    const leaveShift = new Map<number, number>()
    for (let i = 0; i < words.length; i++) {
      if (!wrapped[i]) continue
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
      wrapClip.append(ghost)
      return ghost
    }

    for (let i = 0; i < words.length; i++) {
      const word = words[i]
      if (!wrapped[i]) {
        const dx = first[i].left - last[i].left
        if (Math.abs(dx) < 0.5) continue
        word.style.transform = `translateX(${dx}px)`
        word.animate({ transform: [`translateX(${dx}px)`, 'none'] }, { duration, easing, fill: 'forwards' }).onfinish =
          () => {
            word.style.transform = ''
          }
        continue
      }

      const down = last[i].top > first[i].top
      const enterX = enterShift.get(Math.round(last[i].top)) ?? (down ? -last[i].width : last[i].width)
      const leaveX = leaveShift.get(Math.round(first[i].top)) ?? (down ? 24 : -24)
      word.style.visibility = 'hidden'

      const leaving = pin(word, first[i])
      leaving.animate(
        { opacity: [1, 0], transform: ['none', `translateX(${leaveX}px)`] },
        { duration, easing, fill: 'forwards' },
      ).onfinish = () => leaving.remove()

      const entering = pin(word, last[i])
      entering.animate(
        { opacity: [0, 1], transform: [`translateX(${enterX}px)`, 'none'] },
        { duration, easing, fill: 'forwards' },
      ).onfinish = () => {
        entering.remove()
        word.style.visibility = ''
      }
    }
  }
}

const syncFlow = (animate: boolean) => {
  paint(flowA, FLOW_A[flowAIndex], animate)
  paint(flowB, FLOW_B[flowBIndex], animate)
}

const apply = (animate: boolean) => {
  const list = parts()
  if (!list.length) return
  index %= list.length
  paint(el, list[index], animate)
  syncFlow(false)
}

const tabs = (root: HTMLElement, items: string[], current: () => string, set: (value: string) => void) => {
  root.replaceChildren(
    ...items.map((item) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.role = 'tab'
      button.textContent = item
      button.className = TAB_CLASS
      button.toggleAttribute('data-on', item === current())
      button.addEventListener('click', () => {
        if (item === current()) return
        set(item)
        for (const node of root.children) (node as HTMLElement).toggleAttribute('data-on', node.textContent === item)
      })
      return button
    }),
  )
}

const paintDebug = () => {
  const sections = el.shadowRoot?.querySelectorAll<HTMLElement>('.section')
  if (!sections) return
  const colors = ['red', 'green', 'blue']
  let i = 0
  for (const section of sections) {
    section.style.outline = debug ? `1px solid ${colors[i++ % colors.length]}` : 'none'
    section.style.outlineOffset = '-1px'
  }
}

const paintAlign = () => {
  stage.style.justifyContent = ALIGN[align]
  drift?.cancel()
  drift = null
  if (align !== 'dynamic') return
  drift = el.animate(
    { transform: ['translateX(-100%)', 'translateX(100%)', 'translateX(-100%)'] },
    { duration: 5000, easing: 'linear', fill: 'forwards', iterations: Infinity },
  )
}

for (const [label, value] of Object.entries(MODES)) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = MODE_CLASS
  button.textContent = label
  button.addEventListener('click', () => {
    variants = value
    variantsInput.value = value
    index = 0
    apply(false)
    paintDebug()
  })
  document.querySelector('#modes')!.append(button)
}

variantsInput.value = variants
variantsInput.addEventListener('input', () => {
  variants = variantsInput.value
  index = 0
  apply(false)
})

tabs(document.querySelector('#align')!, Object.keys(ALIGN), () => align, (value) => {
  align = value
  paintAlign()
})
tabs(document.querySelector('#trend')!, Object.keys(TREND), () => trend, (value) => {
  trend = value as keyof typeof TREND
  apply(false)
})
tabs(document.querySelector('#easing')!, Object.keys(EASING), () => easing, (value) => {
  easing = value as keyof typeof EASING
  apply(false)
})
tabs(document.querySelector('#slow')!, ['off', 'on'], () => (slow ? 'on' : 'off'), (value) => {
  slow = value === 'on'
  apply(false)
})
tabs(document.querySelector('#debug')!, ['off', 'on'], () => (debug ? 'on' : 'off'), (value) => {
  debug = value === 'on'
  paintDebug()
})

stage.addEventListener('click', () => {
  index += 1
  apply(true)
  for (const anim of el.getAnimations()) anim.cancel()
  paintDebug()
  hint.classList.add('opacity-0', 'transition-opacity', 'duration-100', 'ease-out')
})

document.querySelector('#flow-sentence')!.addEventListener('click', () => {
  flowAIndex = (flowAIndex + 1) % FLOW_A.length
  paint(flowA, FLOW_A[flowAIndex], true)
})
flowWrap.addEventListener('click', () => {
  const play = flipWrap(flowWrap)
  flowBIndex = (flowBIndex + 1) % FLOW_B.length
  paint(flowB, FLOW_B[flowBIndex], true)
  play()
})

wordify(flowWrap)
bindThemeToggle(document.querySelector('#theme')!)
apply(false)
paintAlign()
