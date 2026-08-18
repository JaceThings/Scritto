import '@scritto/core'
import type { Scritto, Trend } from '@scritto/core'
import { createHops } from '../components/hops'
import { createPills } from '../components/pills'
import { createSlider } from '../components/slider'
import { createStage } from '../components/stage'
import { startLightTicker } from '../components/ticker'
import { bindCorners } from '../lib/corners'
import { same } from '../lib/list'
import { STATE_CHANGE_EASE, STATE_CHANGE_MS } from '../lib/motion'
import { BOUNCE_BOUNCY, BOUNCE_DEFAULT, springEasing } from '../lib/spring'

const PRESETS = {
  Words: ['Creative', 'Create', 'Code', 'Code editor', 'Creator'],
  Numbers: ['24', '-20', '10', '5', '$2.5', '$2'],
  Emoji: ['Hello 👋', 'Hola 👋', 'Hey 👋'],
} as const

type Preset = keyof typeof PRESETS
type Mode = Preset | 'Custom'

const MODE_OPTIONS = [
  { value: 'Words', label: 'Words' },
  { value: 'Numbers', label: 'Numbers' },
  { value: 'Emoji', label: 'Emoji' },
  { value: 'Custom', label: 'Custom' },
] as const satisfies readonly { value: Mode; label: string }[]

const modeOf = (values: readonly string[]): Mode =>
  (Object.keys(PRESETS) as Preset[]).find((name) => same(values, PRESETS[name])) ?? 'Custom'

const JUSTIFY = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
  dynamic: 'center',
} as const

const TREND = { up: 1, auto: 0, down: -1 } as const satisfies Record<string, Trend>

const DRIFT_MS = 5000
const DRIFT_SAMPLES = 64

/** One cosine cycle: `-amplitude` at both ends, `+amplitude` halfway. */
const driftKeyframes = (amplitude: number) => {
  const frames = new Array<string>(DRIFT_SAMPLES)
  for (let i = 0; i < DRIFT_SAMPLES; i++) {
    const at = -amplitude * Math.cos((2 * Math.PI * i) / (DRIFT_SAMPLES - 1))
    frames[i] = `translateX(${at.toFixed(2)}px)`
  }
  return frames
}

/** Where in that cycle an offset already stands, so the drift picks it up mid-stride. */
const driftPhase = (offset: number, amplitude: number, leftward: boolean) => {
  if (amplitude <= 0) return 0
  const rising = Math.acos(Math.min(1, Math.max(-1, -offset / amplitude))) / (2 * Math.PI)
  return leftward ? 1 - rising : rising
}

export const initPlayground = (root: ParentNode = document) => {
  const find = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  let hops: ReturnType<typeof createHops> | null = null
  const roll = createStage(root, 'roll-demo', [...PRESETS.Words], (index) => hops?.mark(index))
  const align = createStage(root, 'align-demo', ['12', '1,204', '9', '88,900'])
  const trend = createStage(root, 'trend-demo', ['5', '12', '40', '9'])
  const bounce = createStage(root, 'bounce-demo', ['12', '48'])
  const duration = createStage(root, 'duration-demo', ['104', '1.3', '24'])
  // Verbatim lines of the End Poem's closing litany (CC0), in its own order.
  createStage(root, 'flow-b', [
    'I love you',
    'you are the daylight',
    'the light you seek is within you',
    'you are not separate from every other thing',
  ])
  const stopTicker = startLightTicker(find<Scritto>('#flow-a'))

  // The editor reads the pills and the pills load the editor, so one of the two
  // has to be reachable before it exists.
  let pills: { set: (value: Mode) => void } | null = null

  const editor = createHops(find('#values'), (values) => {
    pills?.set(modeOf(values))
    // Typing is not a preset switch: a blur per keystroke would strobe.
    roll.replace(values)
  })
  hops = editor
  editor.set(PRESETS.Words)
  editor.mark(0)

  pills = createPills(find('#mode'), MODE_OPTIONS, 'Words', (mode) => {
    if (mode === 'Custom') {
      editor.append()
      return
    }
    editor.set(PRESETS[mode])
    roll.swap([...PRESETS[mode]])
  })

  const alignStage = align.host.closest<HTMLElement>('.stage')!
  let drift: Animation | null = null
  let slide: Animation | null = null
  let amplitude = 0

  /** Half the room the host has inside the stage, i.e. how far Left and Right move it. */
  const room = () => {
    const pad = getComputedStyle(alignStage)
    const inner =
      alignStage.clientWidth - parseFloat(pad.paddingLeft) - parseFloat(pad.paddingRight)
    return Math.max(0, (inner - align.host.getBoundingClientRect().width) / 2)
  }

  const armDrift = (offset: number, leftward = false) => {
    amplitude = room()
    drift?.cancel()
    drift = align.host.animate(
      { transform: driftKeyframes(amplitude) },
      { duration: DRIFT_MS, easing: 'linear', iterations: Infinity },
    )
    drift.currentTime = driftPhase(offset, amplitude, leftward) * DRIFT_MS
  }

  // The host's width changes as the value rolls and the stage's with the viewport,
  // so a drift armed for the old room would swing the number into the clip.
  const watchRoom = new ResizeObserver(() => {
    if (!drift || Math.abs(room() - amplitude) < 1) return
    const leftward = (Number(drift.currentTime) % DRIFT_MS) / DRIFT_MS > 0.5
    const at = align.host.getBoundingClientRect().left
    // The anchor is only readable with the transform off.
    drift.cancel()
    armDrift(at - align.host.getBoundingClientRect().left, leftward)
  })
  watchRoom.observe(alignStage)
  watchRoom.observe(align.host)

  createPills(
    find('#align'),
    [
      { value: 'left', label: 'Left' },
      { value: 'center', label: 'Center' },
      { value: 'right', label: 'Right' },
      { value: 'dynamic', label: 'Dynamic' },
    ] as const,
    'center',
    (value) => {
      // Slide to the new anchor instead of re-rolling: the value is the one
      // thing that must not change here.
      const from = align.host.getBoundingClientRect().left
      drift?.cancel()
      drift = null
      slide?.cancel()
      slide = null
      align.host.style.transform = ''
      alignStage.style.justifyContent = JUSTIFY[value]
      const shift = from - align.host.getBoundingClientRect().left
      if (value === 'dynamic') {
        armDrift(shift)
        return
      }
      if (Math.abs(shift) < 0.5) return
      slide = align.host.animate(
        { transform: [`translateX(${shift}px)`, 'none'] },
        { duration: STATE_CHANGE_MS, easing: STATE_CHANGE_EASE },
      )
    },
  )

  createPills(
    find('#trend'),
    [
      { value: 'up', label: 'Up' },
      { value: 'auto', label: 'Auto' },
      { value: 'down', label: 'Down' },
    ] as const,
    'auto',
    (value) => {
      trend.apply({ trend: TREND[value] })
    },
  )

  const formatBounce = (value: number) => {
    if (Math.abs(value - BOUNCE_DEFAULT) < 0.005) return `Default – ${value.toFixed(2)}`
    if (Math.abs(value - BOUNCE_BOUNCY) < 0.005) return `Bouncy – ${value.toFixed(2)}`
    return value.toFixed(2)
  }

  const bounceModeOf = (value: number) =>
    Math.abs(value - BOUNCE_DEFAULT) < 0.005 ? 'default'
    : Math.abs(value - BOUNCE_BOUNCY) < 0.005 ? 'bouncy'
    : 'custom'

  // The slider moves the pills and the pills move the slider, so one side has
  // to be reachable before it exists — same shape as the roll card's editor.
  let bouncePills: { set: (value: 'default' | 'bouncy' | 'custom') => void } | null = null

  const bounceSlider = createSlider(find('#bounce'), {
    label: 'Bounce',
    value: BOUNCE_DEFAULT,
    min: 0,
    max: 0.5,
    step: 0.01,
    format: formatBounce,
    formatSeed: (value) => value.toFixed(2),
    formatSamples: [BOUNCE_DEFAULT, BOUNCE_BOUNCY],
    onChange: (value, fromDrag) => {
      bouncePills?.set(bounceModeOf(value))
      const patch = { easing: springEasing(value) }
      if (fromDrag) bounce.configure(patch)
      else bounce.apply(patch)
    },
    onRelease: () => bounce.advance(),
  })

  bouncePills = createPills(
    find('#bounce-mode'),
    [
      { value: 'default', label: 'Default' },
      { value: 'bouncy', label: 'Bouncy' },
      { value: 'custom', label: 'Custom' },
    ] as const,
    'default',
    (mode) => {
      // Custom is not a value of its own: it opens the readout for typing one.
      if (mode === 'custom') {
        bounceSlider.edit()
        return
      }
      const value = mode === 'default' ? BOUNCE_DEFAULT : BOUNCE_BOUNCY
      bounceSlider.set(value)
      bounce.apply({ easing: springEasing(value) })
    },
  )

  createSlider(find('#duration'), {
    label: 'Duration',
    value: 550,
    min: 120,
    max: 1600,
    step: 10,
    format: (value) => `${value}ms`,
    formatSeed: (value) => String(value),
    onChange: (value, fromDrag) => {
      if (fromDrag) duration.configure({ duration: value })
      else duration.apply({ duration: value })
    },
    onRelease: () => duration.advance(),
  })

  const corners = bindCorners(root)

  return () => {
    corners()
    stopTicker()
    roll.dispose()
    watchRoom.disconnect()
    drift?.cancel()
    slide?.cancel()
  }
}
