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

const label = (text: string) => el('span', 'text-[14px] font-medium tracking-[-0.25px] text-text-secondary', text)

const BOX = 'whitespace-nowrap rounded-xl border border-hairline px-4 py-2'

const CHEESE = ['Cheese', 'Cheese cuts', 'Brie', 'A whole cheese board', 'Chèvre']

const CASES: Case[] = [
  {
    name: 'Card, fit-content',
    note: 'A block card with width: fit-content. The border should ride the roll, both ways.',
    values: CHEESE,
    build: (host) => el('div', `w-fit ${BOX}`, host),
    every: 3200,
  },
  {
    name: 'Pill',
    note: 'An inline pill hugging a status word. The classic label that grows and shrinks.',
    values: ['Idle', 'Recording', 'On air', 'Rendering frames', 'Done'],
    build: (host) => el('span', 'inline-flex whitespace-nowrap rounded-full border border-hairline px-5 py-2', host),
    every: 3600,
  },
  {
    name: 'A row with neighbours',
    note: 'A label either side in one fit-content row: the right-hand one must be pushed, not overlapped.',
    values: ['€4.50', '€1,250.00', '€12', '€89,900.00'],
    build: (host) =>
      el('div', `flex w-fit items-baseline gap-2 ${BOX}`, label('total'), host, label('this month')),
    every: 3400,
  },
  {
    name: 'Centred, both edges move',
    note: 'fit-content with auto margins in a full-width lane, so each resize moves both edges at once.',
    values: ['Gouda', 'Smoked gouda, extra aged', 'Edam'],
    build: (host) => {
      const inner = el('div', `mx-auto w-fit ${BOX}`, host)
      inner.dataset.hug = ''
      return el('div', 'w-full', inner)
    },
    every: 4000,
  },
  {
    name: 'Overflow hidden, a gutter of padding',
    note: 'Clipping is allowed to exist — it just must never reach the value. 16px keeps ghosts inside.',
    values: ['i', '﷽', 'W', '𒐫', 'l'],
    build: (host) => el('div', `w-fit overflow-hidden ${BOX}`, host),
    every: 3800,
  },
  {
    name: 'Nested, hug inside hug',
    note: 'fit-content inside fit-content: the resize has to propagate through two layers of shrink-wrap.',
    values: CHEESE,
    build: (host) => {
      const inner = el('div', 'w-fit whitespace-nowrap rounded-lg border border-hairline px-3 py-1', host)
      inner.dataset.hug = ''
      return el('div', 'w-fit rounded-xl border border-hairline p-2', inner)
    },
    every: 4200,
  },
  {
    name: 'Fixed width — the failure',
    note: 'What going wrong looks like: a box that cannot follow, so the value clips at its edge.',
    values: CHEESE,
    build: (host) => el('div', `w-44 overflow-hidden ${BOX}`, host),
    every: 3200,
    audited: false,
  },
]

const page = document.querySelector('#page')!
const crash = document.querySelector<HTMLElement>('[data-role="crash"]')!

type Live = {
  spec: Case
  host: Scritto
  hugs: HTMLElement[]
  status: HTMLElement
  tick: number
  ticks: number
  due: number
  worst: number
  faults: number
  fault: string
}

const live: Live[] = []

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
  const gap = Number.parseFloat(getComputedStyle(box).columnGap) || 0
  let sum = 0
  let count = 0
  for (const child of box.children) {
    sum += layoutWidth(child)
    count++
  }
  return sum + gap * Math.max(count - 1, 0)
}

for (const [index, spec] of CASES.entries()) {
  const section = el('section', 'stagger flex w-full flex-col gap-4')
  section.style.setProperty('--i', String(index + 1))
  section.innerHTML = `
    <div class="flex w-full flex-col gap-3 px-1 text-text-primary">
      <h2 class="text-[16px] leading-none font-[550] tracking-[-0.25px]">${spec.name}</h2>
      <p class="text-[14px] leading-[1.4] font-medium tracking-[-0.25px]">${spec.note}</p>
    </div>
    <div class="figure">
      <button class="stage" type="button" aria-label="Advance the value" data-role="stage"></button>
      <div class="row justify-between px-4 py-3">
        <span class="text-[13px] font-medium tracking-[-0.25px] tabular-nums text-text-secondary" data-role="status"></span>
        <span class="inline-block h-2 w-2 rounded-full bg-hairline" data-role="dot"></span>
      </div>
    </div>`
  page.append(section)

  const host = document.createElement('scritto-text')
  host.className = 'text-[28px] leading-none font-[550] tracking-[-0.25px]'
  host.setOptions({ respectMotionPreference: false, transition: { duration: spec.duration ?? 590 } })
  const built = spec.build(host)
  if (spec.audited !== false && !built.querySelector('[data-hug]') && !('hug' in built.dataset)) {
    built.dataset.hug = ''
  }
  const stage = section.querySelector<HTMLElement>('[data-role="stage"]')!
  stage.append(built)

  const entry: Live = {
    spec,
    host,
    hugs: spec.audited === false ? [] : [...section.querySelectorAll<HTMLElement>('[data-hug]')],
    status: section.querySelector<HTMLElement>('[data-role="status"]')!,
    tick: 0,
    ticks: 0,
    due: performance.now() + 1200 + index * 500,
    worst: 0,
    faults: 0,
    fault: '',
  }
  live.push(entry)
  host.update(spec.values[0], false)

  stage.addEventListener('click', () => {
    entry.tick++
    entry.ticks++
    entry.host.update(entry.spec.values[entry.tick % entry.spec.values.length], true)
    entry.due = performance.now() + entry.spec.every
  })
}

const blame = (entry: Live, detail: string) => {
  entry.faults++
  entry.fault = detail
  const dot = entry.status.nextElementSibling
  if (dot) dot.className = 'inline-block h-2 w-2 rounded-full bg-red-500'
}

/** 2.5px absorbs subpixel border rounding; a real lag or clip measures in tens. */
const TOLERANCE = 2.5

const VISIBLE_ALPHA = 0.15

const blurOf = (glyph: Element) => {
  const match = /blur\((\d*\.?\d+)px\)/.exec(getComputedStyle(glyph).filter)
  return match ? Number.parseFloat(match[1]) : 0
}

/**
 * The check the layout-box one cannot make: a container can hug its child on
 * every frame and still have the ghosts that child abandoned hanging outside
 * it. A side wearing the edge fade cannot leak — the mask clips to the host's
 * border box and fades to nothing inside it, which pixel-diffing confirms.
 */
const auditInk = (entry: Live, box: HTMLElement) => {
  const host = entry.host
  const clip = host.getAttribute('data-shrink-clip')
  const rect = box.getBoundingClientRect()
  const css = getComputedStyle(box)
  const right =
    clip === '' || clip === 'end' || clip === 'both'
      ? Infinity
      : rect.right - (Number.parseFloat(css.borderRightWidth) || 0)
  const left =
    clip === 'start' || clip === 'both' ? -Infinity : rect.left + (Number.parseFloat(css.borderLeftWidth) || 0)
  for (const glyph of host.shadowRoot?.querySelectorAll<HTMLElement>('.char') ?? []) {
    const alpha = Number.parseFloat(getComputedStyle(glyph).opacity)
    const ink = glyph.getBoundingClientRect()
    if (alpha < VISIBLE_ALPHA || !ink.width || !(glyph.textContent ?? '').trim()) continue
    const spread = blurOf(glyph)
    const past = Math.max(left - ink.left + spread, ink.right + spread - right)
    if (past > entry.worst) entry.worst = past
    if (past > TOLERANCE) {
      blame(entry, `ink escaped by ${past.toFixed(1)}px at opacity ${alpha.toFixed(2)}`)
      return
    }
  }
}

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
    if (box.contains(entry.host)) auditInk(entry, box)
  }
}

let lastPaint = 0
const frame = (now: number) => {
  for (const entry of live) {
    if (now >= entry.due) {
      entry.due = now + entry.spec.every
      entry.tick++
      entry.ticks++
      entry.host.update(entry.spec.values[entry.tick % entry.spec.values.length], true)
    }
    audit(entry)
  }
  if (now - lastPaint > 400) {
    lastPaint = now
    for (const entry of live) {
      entry.status.textContent = entry.fault
        ? `${entry.faults}× ${entry.fault}`
        : entry.hugs.length
          ? `worst frame Δ ${entry.worst.toFixed(1)}px · ${entry.ticks} changes`
          : `not measured — this one is meant to clip · ${entry.ticks} changes`
    }
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

const shout = (what: string) => {
  crash.classList.remove('hidden')
  crash.className = 'w-full rounded-xl bg-red-500/10 px-4 py-3 text-[14px] font-medium text-red-500'
  crash.textContent = what
}
window.addEventListener('error', (event) => shout(`threw: ${event.message}`))
window.addEventListener('unhandledrejection', (event) => shout(`rejected: ${String(event.reason)}`))
