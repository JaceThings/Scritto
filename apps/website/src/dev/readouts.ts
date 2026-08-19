import '@scritto/core'
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

bindCorners(document)
