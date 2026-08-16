import type { Scritto } from '@scritto/core'
import '@scritto/core'
import './styles.css'
import { bindThemeToggle } from './theme'

const TAB_CLASS =
  'relative cursor-pointer border-0 bg-transparent p-0 font-[inherit] opacity-40 transition-opacity duration-200 ease-out hover:opacity-65 data-[on]:opacity-100 data-[on]:hover:opacity-100'

const VALUES = ['1', '1,234,567', '12', '999,999']
const SIZES = { '40': 40, '200': 200, '2k': 2000, '5k': 5000, '20k': 20000 } as const
const LEX =
  'the collector logged tokens across every running job in the queue this cycle just enough extra width that a few words drop and climb back once the figure shrinks to a short tally'.split(
    ' ',
  )

const paragraph = document.querySelector<HTMLElement>('#paragraph')!
const lines = document.querySelector<HTMLElement>('#lines')!

let size: keyof typeof SIZES = '200'
let bounce = false
let index = 0
const hosts: Scritto[] = []

const makeHost = () => {
  const el = document.createElement('scritto-text')
  el.className = 'align-baseline font-semibold'
  el.setOptions({ bounce, respectMotionPreference: false })
  el.update(VALUES[index], false)
  return el
}

const wordsAround = (n: number, host: Node) => {
  const at = Math.floor(n / 3)
  const chunk = (start: number, count: number) =>
    Array.from({ length: count }, (_, i) => LEX[(start + i) % LEX.length]).join(' ')
  const frag = document.createDocumentFragment()
  frag.append(chunk(0, at), ' ', host, ' ', chunk(at, n - at))
  return frag
}

const flowOf = (child: Node) => {
  const flow = document.createElement('scritto-flow')
  flow.className = 'block w-full'
  const p = document.createElement('p')
  p.className = 'm-0'
  p.append(child)
  flow.append(p)
  return flow
}

const paint = (animate: boolean) => {
  const value = VALUES[index]
  for (const host of hosts) {
    host.setOptions({ bounce, respectMotionPreference: false })
    host.update(value, animate)
    host.setAttribute('aria-label', value)
  }
}

const mount = () => {
  hosts.length = 0
  const main = makeHost()
  hosts.push(main)
  const stage = document.createElement('div')
  stage.className = 'max-h-80 overflow-auto'
  stage.append(flowOf(wordsAround(SIZES[size], main)))
  paragraph.replaceChildren(stage)

  const frag = document.createDocumentFragment()
  for (let i = 0; i < 8; i++) {
    const host = makeHost()
    hosts.push(host)
    frag.append(flowOf(wordsAround(36, host)))
  }
  lines.replaceChildren(frag)
  paint(false)
}

const tabs = <T extends string>(root: HTMLElement, items: readonly T[], current: () => T, set: (value: T) => void) => {
  root.replaceChildren(
    ...items.map((item) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.role = 'tab'
      button.textContent = item
      button.className = TAB_CLASS
      button.toggleAttribute('data-on', item === current())
      button.addEventListener('click', (event) => {
        event.stopPropagation()
        if (item === current()) return
        set(item)
        for (const node of root.children) {
          if (node instanceof HTMLElement) node.toggleAttribute('data-on', node.textContent === item)
        }
      })
      return button
    }),
  )
}

const swap = () => {
  index = (index + 1) % VALUES.length
  paint(true)
}

tabs(document.querySelector('#words')!, ['40', '200', '2k', '5k', '20k'], () => size, (value) => {
  size = value
  mount()
})
tabs(document.querySelector('#bounce')!, ['off', 'on'], () => (bounce ? 'on' : 'off'), (value) => {
  bounce = value === 'on'
  paint(false)
})

paragraph.addEventListener('click', swap)
lines.addEventListener('click', swap)
bindThemeToggle(document.querySelector('#theme')!)
mount()
