import '@scritto/core'
import type { Scritto, Trend } from '@scritto/core'
import { createPills } from './pills'
import { createSlider } from './slider'
import { playClick } from './sounds'
import { springEasing } from './spring'
import { startLightTicker } from './ticker'

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

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, i) => value === b[i])

/** Custom is not a mode to opt into — it is what "none of the presets" reads as. */
const modeOf = (values: readonly string[]): Mode =>
  (Object.keys(PRESETS) as Preset[]).find((name) => same(values, PRESETS[name])) ?? 'Custom'

const JUSTIFY = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
  dynamic: 'center',
} as const

const TREND = { up: 1, auto: 0, down: -1 } as const satisfies Record<string, Trend>

// The core's own two easings sit at bounce 0.20 (its default) and 0.30, so the
// slider is annotated at both.
const BOUNCE_DEFAULT = 0.2
const BOUNCE_BOUNCY = 0.3

// Matches Lisse's preset tween, so an alignment change reads as one beat.
const STATE_CHANGE_MS = 350
const STATE_CHANGE_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'

// Split of that one beat: away faster than back, so the handoff has happened
// before the eye has finished reading the exit.
const SWAP_OUT_MS = Math.round(STATE_CHANGE_MS * 0.4)
const SWAP_IN_MS = STATE_CHANGE_MS - SWAP_OUT_MS
// The site's entrance blur. More than this and 40px type reads as mush.
const SWAP_BLUR = 4
const SWAP_SCALE = 0.94

const DRIFT_MS = 5000
const DRIFT_SAMPLES = 64

/**
 * One cycle of a cosine, sampled: `-amplitude` at both ends, `+amplitude` halfway.
 * A triangle wave would turn on a corner; this eases through both ends, and its
 * turning points are exactly where Left and Right park the host.
 */
const driftKeyframes = (amplitude: number) => {
  const frames = new Array<string>(DRIFT_SAMPLES)
  for (let i = 0; i < DRIFT_SAMPLES; i++) {
    const at = -amplitude * Math.cos((2 * Math.PI * i) / (DRIFT_SAMPLES - 1))
    frames[i] = `translateX(${at.toFixed(2)}px)`
  }
  return frames
}

/**
 * The point in that cycle where the host already stands, so the drift picks it up
 * mid-stride rather than teleporting to the start of its loop. Two phases hold
 * every offset — one heading right, one heading left; at either edge they meet on
 * the turning point.
 */
const driftPhase = (offset: number, amplitude: number, leftward: boolean) => {
  if (amplitude <= 0) return 0
  const rising = Math.acos(Math.min(1, Math.max(-1, -offset / amplitude))) / (2 * Math.PI)
  return leftward ? 1 - rising : rising
}

/** Drawn, never typed — a comma is a separator, not a character in any field. */
const SEP = ','
const HINT_ID = 'values-hint'

/**
 * The values as one comma-separated line whose commas are drawn rather than typed.
 * Each value is its own field: a comma or Enter splits the one under the caret,
 * Backspace at its start joins it back to the one before, and the arrows step across
 * the boundaries. Since punctuation is never a character, a comma on screen is always
 * a separator — the trade is that a value cannot contain one.
 */
const createHops = (mount: HTMLElement, onChange: (values: string[]) => void) => {
  const mirror = document.createElement('span')
  mirror.className = 'hop-mirror'
  mirror.setAttribute('aria-hidden', 'true')
  mount.append(mirror)

  let values: string[] = []
  let reported: string[] = []

  const inputs = () => [...mount.querySelectorAll<HTMLInputElement>('.hop-value')]

  const autosize = (input: HTMLInputElement) => {
    mirror.textContent = input.value || ' '
    input.style.width = `${mirror.getBoundingClientRect().width + 1}px`
  }

  const caretTo = (input: HTMLInputElement, at: number) => {
    input.focus()
    const clamped = Math.max(0, Math.min(at, input.value.length))
    input.setSelectionRange(clamped, clamped)
  }

  const emit = () => {
    const live = values.filter(Boolean)
    // A half-typed blank is not a change to the list. Reporting one would roll the
    // card back to its first value and read the preset as Custom for no reason.
    if (same(live, reported)) return
    reported = live
    onChange(live)
  }

  const hopFor = (value: string, index: number) => {
    const hop = document.createElement('span')
    hop.className = 'hop'

    const input = document.createElement('input')
    input.className = 'hop-value'
    input.type = 'text'
    input.value = value
    input.spellcheck = false
    input.autocomplete = 'off'
    input.setAttribute('aria-label', `Value ${index + 1}`)
    input.setAttribute('aria-describedby', HINT_ID)
    autosize(input)

    const splitAt = (from: number, to: number, incoming: string) => {
      const parts = incoming.split(',')
      const last = parts[parts.length - 1] ?? ''
      values.splice(
        index,
        1,
        input.value.slice(0, from) + parts[0],
        ...parts.slice(1, -1),
        last + input.value.slice(to),
      )
      render({ index: index + parts.length - 1, caret: last.length })
      emit()
    }

    input.addEventListener('beforeinput', (event) => {
      if (!input.isConnected) return
      if (event.inputType !== 'insertText' || !event.data?.includes(',')) return
      // A comma is never a character: insertText that carries one splits instead.
      event.preventDefault()
      const from = input.selectionStart ?? input.value.length
      const to = input.selectionEnd ?? from
      splitAt(from, to, event.data)
    })

    input.addEventListener('input', () => {
      if (input.value.includes(',')) {
        // IME / mobile / a raw value write can still land a comma. Split it out.
        splitAt(0, input.value.length, input.value)
        return
      }
      values[index] = input.value
      autosize(input)
      emit()
    })

    input.addEventListener('blur', () => {
      // Detaching a field blurs it, so a rebuild would otherwise run this again with
      // an index that now points at somebody else's value.
      if (!input.isConnected) return
      if (values[index]?.trim() || values.length < 2) return
      values.splice(index, 1)
      render()
      emit()
    })

    input.addEventListener('paste', (event) => {
      const text = event.clipboardData?.getData('text')
      if (!text?.includes(',')) return
      event.preventDefault()
      const from = input.selectionStart ?? input.value.length
      const to = input.selectionEnd ?? from
      splitAt(from, to, text.split(',').map((part) => part.trim()).join(','))
    })

    input.addEventListener('keydown', (event) => {
      const caret = input.selectionStart ?? 0
      const collapsed = caret === input.selectionEnd
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault()
        splitAt(caret, caret, ',')
        return
      }
      if (event.key === 'Backspace' && collapsed && caret === 0 && index > 0) {
        event.preventDefault()
        const join = values[index - 1].length
        values[index - 1] += input.value
        values.splice(index, 1)
        render({ index: index - 1, caret: join })
        emit()
        return
      }
      if (event.key === 'ArrowLeft' && collapsed && caret === 0 && index > 0) {
        event.preventDefault()
        const prev = inputs()[index - 1]
        if (prev) caretTo(prev, prev.value.length)
        return
      }
      if (event.key === 'ArrowRight' && collapsed && caret === input.value.length) {
        const next = inputs()[index + 1]
        if (!next) return
        event.preventDefault()
        caretTo(next, 0)
      }
    })

    hop.append(input)
    if (index < values.length - 1) {
      const sep = document.createElement('span')
      sep.className = 'hop-sep'
      sep.textContent = SEP
      sep.setAttribute('aria-hidden', 'true')
      hop.append(sep)
    }
    return hop
  }

  const render = (focus?: { index: number; caret: number }) => {
    const hops = values.map(hopFor)
    mount.replaceChildren(mirror, ...hops)
    if (!focus) return
    const input = inputs()[focus.index]
    if (input) caretTo(input, focus.caret)
  }

  mount.addEventListener('copy', (event) => {
    const active = document.activeElement
    if (
      active instanceof HTMLInputElement &&
      mount.contains(active) &&
      active.selectionStart !== active.selectionEnd
    ) {
      return
    }
    event.preventDefault()
    event.clipboardData?.setData('text/plain', values.filter(Boolean).join(', '))
  })

  void document.fonts.ready.then(() => {
    for (const input of inputs()) autosize(input)
  })

  return {
    /** Loads a list without reporting it back — whoever set it already knows. */
    set(next: readonly string[]) {
      values = next.flatMap((value) => value.split(',').map((part) => part.trim()))
      reported = values.filter(Boolean)
      render()
    },
    /** Somewhere to start typing, for when Custom is picked. */
    append() {
      values.push('')
      render({ index: values.length - 1, caret: 0 })
    },
  }
}

type StageOptions = { trend: Trend; duration: number; easing: string }

const createStage = (root: ParentNode, id: string, values: string[]) => {
  const host = root.querySelector<Scritto>(`#${id}`)!
  const trigger = host.closest('button')!
  const options: StageOptions = {
    trend: 0,
    duration: 550,
    easing: springEasing(BOUNCE_DEFAULT),
  }
  let list = values
  let index = 0

  const paint = (animate: boolean) => {
    const value = list[index % list.length]
    host.setOptions({
      respectMotionPreference: false,
      trend: options.trend,
      transition: { duration: options.duration, easing: options.easing },
    })
    host.update(value, animate)
    host.setAttribute('aria-label', value)
  }

  const advance = () => {
    index += 1
    paint(true)
  }

  const replace = (next: string[]) => {
    if (!next.length) return
    list = next
    index = 0
    paint(false)
  }

  let gesture: Animation | null = null

  /**
   * A preset switch replaces the whole string and its character set, so the host
   * hands one piece of content to the next instead of rolling: it scales down and
   * blurs away, the value swaps while it is invisible, and the same curve carries
   * it back. Rolling "Creative" into "24" per glyph would read as noise.
   */
  const handoff = (change: () => void) => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      change()
      return
    }
    // Read before cancelling: from where the host stands, an interrupted swap
    // turns around mid-gesture rather than popping back to full opacity.
    const css = getComputedStyle(host)
    const at: Keyframe = {
      opacity: css.opacity,
      transform: css.transform === 'none' ? 'scale(1)' : css.transform,
      filter: css.filter === 'none' ? 'blur(0px)' : css.filter,
    }
    const gone: Keyframe = {
      opacity: 0,
      transform: `scale(${SWAP_SCALE})`,
      filter: `blur(${SWAP_BLUR}px)`,
    }
    gesture?.cancel()
    // Reversed, so the leg away rides the mirror of the curve that settles it
    // back — one gesture rather than two that happen to meet.
    const out = host.animate([gone, at], {
      duration: SWAP_OUT_MS,
      easing: STATE_CHANGE_EASE,
      direction: 'reverse',
      fill: 'forwards',
    })
    gesture = out
    void out.finished
      .then(() => {
        if (gesture !== out) return
        change()
        const back = host.animate(
          [gone, { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' }],
          { duration: SWAP_IN_MS, easing: STATE_CHANGE_EASE },
        )
        // Only now: cancelling the held exit first would show a frame of the new
        // content at rest.
        out.cancel()
        gesture = back
        void back.finished
          .then(() => {
            if (gesture === back) gesture = null
          })
          .catch(() => {})
      })
      .catch(() => {})
  }

  trigger.addEventListener('click', () => {
    playClick()
    advance()
  })
  paint(false)

  return {
    host,
    advance,
    configure(patch: Partial<StageOptions>) {
      Object.assign(options, patch)
    },
    /** Applies the change and rolls once, so the effect is visible immediately. */
    apply(patch: Partial<StageOptions>) {
      Object.assign(options, patch)
      advance()
    },
    replace,
    /** `replace`, carried by the handoff — for a switch between presets. */
    swap(next: string[]) {
      if (!next.length) return
      handoff(() => replace(next))
    },
    dispose() {
      gesture?.cancel()
      gesture = null
    },
  }
}

export const initPlayground = (root: ParentNode = document) => {
  const find = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!

  const roll = createStage(root, 'roll-demo', [...PRESETS.Words])
  const align = createStage(root, 'align-demo', ['12', '1,204', '9', '88,900'])
  const trend = createStage(root, 'trend-demo', ['5', '12', '40', '9'])
  const bounce = createStage(root, 'bounce-demo', ['12', '48'])
  const duration = createStage(root, 'duration-demo', ['104', '1.3', '24'])
  createStage(root, 'flow-b', ['1,234,567', '12'])
  const stopTicker = startLightTicker(find<Scritto>('#flow-a'))

  // The editor reads the pills and the pills load the editor, so one of the two has
  // to be reachable before it exists.
  let pills: { set: (value: Mode) => void } | null = null

  const hops = createHops(find('#values'), (values) => {
    pills?.set(modeOf(values))
    // Typing is not a preset switch: the card has to answer each keystroke, and a
    // blur per character would be strobing.
    roll.replace(values)
  })
  hops.set(PRESETS.Words)

  pills = createPills(find('#mode'), MODE_OPTIONS, 'Words', (mode) => {
    if (mode === 'Custom') {
      hops.append()
      return
    }
    hops.set(PRESETS[mode])
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
  // so a drift armed for the old room would swing the number past the card's edge
  // and into the clip. Re-arm from where it stands, still heading the way it was.
  const watchRoom = new ResizeObserver(() => {
    if (!drift || Math.abs(room() - amplitude) < 1) return
    const leftward = (Number(drift.currentTime) % DRIFT_MS) / DRIFT_MS > 0.5
    const at = align.host.getBoundingClientRect().left
    // Cancel before measuring: the anchor is only readable with the transform off.
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
      // Slide the host to its new anchor instead of re-rolling: the value is the
      // one thing that must not change here.
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

  createSlider(find('#bounce'), {
    label: 'Bounce',
    value: BOUNCE_DEFAULT,
    min: 0,
    max: 0.5,
    step: 0.01,
    format: formatBounce,
    formatSeed: (value) => value.toFixed(2),
    formatSamples: [BOUNCE_DEFAULT, BOUNCE_BOUNCY],
    onChange: (value, fromDrag) => {
      const patch = { easing: springEasing(value) }
      if (fromDrag) bounce.configure(patch)
      else bounce.apply(patch)
    },
    onRelease: () => bounce.advance(),
  })

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

  return () => {
    stopTicker()
    roll.dispose()
    watchRoom.disconnect()
    drift?.cancel()
    slide?.cancel()
  }
}
