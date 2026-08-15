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

const TREND: Record<string, Trend> = { up: 1, auto: 0, down: -1 }
const FLOW_A = ['104', '1.3']
const FLOW_B = ['1,234,567', '12']

const el = document.querySelector<NumericText>('#test')!
const flowA = document.querySelector<NumericText>('#flow-a')!
const flowB = document.querySelector<NumericText>('#flow-b')!
const stage = document.querySelector<HTMLButtonElement>('#stage')!
const driftEl = document.querySelector<HTMLElement>('#stage-drift')!
const hint = document.querySelector<HTMLElement>('#hint')!
const variantsInput = document.querySelector<HTMLInputElement>('#variants')!

let variants: string = MODES.Text
let index = 0
let flowAIndex = 0
let flowBIndex = 0
let align = 'center'
let trend: keyof typeof TREND = 'auto'
let slow = false
let debug = false
let drift: Animation | null = null

const parts = () => variants.split('|').map((part) => part.trim()).filter(Boolean)

const options = () => ({
  trend: TREND[trend],
  respectMotionPreference: false,
  transition: { duration: slow ? 1100 : 550 },
})

const paint = (node: NumericText, value: string, animate: boolean) => {
  node.setOptions(options())
  node.update(value, animate)
  node.setAttribute('aria-label', value)
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
  drift?.cancel()
  drift = null
  driftEl.style.position = ''
  driftEl.style.top = ''
  driftEl.style.left = ''
  driftEl.style.transform = ''
  if (align !== 'dynamic') {
    stage.style.justifyContent = ALIGN[align]
    return
  }
  stage.style.justifyContent = 'flex-start'
  driftEl.style.position = 'absolute'
  driftEl.style.top = '50%'
  drift = driftEl.animate(
    {
      left: ['1rem', 'calc(100% - 1rem)', '1rem'],
      transform: ['translate(0, -50%)', 'translate(-100%, -50%)', 'translate(0, -50%)'],
    },
    { duration: 5000, easing: 'linear', iterations: Infinity },
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
  paintDebug()
  hint.classList.add('opacity-0', 'transition-opacity', 'duration-100', 'ease-out')
})

document.querySelector('#flow-sentence')!.addEventListener('click', () => {
  flowAIndex = (flowAIndex + 1) % FLOW_A.length
  paint(flowA, FLOW_A[flowAIndex], true)
})
document.querySelector('#flow-wrap')!.addEventListener('click', () => {
  flowBIndex = (flowBIndex + 1) % FLOW_B.length
  paint(flowB, FLOW_B[flowBIndex], true)
})

bindThemeToggle(document.querySelector('#theme')!)
apply(false)
paintAlign()
