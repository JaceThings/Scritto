import '@scritto/core'
import type { Scritto } from '@scritto/core'
// Same module the element itself reads: moving these sliders retunes the roll
// for every card on this page, itself included — they are the library's own
// global constants, not a copy taken for this demo.
import { CONFIG } from '../../../../packages/core/src/const'
import { READOUT, createSlider, type Readout } from '../components/slider'
import { bindCorners } from '../lib/corners'

type Variant = { name: string; note: string; readout: Partial<Readout> }

const VARIANTS: Variant[] = [
  { name: 'Every step, 300ms', note: 'What 0.1.4 does: every detent rolls, and a drag stacks a dozen of them.', readout: { duration: 300, pace: 0, hurry: false } },
  { name: 'Every step, hurried', note: 'Same, with the pile behind the newest value sped off.', readout: { duration: 300, pace: 0, hurry: true } },
  { name: 'Live under the finger', note: 'No roll while dragging; the number is just the number. Rolls on release and on every other change.', readout: { pace: Infinity } },
  { name: 'Paced 80ms, 160ms roll', note: 'Quick and busy. Rolls keep up with a fast drag.', readout: { duration: 160, pace: 80, hurry: true } },
  { name: 'Paced 120ms, 240ms roll', note: 'The site default. Each roll gets most of itself before the next lands.', readout: { duration: 240, pace: 120, hurry: true } },
  { name: 'Paced 150ms, 300ms roll', note: 'The full readout roll, one every 150ms. Skips more of the in-between values.', readout: { duration: 300, pace: 150, hurry: true } },
  { name: 'Paced 200ms, 400ms roll', note: 'Slow and deliberate; the number lags the finger by a beat.', readout: { duration: 400, pace: 200, hurry: true } },
]

const mount = document.querySelector<HTMLElement>('#readouts')!
const isDefault = (r: Partial<Readout>) => JSON.stringify({ ...READOUT, ...r }) === JSON.stringify(READOUT)

for (const variant of VARIANTS) {
  const card = document.createElement('section')
  card.className = 'flex w-full flex-col gap-3'
  card.innerHTML = `
    <div class="flex w-full flex-col gap-1 px-1 text-text-primary">
      <h2 class="text-[14px] leading-none font-[550] tracking-[-0.25px]">${variant.name}${isDefault(variant.readout) ? ' <span class="text-text-secondary font-medium">· default</span>' : ''}</h2>
      <p class="text-[13px] leading-[1.4] font-medium tracking-[-0.25px] text-text-secondary">${variant.note}</p>
    </div>
    <div class="figure" data-focus-section="readout">
      <div class="row row-slider"></div>
    </div>`
  mount.append(card)
  createSlider(card.querySelector<HTMLElement>('.row-slider')!, {
    label: 'Duration',
    value: 550,
    min: 120,
    max: 1600,
    step: 10,
    format: (value) => `${value}ms`,
    formatSeed: (value) => String(value),
    onChange: () => {},
    readout: variant.readout,
  })
}

/**
 * A counter that never stops, so the site's own default is a starting point
 * rather than a verdict. `interval` and `step` stand in for the drag you can't
 * script — how often a new value shows up, and how far it jumps — while the
 * roll's own shape sits underneath, live.
 */
const custom = document.createElement('section')
custom.className = 'flex w-full flex-col gap-3'
custom.innerHTML = `
  <div class="flex w-full flex-col gap-1 px-1 text-text-primary">
    <h2 class="text-[14px] leading-none font-[550] tracking-[-0.25px]">Custom</h2>
    <p class="text-[13px] leading-[1.4] font-medium tracking-[-0.25px] text-text-secondary">
      A number that never stops growing, so you can feel a fast readout and a slow one back
      to back. It wraps to zero past a million, which is the shrink case for free. These
      knobs are the roll's own settings, shared with every card above.
    </p>
  </div>
  <div class="figure" data-focus-section="custom">
    <div class="stage" style="cursor: default; height: 8rem">
      <scritto-text id="grow" class="text-[40px] leading-none font-[550] tracking-[-0.25px]" role="img"></scritto-text>
    </div>
    <div class="row row-slider" data-role="interval"></div>
    <div class="row row-slider" data-role="step"></div>
    <div class="row row-slider" data-role="duration"></div>
    <div class="row row-slider" data-role="stagger"></div>
    <div class="row row-slider" data-role="blur"></div>
    <div class="row row-slider" data-role="travel"></div>
    <div class="row row-slider" data-role="scale"></div>
    <div class="row row-slider" data-role="rotate"></div>
    <div class="row" style="padding: 16px; gap: 18px; flex-wrap: wrap">
      <label class="flex items-center gap-2 text-[13px] font-medium text-text-input">
        <input data-role="hurry" type="checkbox" checked /> Hurry
      </label>
      <label class="flex items-center gap-2 text-[13px] font-medium text-text-input">
        <input data-role="bounce" type="checkbox" /> Bounce
      </label>
      <label class="flex items-center gap-2 text-[13px] font-medium text-text-input">
        <input data-role="group" type="checkbox" checked /> Group digits
      </label>
      <label class="flex items-center gap-2 text-[13px] font-medium text-text-input">
        <input data-role="running" type="checkbox" checked /> Running
      </label>
    </div>
  </div>`
mount.append(custom)

const find = <T extends HTMLElement>(role: string) => custom.querySelector<T>(`[data-role="${role}"]`)!
const grow = custom.querySelector<Scritto>('#grow')!
const groupCheck = find<HTMLInputElement>('group')
const hurryCheck = find<HTMLInputElement>('hurry')
const bounceCheck = find<HTMLInputElement>('bounce')
const runningCheck = find<HTMLInputElement>('running')

let value = 0
const format = (n: number) => (groupCheck.checked ? n.toLocaleString('en-US') : String(n))

const interval = createSlider(find('interval'), {
  label: 'Interval',
  value: 600,
  min: 40,
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
  value: 400,
  min: 80,
  max: 1600,
  step: 10,
  format: (v) => `${v}ms`,
  onChange: () => {},
})
createSlider(find('stagger'), {
  label: 'Stagger',
  value: Math.round(CONFIG.stagger * 100),
  min: 0,
  max: 100,
  step: 1,
  format: (v) => (v / 100).toFixed(2),
  onChange: (v) => (CONFIG.stagger = v / 100),
})
createSlider(find('blur'), {
  label: 'Blur',
  value: Math.round(CONFIG.blur * 1000),
  min: 0,
  max: 1000,
  step: 5,
  format: (v) => `${(v / 1000).toFixed(3)}em`,
  onChange: (v) => (CONFIG.blur = v / 1000),
})
createSlider(find('travel'), {
  label: 'Travel',
  value: Math.round(CONFIG.y * 100),
  min: 0,
  max: 150,
  step: 1,
  format: (v) => `${(v / 100).toFixed(2)}em`,
  onChange: (v) => (CONFIG.y = v / 100),
})
createSlider(find('scale'), {
  label: 'Scale',
  value: Math.round(CONFIG.scale * 100),
  min: 10,
  max: 160,
  step: 1,
  format: (v) => (v / 100).toFixed(2),
  onChange: (v) => (CONFIG.scale = v / 100),
})
createSlider(find('rotate'), {
  label: 'Rotate',
  value: CONFIG.rotate,
  min: -30,
  max: 30,
  step: 1,
  format: (v) => `${v}°`,
  onChange: (v) => (CONFIG.rotate = v),
})

let timer = 0

const tick = () => {
  value += step.value
  if (value > 999_999) value = 0
  grow.setOptions({
    respectMotionPreference: false,
    hurry: hurryCheck.checked,
    bounce: bounceCheck.checked,
    transition: { duration: duration.value },
  })
  grow.update(format(value), true)
}

const restart = () => {
  window.clearInterval(timer)
  if (runningCheck.checked) timer = window.setInterval(tick, interval.value)
}

groupCheck.addEventListener('change', () => grow.update(format(value), false))
runningCheck.addEventListener('change', restart)

grow.setOptions({ respectMotionPreference: false })
grow.update(format(value), false)
restart()

bindCorners(document)
