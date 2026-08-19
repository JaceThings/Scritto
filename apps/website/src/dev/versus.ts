import '@scritto/core'
import type { Scritto } from '@scritto/core'
// Both engines read their own copy of these. A comparison is only worth
// anything if the knobs land on both, so every one of them is written twice.
import { CONFIG } from '../../../../packages/core/src/const'
import { createSlider } from '../components/slider'
import { bindCorners } from '../lib/corners'
import '../vendor/numeric-text'
import { CONFIG as UPSTREAM_CONFIG } from '../vendor/numeric-text/const'

type RollOptions = {
  respectMotionPreference?: boolean
  transition?: { duration: number }
}

type Rollable = HTMLElement & {
  update: (value: string, animate?: boolean) => void
  setOptions: (options: RollOptions) => void
}

const page = document.querySelector<HTMLElement>('[data-focus-section="versus"]')!
const find = <T extends HTMLElement>(role: string) => page.querySelector<T>(`[data-role="${role}"]`)!

const up = page.querySelector<Rollable>('#up')!
const fork = page.querySelector<Scritto>('#fk')!
const both: Rollable[] = [up, fork]

const groupCheck = find<HTMLInputElement>('group')
const runningCheck = find<HTMLInputElement>('running')
const freezeButton = find<HTMLButtonElement>('freeze')
const tickButton = find<HTMLButtonElement>('tick')
const count = find('count')

let value = 0
let timer = 0
const format = (n: number) => (groupCheck.checked ? n.toLocaleString('en-US') : String(n))

/**
 * A document's animations stop at the shadow boundary, so a roll's glyphs are
 * only reachable through the root that holds them.
 */
const animationsOf = (host: Rollable) => host.shadowRoot?.getAnimations() ?? []

/** What is frozen, and where each one stood at the moment it was caught. */
let held: { animation: Animation; at: number }[] = []

const tick = () => {
  value += step.value
  if (value > 999_999) value = 0
  const text = format(value)
  for (const host of both) {
    host.setOptions({ respectMotionPreference: false, transition: { duration: duration.value } })
    host.update(text, true)
  }
}

const restart = () => {
  window.clearInterval(timer)
  if (runningCheck.checked && !held.length) timer = window.setInterval(tick, interval.value)
}

/**
 * Everything on screen is caught where it stands, not rewound to a shared zero:
 * at this cadence a dozen rolls are in flight at different ages, and that spread
 * is the thing worth looking at. Scrub then walks the whole scene together.
 */
const freeze = () => {
  window.clearInterval(timer)
  held = both.flatMap((host) =>
    animationsOf(host).map((animation) => {
      animation.pause()
      return { animation, at: Number(animation.currentTime ?? 0) }
    }),
  )
  freezeButton.textContent = 'Release'
  scrub.set(0)
  report()
}

const release = () => {
  for (const { animation } of held) animation.play()
  held = []
  freezeButton.textContent = 'Freeze'
  report()
  restart()
}

/**
 * Forward only. Backward cannot be honest: a glyph that already finished was
 * released, and rewinding cannot bring it back, so the two sides would show
 * different pasts of the same value.
 */
const shift = (ms: number) => {
  for (const { animation, at } of held) animation.currentTime = at + ms
}

/**
 * Glyphs stacked in one slot is the whole question, so it is counted rather
 * than eyeballed: ink still on screen, grouped by where it sits.
 */
const report = () => {
  if (!held.length) {
    count.textContent = ''
    return
  }
  const tally = both.map((host) => {
    const slots = new Map<number, number>()
    for (const char of host.shadowRoot?.querySelectorAll<HTMLElement>('.char') ?? []) {
      if (Number.parseFloat(getComputedStyle(char).opacity) < 0.05) continue
      const rect = char.getBoundingClientRect()
      if (!rect.width) continue
      const slot = Math.round(rect.left / Math.max(1, rect.width))
      slots.set(slot, (slots.get(slot) ?? 0) + 1)
    }
    const deepest = Math.max(0, ...slots.values())
    const inked = [...slots.values()].reduce((sum, n) => sum + n, 0)
    return `${inked} glyphs, deepest slot ${deepest}`
  })
  count.textContent = `upstream: ${tally[0]}  ·  fork: ${tally[1]}`
}

const scrub = createSlider(find('scrub'), {
  label: 'Scrub forward (frozen)',
  value: 0,
  min: 0,
  max: 1600,
  step: 10,
  format: (v) => `+${v}ms`,
  onChange: (v) => {
    if (!held.length) return
    shift(v)
    report()
  },
})
const interval = createSlider(find('interval'), {
  label: 'Interval',
  value: 90,
  min: 20,
  max: 2000,
  step: 10,
  format: (v) => `${v}ms`,
  onChange: () => restart(),
})
const step = createSlider(find('step'), {
  label: 'Step',
  value: 7,
  min: 1,
  max: 5000,
  step: 1,
  format: (v) => `+${v}`,
  onChange: () => {},
})
const duration = createSlider(find('duration'), {
  label: 'Roll duration',
  value: 590,
  min: 80,
  max: 1600,
  step: 10,
  format: (v) => `${v}ms`,
  onChange: () => {},
})

type Knob = 'stagger' | 'blur' | 'y' | 'scale' | 'rotate'

const pair = (
  label: string,
  role: string,
  key: Knob,
  scale: number,
  min: number,
  max: number,
  step: number,
  format: (v: number) => string,
) =>
  createSlider(find(role), {
    label,
    value: Math.round(CONFIG[key] * scale),
    min,
    max,
    step,
    format,
    onChange: (v) => {
      CONFIG[key] = v / scale
      UPSTREAM_CONFIG[key] = v / scale
    },
  })

pair('Stagger', 'stagger', 'stagger', 100, 0, 100, 1, (v) => (v / 100).toFixed(2))
pair('Blur', 'blur', 'blur', 1000, 0, 1000, 5, (v) => `${(v / 1000).toFixed(3)}em`)
pair('Travel', 'travel', 'y', 100, 0, 150, 1, (v) => `${(v / 100).toFixed(2)}em`)
pair('Scale', 'scale', 'scale', 100, 10, 160, 1, (v) => (v / 100).toFixed(2))
pair('Rotate', 'rotate', 'rotate', 1, -30, 30, 1, (v) => `${v}°`)

freezeButton.addEventListener('click', () => (held.length ? release() : freeze()))
tickButton.addEventListener('click', () => {
  const wasFrozen = held.length > 0
  if (wasFrozen) release()
  window.clearInterval(timer)
  tick()
  if (wasFrozen || !runningCheck.checked) requestAnimationFrame(() => requestAnimationFrame(freeze))
  else restart()
})
groupCheck.addEventListener('change', () => {
  for (const host of both) host.update(format(value), false)
})
runningCheck.addEventListener('change', restart)

for (const host of both) {
  host.setOptions({ respectMotionPreference: false })
  host.update(format(value), false)
}
restart()

bindCorners(document)
