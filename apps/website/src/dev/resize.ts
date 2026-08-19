import '@scritto/core'
import type { Scritto } from '@scritto/core'

/**
 * Every element with `data-hug` claims: my content box is exactly my children,
 * on every frame of every roll. The audit measures that claim continuously —
 * during a width transition the host's layout box is its border box plus the
 * negative end margin the mask slack rides on, so the sum uses margins too.
 */
type Case = {
  name: string
  note: string
  values: string[]
  build: (host: Scritto) => HTMLElement
  every: number
  duration?: number
  audited?: boolean
}

const el = (tag: string, className: string, ...children: (Node | string)[]) => {
  const node = document.createElement(tag)
  node.className = className
  node.append(...children)
  return node
}

const span = (className: string, text: string) => el('span', className, text)

const CHEESE = ['Cheese', 'Cheese cuts', 'Brie', 'A whole cheese board', 'Chèvre']

const CASES: Case[] = [
  {
    name: 'card, fit-content',
    note: 'A block card with width: fit-content. The border should ride the roll, both ways.',
    values: CHEESE,
    build: (host) => el('div', 'w-fit whitespace-nowrap rounded-lg border border-line px-4 py-2', host),
    every: 1600,
  },
  {
    name: 'pill, inline-flex',
    note: 'An inline pill hugging a status word. The classic label that grows and shrinks.',
    values: ['Idle', 'Recording', 'On air', 'Rendering frames', 'Done'],
    build: (host) => el('span', 'inline-flex whitespace-nowrap rounded-full border border-line px-4 py-1', host),
    every: 1800,
  },
  {
    name: 'flex row with neighbours',
    note: 'A label either side in one fit-content row: the right-hand one must be pushed, not overlapped.',
    values: ['€4.50', '€1,250.00', '€12', '€89,900.00'],
    build: (host) =>
      el(
        'div',
        'flex w-fit items-baseline gap-2 whitespace-nowrap rounded-lg border border-line px-4 py-2',
        span('text-sm text-muted', 'total'),
        host,
        span('text-sm text-muted', 'this month'),
      ),
    every: 1700,
  },
  {
    name: 'centred, both edges move',
    note: 'fit-content with auto margins in a full-width lane, so each resize moves both edges at once.',
    values: ['Gouda', 'Smoked gouda, extra aged', 'Edam'],
    build: (host) => {
      const inner = el('div', 'mx-auto w-fit whitespace-nowrap rounded-lg border border-line px-4 py-2', host)
      inner.dataset.hug = ''
      return el('div', 'w-full', inner)
    },
    every: 2000,
  },
  {
    name: 'overflow hidden, a gutter of padding',
    note: 'Clipping is allowed to exist — it just must never reach the value. 16px keeps ghosts inside.',
    values: ['i', '﷽', 'W', '𒐫', 'l'],
    build: (host) => el('div', 'w-fit overflow-hidden whitespace-nowrap rounded-lg border border-line px-4 py-2', host),
    every: 1900,
  },
  {
    name: 'nested, hug inside hug',
    note: 'fit-content inside fit-content: the resize has to propagate through two layers of shrink-wrap.',
    values: CHEESE,
    build: (host) => {
      const inner = el('div', 'w-fit whitespace-nowrap rounded-md border border-line px-3 py-1', host)
      inner.dataset.hug = ''
      return el('div', 'w-fit rounded-lg border border-line p-2', inner)
    },
    every: 2100,
  },
  {
    name: 'fixed width (the failure)',
    note: 'What going wrong looks like: a box that cannot follow, so the value clips at its edge.',
    values: CHEESE,
    build: (host) => el('div', 'w-44 overflow-hidden whitespace-nowrap rounded-lg border border-line px-4 py-2', host),
    every: 1600,
    audited: false,
  },
]

const cards = document.querySelector('#cards')!
const transport = document.querySelector('#transport')!
const crash = document.querySelector<HTMLElement>('[data-role="crash"]')!
const tally = document.querySelector<HTMLElement>('[data-role="tally"]')!

type Live = {
  spec: Case
  host: Scritto
  hugs: HTMLElement[]
  dot: HTMLElement
  fault: HTMLElement
  delta: HTMLElement
  count: HTMLElement
  tick: number
  ticks: number
  due: number
  worst: number
  faults: number
}

const live: Live[] = []
let running = true

const layoutWidth = (node: Element) => {
  const css = getComputedStyle(node)
  return (
    node.getBoundingClientRect().width +
    (Number.parseFloat(css.marginInlineStart) || 0) +
    (Number.parseFloat(css.marginInlineEnd) || 0)
  )
}

const contentWidth = (box: HTMLElement) => {
  const css = getComputedStyle(box)
  return (
    box.getBoundingClientRect().width -
    (Number.parseFloat(css.paddingLeft) || 0) -
    (Number.parseFloat(css.paddingRight) || 0) -
    (Number.parseFloat(css.borderLeftWidth) || 0) -
    (Number.parseFloat(css.borderRightWidth) || 0)
  )
}

const childrenWidth = (box: HTMLElement) => {
  const css = getComputedStyle(box)
  const gap = Number.parseFloat(css.columnGap) || 0
  let sum = 0
  let count = 0
  for (const child of box.children) {
    sum += layoutWidth(child)
    count++
  }
  return sum + gap * Math.max(count - 1, 0)
}

for (const spec of CASES) {
  const card = document.createElement('section')
  card.className = 'cursor-pointer rounded-xl border border-line p-3'
  card.innerHTML = `
    <div class="flex items-start justify-between gap-2">
      <div class="text-sm font-medium">${spec.name}</div>
      <div class="flex shrink-0 items-center gap-1.5">
        <span class="text-[11px] tabular-nums text-muted" data-role="delta"></span>
        <span class="text-[11px] tabular-nums text-muted" data-role="count">0</span>
        <span class="inline-block h-2.5 w-2.5 rounded-full bg-muted" data-role="dot"></span>
      </div>
    </div>
    <p class="mt-1 text-[12px] leading-snug text-muted">${spec.note}</p>
    <div class="mt-2 min-h-16 rounded-lg bg-surface px-4 py-3 text-2xl" data-role="stage"></div>
    <p class="mt-1 hidden text-[11px] leading-snug text-red-500" data-role="fault"></p>`
  cards.append(card)

  const host = document.createElement('scritto-text')
  host.setOptions({ respectMotionPreference: false, transition: { duration: spec.duration ?? 590 } })
  const built = spec.build(host)
  if (spec.audited !== false && !built.querySelector('[data-hug]') && !('hug' in built.dataset)) {
    built.dataset.hug = ''
  }
  card.querySelector<HTMLElement>('[data-role="stage"]')!.append(built)

  const hugs = spec.audited === false ? [] : [...card.querySelectorAll<HTMLElement>('[data-hug]')]
  const entry: Live = {
    spec,
    host,
    hugs,
    dot: card.querySelector<HTMLElement>('[data-role="dot"]')!,
    fault: card.querySelector<HTMLElement>('[data-role="fault"]')!,
    delta: card.querySelector<HTMLElement>('[data-role="delta"]')!,
    count: card.querySelector<HTMLElement>('[data-role="count"]')!,
    tick: 0,
    ticks: 0,
    due: performance.now() + 600 + live.length * 260,
    worst: 0,
    faults: 0,
  }
  live.push(entry)
  host.update(spec.values[0], false)

  card.addEventListener('click', () => {
    entry.tick++
    entry.ticks++
    entry.host.update(entry.spec.values[entry.tick % entry.spec.values.length], true)
    entry.due = performance.now() + entry.spec.every
  })
}

const blame = (entry: Live, detail: string) => {
  entry.faults++
  entry.dot.className = 'inline-block h-2.5 w-2.5 rounded-full bg-red-500'
  entry.fault.classList.remove('hidden')
  entry.fault.textContent = `${entry.faults}× ${detail}`
}

/** 2.5px absorbs subpixel border rounding; a real lag or clip measures in tens. */
const TOLERANCE = 2.5

const audit = (entry: Live) => {
  for (const box of entry.hugs) {
    const inner = contentWidth(box)
    const kids = childrenWidth(box)
    const gap = Math.abs(inner - kids)
    if (gap > entry.worst) entry.worst = gap
    if (gap > TOLERANCE) {
      blame(entry, `container ${inner > kids ? 'lagging wide' : 'pinching'} by ${gap.toFixed(1)}px mid-roll`)
      return
    }
    const boxCss = getComputedStyle(box)
    const content = box.getBoundingClientRect()
    const left = content.left + (Number.parseFloat(boxCss.paddingLeft) || 0) + (Number.parseFloat(boxCss.borderLeftWidth) || 0)
    const right = content.right - (Number.parseFloat(boxCss.paddingRight) || 0) - (Number.parseFloat(boxCss.borderRightWidth) || 0)
    for (const child of box.children) {
      const rect = child.getBoundingClientRect()
      const end = rect.right + (Number.parseFloat(getComputedStyle(child).marginInlineEnd) || 0)
      if (rect.left < left - TOLERANCE || end > right + TOLERANCE) {
        blame(entry, `a child escaped the content box by ${Math.max(left - rect.left, end - right).toFixed(1)}px`)
        return
      }
    }
  }
}

let lastPaint = 0
const frame = (now: number) => {
  for (const entry of live) {
    if (running && entry.spec.every && now >= entry.due) {
      entry.due = now + entry.spec.every
      entry.tick++
      entry.ticks++
      entry.host.update(entry.spec.values[entry.tick % entry.spec.values.length], true)
    }
    audit(entry)
  }
  if (now - lastPaint > 400) {
    lastPaint = now
    let faults = 0
    let ticks = 0
    for (const entry of live) {
      entry.delta.textContent = entry.hugs.length ? `Δ ${entry.worst.toFixed(1)}px` : ''
      entry.count.textContent = String(entry.ticks)
      faults += entry.faults
      ticks += entry.ticks
    }
    tally.textContent = `${live.length} cards · ${ticks.toLocaleString('en-US')} changes · ${faults ? `${faults} caught` : 'nothing caught'}`
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

transport.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof HTMLElement)) return
  const button = target.closest<HTMLButtonElement>('button[data-role]')
  if (!button) return
  const role = button.dataset.role
  if (role === 'toggle') {
    running = !running
    button.textContent = running ? 'Pause all' : 'Run all'
  }
  if (role === 'step') {
    for (const entry of live) {
      entry.tick++
      entry.ticks++
      entry.host.update(entry.spec.values[entry.tick % entry.spec.values.length], true)
    }
  }
  if (role === 'reset') {
    for (const entry of live) {
      entry.faults = 0
      entry.worst = 0
      entry.dot.className = 'inline-block h-2.5 w-2.5 rounded-full bg-muted'
      entry.fault.classList.add('hidden')
    }
  }
})

const shout = (what: string) => {
  crash.classList.remove('hidden')
  crash.className = 'mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500'
  crash.textContent = what
}
window.addEventListener('error', (event) => shout(`threw: ${event.message}`))
window.addEventListener('unhandledrejection', (event) => shout(`rejected: ${String(event.reason)}`))
