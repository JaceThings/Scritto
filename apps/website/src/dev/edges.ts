import '@scritto/core'
import type { Scritto } from '@scritto/core'

/**
 * A case is a name, a note, and a source of values. `every` is how often it
 * changes on its own; 0 leaves it to the Step button. `hosts` above 1 puts
 * several on one line so they fight over the same row.
 */
type Case = {
  name: string
  note: string
  next: (tick: number) => string
  every: number
  hosts?: number
  flow?: boolean
  width?: string
  duration?: number
  bounce?: boolean
}

const cycle =
  (...values: string[]) =>
  (tick: number) =>
    values[tick % values.length]

const randomDigits = (tick: number) => {
  const digits = 1 + ((tick * 7) % 6)
  let out = ''
  for (let i = 0; i < digits; i++) out += String((tick * 13 + i * 7) % 10)
  return Number(out).toLocaleString('en-US')
}

/** Widest and narrowest this font stack renders: 260px against 10px at 40px Inter. */
const WIDE = ['i', '﷽', 'W', '𒐫', 'l', '⸻', 'ဪ']

const LONG = 'the quick brown fox jumps over the lazy dog and keeps going'

const CASES: Case[] = [
  {
    name: 'widest against narrowest',
    note: 'U+FDFD is 26x the width of an i. Every step is a box resize mid-roll.',
    next: cycle(...WIDE),
    every: 700,
  },
  {
    name: 'width, never settling',
    note: 'A new width every 90ms against a 590ms roll: the transition is always being re-aimed.',
    next: (tick) => WIDE[tick % WIDE.length].repeat(1 + (tick % 3)),
    every: 90,
    duration: 590,
  },
  {
    name: 'digits crossing a group',
    note: '999 to 1,000 adds a comma and a slot at once, and the kept run is on the wrong side.',
    next: cycle('999', '1,000', '9,999', '10,000', '999,999', '1,000,000', '999'),
    every: 620,
  },
  {
    name: 'counting, forever, fast',
    note: 'Faster than a frame at 16ms, so most values are never painted at all.',
    next: randomDigits,
    every: 16,
    duration: 400,
  },
  {
    name: 'sign flips',
    note: 'The minus arrives and leaves at the front, where nothing is kept before it.',
    next: cycle('5', '-5', '5', '-12', '12', '-0', '0'),
    every: 540,
  },
  {
    name: 'decimals appearing',
    note: 'A dot and a tail arrive on the end of a kept run.',
    next: cycle('1', '1.0', '1.00', '0.999', '1', '0.1', '10.01'),
    every: 560,
  },
  {
    name: 'empty and back',
    note: 'Nothing to roll from, then nothing to roll to. The box has no content to measure.',
    next: cycle('', 'Loading', '', '1', '', 'Done'),
    every: 640,
  },
  {
    name: 'whitespace only',
    note: 'Spaces hold slots but have no ink, and a run of them is invisible either way.',
    next: cycle('a b', 'a  b', ' a b ', 'a   b', 'ab'),
    every: 600,
  },
  {
    name: 'emoji, joined',
    note: 'ZWJ sequences are one grapheme made of many code points; splitting one makes nonsense.',
    next: cycle('👨‍👩‍👧‍👦', '👩‍💻', '🏳️‍🌈', '👨‍👩‍👧', '🧑‍🚀'),
    every: 660,
  },
  {
    name: 'skin tones',
    note: 'A modifier that changes the glyph without changing its length in graphemes.',
    next: cycle('👋', '👋🏻', '👋🏽', '👋🏿', '👋'),
    every: 580,
  },
  {
    name: 'combining marks',
    note: 'Marks stack onto the letter before them, so a split lands them on the wrong base.',
    next: cycle('e', 'é', 'ẹ́', 'ẹ́̄', 'ë', 'e'),
    every: 600,
  },
  {
    name: 'right to left',
    note: 'The row runs the other way, so start and end swap and the box grows leftward.',
    next: cycle('٣', '٤٥', '١٢٣', '١٬٢٣٤', '٥', 'مرحبا'),
    every: 640,
  },
  {
    name: 'mixed scripts',
    note: 'Latin digits with a CJK suffix: one script per side of the same kept run.',
    next: cycle('12 個', '1,234 個', '5 個', '99,999 個', '1 個'),
    every: 620,
  },
  {
    name: 'thai and devanagari',
    note: 'Vowels that sit above and below, and clusters that reorder when they combine.',
    next: cycle('๑๒๓', 'ก็็็็็', 'क्ष्ण', 'हिन्दी', '๛'),
    every: 680,
  },
  {
    name: 'long against short',
    note: 'Sixty characters down to one and back, in a card too narrow for either.',
    next: cycle(LONG, 'x', LONG.slice(0, 20), 'y', LONG),
    every: 900,
    width: 'text-sm',
  },
  {
    name: 'kept on both sides',
    note: 'A prefix and a suffix survive while the middle changes, so both runs have to hold.',
    next: (tick) => `$${randomDigits(tick)}.${String(tick % 100).padStart(2, '0')} USD`,
    every: 520,
  },
  {
    name: 'in running copy',
    note: 'Inside a flow, in a paragraph, where a resize pushes the words after it.',
    next: cycle('1', '1,000', '10', '100,000', '2', '999,999'),
    every: 700,
    flow: true,
  },
  {
    name: 'three on a line',
    note: 'Neighbours resizing at once, each one moving the next along the row.',
    next: randomDigits,
    every: 260,
    hosts: 3,
  },
  {
    name: 'bounce, long roll',
    note: 'An overshooting spring over 1.4s, so a change always lands mid-overshoot.',
    next: randomDigits,
    every: 400,
    duration: 1400,
    bounce: true,
  },
  {
    name: 'one frame apart',
    note: 'Two changes 8ms apart, then quiet: the second lands before the first has painted.',
    next: randomDigits,
    every: 8,
    duration: 300,
  },
]

/** The inline styles and attributes a transition wears, which it must take off. */
const DRESS = ['display', 'width', 'text-indent', 'margin-inline-end', 'flex-shrink', 'text-align'] as const

const cards = document.querySelector('#cards')!
const transport = document.querySelector('#transport')!
const crash = document.querySelector<HTMLElement>('[data-role="crash"]')!
const tally = document.querySelector<HTMLElement>('[data-role="tally"]')!

type Live = {
  spec: Case
  hosts: Scritto[]
  dot: HTMLElement
  fault: HTMLElement
  count: HTMLElement
  tick: number
  ticks: number
  due: number
  want: string
  faults: number
}

const live: Live[] = []
let running = true
let storming = 0

for (const spec of CASES) {
  const card = document.createElement('section')
  card.className = 'rounded-xl border border-line p-3'
  card.innerHTML = `
    <div class="flex items-start justify-between gap-2">
      <div class="text-sm font-medium">${spec.name}</div>
      <div class="flex shrink-0 items-center gap-1.5">
        <span class="text-[11px] tabular-nums text-muted" data-role="count">0</span>
        <span class="inline-block h-2.5 w-2.5 rounded-full bg-muted" data-role="dot"></span>
      </div>
    </div>
    <p class="mt-1 text-[12px] leading-snug text-muted">${spec.note}</p>
    <div class="mt-2 min-h-14 overflow-hidden rounded-lg bg-surface p-2 ${spec.width ?? 'text-2xl'}" data-role="stage"></div>
    <p class="mt-1 hidden text-[11px] leading-snug text-red-500" data-role="fault"></p>`
  cards.append(card)

  const stage = card.querySelector<HTMLElement>('[data-role="stage"]')!
  const hosts: Scritto[] = []
  const make = () => {
    const host = document.createElement('scritto-text')
    host.setOptions({
      respectMotionPreference: false,
      bounce: spec.bounce ?? false,
      transition: { duration: spec.duration ?? 550 },
    })
    hosts.push(host)
    return host
  }

  if (spec.flow) {
    const flow = document.createElement('scritto-flow')
    flow.append('Now serving ', make(), ' people in the queue today.')
    stage.append(flow)
  } else if (spec.hosts && spec.hosts > 1) {
    for (let i = 0; i < spec.hosts; i++) {
      stage.append(make())
      if (i < spec.hosts - 1) stage.append(' · ')
    }
  } else {
    stage.append(make())
  }

  const entry: Live = {
    spec,
    hosts,
    dot: card.querySelector<HTMLElement>('[data-role="dot"]')!,
    fault: card.querySelector<HTMLElement>('[data-role="fault"]')!,
    count: card.querySelector<HTMLElement>('[data-role="count"]')!,
    tick: 0,
    ticks: 0,
    due: performance.now() + Math.random() * 400,
    want: '',
    faults: 0,
  }
  live.push(entry)
  entry.want = spec.next(0)
  for (const host of hosts) host.update(entry.want, false)
}

const blame = (entry: Live, detail: string) => {
  entry.faults++
  entry.dot.className = 'inline-block h-2.5 w-2.5 rounded-full bg-red-500'
  entry.fault.classList.remove('hidden')
  entry.fault.textContent = `${entry.faults}× ${detail}`
}

/**
 * Only worth asking once a card is idle: mid-roll the host is meant to be
 * wearing a width and the ink is meant to be outside the value's own box.
 */
const audit = (entry: Live) => {
  for (let index = 0; index < entry.hosts.length; index++) {
    const host = entry.hosts[index]
    if ((host.shadowRoot?.getAnimations() ?? []).length) return
    if (!index && host.value !== entry.want) {
      blame(entry, `settled on ${JSON.stringify(host.value)}, was handed ${JSON.stringify(entry.want)}`)
      return
    }
    for (const prop of DRESS) {
      const left = host.style.getPropertyValue(prop)
      if (left) {
        blame(entry, `left ${prop}: ${left} on the host`)
        return
      }
    }
    if (host.hasAttribute('data-shrink-clip')) {
      blame(entry, 'left data-shrink-clip on the host')
      return
    }
    // Against the host's own box, not the card's: a long value with nowrap is
    // meant to run past a narrow card, but no glyph is ever meant to settle
    // outside the box the value is measured to occupy.
    const bounds = host.getBoundingClientRect()
    const slack = Number.parseFloat(getComputedStyle(host).fontSize) * 0.5 || 8
    for (const glyph of host.shadowRoot?.querySelectorAll<HTMLElement>('.char') ?? []) {
      const box = glyph.getBoundingClientRect()
      if (!box.width) continue
      if (box.right < bounds.left - slack || box.left > bounds.right + slack) {
        blame(entry, `a glyph settled ${Math.round(box.left - bounds.right)}px outside the value's own box`)
        return
      }
    }
  }
}

let lastAudit = 0
const frame = (now: number) => {
  if (running) {
    for (const entry of live) {
      const every = storming ? Math.max(16, entry.spec.every || 120) : entry.spec.every
      if (!every || now < entry.due) continue
      entry.due = now + every
      entry.tick++
      entry.ticks++
      entry.want = entry.spec.next(entry.tick)
      for (let i = 0; i < entry.hosts.length; i++) {
        entry.hosts[i].update(i ? entry.spec.next(entry.tick * 3 + i) : entry.want, true)
      }
    }
  }
  if (now - lastAudit > 400) {
    lastAudit = now
    let faults = 0
    let ticks = 0
    for (const entry of live) {
      audit(entry)
      entry.count.textContent = String(entry.ticks)
      faults += entry.faults
      ticks += entry.ticks
    }
    tally.textContent = `${live.length} cards · ${ticks.toLocaleString('en-US')} changes · ${faults ? `${faults} caught` : 'nothing caught'}`
  }
  if (storming && now > storming) {
    storming = 0
    const button = transport.querySelector<HTMLButtonElement>('button[data-role="storm"]')
    if (button) button.textContent = 'Storm: 10s of everything at once'
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
      entry.want = entry.spec.next(entry.tick)
      for (let i = 0; i < entry.hosts.length; i++) {
        entry.hosts[i].update(i ? entry.spec.next(entry.tick * 3 + i) : entry.want, true)
      }
    }
  }
  if (role === 'storm') {
    storming = performance.now() + 10_000
    running = true
    button.textContent = 'Storming…'
  }
  if (role === 'reset') {
    for (const entry of live) {
      entry.faults = 0
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
