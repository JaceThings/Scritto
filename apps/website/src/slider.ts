import type { Scritto } from '@scritto/core'
import { cancelPendingTicks, playTick } from './sounds'

// Slider with rubber-band overscroll, pointer drag, and an editable value, all
// driven by a rAF loop rather than a motion library.

const PROP_CHANGE_DURATION = 350
const PROP_CHANGE_EASE = [0.32, 0.72, 0, 1] as const
// Mirrors the prop-change tween so the digits finish morphing as the fill settles.
const READOUT_DURATION = 300
const CLICK_THRESHOLD = 3
// Snap-between-steps ease. Accelerates from rest then settles, so the fill
// reads as a magnetic snap to the next detent.
const STEP_SNAP_DURATION = 80
const STEP_SNAP_EASE = [0, 0.55, 0.45, 1] as const

const TUNING = {
  maxStretchPx: 3,
  deadZonePx: 0,
  cursorRangePx: 200,
  compressY: 0.85,
  springStiffness: 400,
  springDamping: 40,
  springMass: 1,
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const snap = (n: number, step: number) => (step > 0 ? Math.round(n / step) * step : n)

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

/**
 * Widest legal display in characters, so the readout column can reserve a stable
 * width. Without it a 2→3 digit change tugs the label sideways.
 */
const reservedChars = (
  min: number,
  max: number,
  step: number,
  format?: (n: number) => string,
  samples?: readonly number[],
) => {
  const decimals = String(step).includes('.') ? String(step).split('.')[1].length : 0
  const show = (n: number) => (format ? format(n) : decimals ? n.toFixed(decimals) : String(n))
  const lengths = [show(min).length, show(max).length]
  if (samples) for (const value of samples) lengths.push(show(value).length)
  return Math.max(...lengths)
}

const bezier = (x1: number, y1: number, x2: number, y2: number) => {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const atX = (t: number) => ((ax * t + bx) * t + cx) * t
  const atY = (t: number) => ((ay * t + by) * t + cy) * t
  const slope = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  return (x: number) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 8; i++) {
      const dx = atX(t) - x
      if (Math.abs(dx) < 1e-5) return atY(t)
      const d = slope(t)
      if (Math.abs(d) < 1e-6) break
      t -= dx / d
    }
    let lo = 0
    let hi = 1
    t = x
    for (let i = 0; i < 24 && hi - lo > 1e-5; i++) {
      if (atX(t) < x) lo = t
      else hi = t
      t = (lo + hi) / 2
    }
    return atY(t)
  }
}

const PROP_EASE = bezier(...PROP_CHANGE_EASE)
const SNAP_EASE = bezier(...STEP_SNAP_EASE)

type Stop = () => void
const NOOP: Stop = () => {}

const tween = (
  from: number,
  to: number,
  duration: number,
  ease: (x: number) => number,
  onUpdate: (value: number) => void,
  onDone?: () => void,
): Stop => {
  if (prefersReducedMotion() || duration <= 0 || from === to) {
    onUpdate(to)
    onDone?.()
    return NOOP
  }
  const start = performance.now()
  let frame = requestAnimationFrame(function step(now) {
    const progress = Math.min(1, (now - start) / duration)
    onUpdate(from + (to - from) * ease(progress))
    if (progress < 1) frame = requestAnimationFrame(step)
    else onDone?.()
  })
  return () => cancelAnimationFrame(frame)
}

/** Release spring for the rubber band, integrated at a fixed sub-step. */
const springHome = (from: number, onUpdate: (value: number) => void): Stop => {
  if (prefersReducedMotion()) {
    onUpdate(0)
    return NOOP
  }
  let position = from
  let velocity = 0
  let last = performance.now()
  let frame = requestAnimationFrame(function step(now) {
    const elapsed = Math.min(0.032, (now - last) / 1000)
    last = now
    const steps = Math.max(1, Math.ceil(elapsed / 0.004))
    const h = elapsed / steps
    for (let i = 0; i < steps; i++) {
      const force =
        (-TUNING.springStiffness * position - TUNING.springDamping * velocity) / TUNING.springMass
      velocity += force * h
      position += velocity * h
    }
    if (Math.abs(position) > 0.01 || Math.abs(velocity) > 0.05) {
      onUpdate(position)
      frame = requestAnimationFrame(step)
    } else {
      onUpdate(0)
    }
  })
  return () => cancelAnimationFrame(frame)
}

export type SliderConfig = {
  label: string
  value: number
  min: number
  max: number
  step?: number
  format?: (value: number) => string
  /** Seed for the typed input when `format` decorates the number. */
  formatSeed?: (value: number) => string
  /** Extra values fed through `format` when reserving the readout width. */
  formatSamples?: readonly number[]
  /** `fromDrag` is true only for continuous pointer-drag updates. */
  onChange: (next: number, fromDrag: boolean) => void
  /** Fires when a pointer drag ends, for consumers that replay on settle. */
  onRelease?: (value: number) => void
}

let sliderCount = 0

export const createSlider = (mount: HTMLElement, config: SliderConfig) => {
  const { label, min, max, format, formatSeed, formatSamples, onChange, onRelease } = config
  const step = config.step ?? 1
  const range = max - min || 1
  const id = `slider-${++sliderCount}`

  let value = clamp(snap(config.value, step), min, max)
  const initialValue = value
  // Stays in [min, max]: what the readout and fill show. Decoupled from the
  // visible stretch so the readout never displays an illegal value.
  let reported = value

  mount.innerHTML = `
    <div class="slider">
      <div class="slider-head">
        <label class="slider-label" for="${id}"><scritto-text data-role="label"></scritto-text></label>
        <span class="slider-readout" data-role="readout"
          ><scritto-text data-role="value"></scritto-text
        ></span>
        <input class="slider-input" data-role="input" type="text" inputmode="decimal" hidden />
      </div>
      <div class="slider-drag" data-role="drag">
        <div class="slider-shell" data-role="shell">
          <div class="slider-stretch" data-role="stretch">
            <div class="slider-track" aria-hidden="true"><div class="slider-fill" data-role="fill"></div></div>
          </div>
          <input class="slider-range" data-role="range" type="range" id="${id}" data-focus-ring
            min="${min}" max="${max}" step="${step}" value="${value}" />
        </div>
      </div>
    </div>`

  const pick = <T extends Element>(role: string) => mount.querySelector<T>(`[data-role="${role}"]`)!
  const labelText = pick<Scritto>('label')
  const readout = pick<HTMLElement>('readout')
  const valueText = pick<Scritto>('value')
  const input = pick<HTMLInputElement>('input')
  const drag = pick<HTMLElement>('drag')
  const shell = pick<HTMLElement>('shell')
  const stretch = pick<HTMLElement>('stretch')
  const fill = pick<HTMLElement>('fill')
  const rangeInput = pick<HTMLInputElement>('range')

  for (const el of [labelText, valueText]) {
    el.setOptions({ transition: { duration: READOUT_DURATION } })
  }
  labelText.update(label, false)

  const reserved = reservedChars(min, max, step, format, formatSamples)
  readout.style.minWidth = `${reserved}ch`
  input.style.minWidth = `${reserved}ch`

  const display = (raw: number) => {
    const stepped = clamp(snap(raw, step), min, max)
    return format ? format(stepped) : String(stepped)
  }

  const paint = () => {
    fill.style.width = `${((clamp(reported, min, max) - min) / range) * 100}%`
    valueText.update(display(reported), true)
  }

  const setReported = (next: number) => {
    reported = next
    paint()
  }

  paint()

  // --- rubber band -------------------------------------------------------
  let stretchPx = 0
  let stopStretch: Stop = NOOP

  const paintStretch = () => {
    const magnitude = Math.abs(stretchPx)
    const ratio = Math.min(1, magnitude / TUNING.maxStretchPx)
    const scaleY = 1 - (1 - TUNING.compressY) * ratio
    stretch.style.width = `calc(100% + ${magnitude}px)`
    stretch.style.transform = `translateX(${stretchPx < 0 ? stretchPx : 0}px) scaleY(${scaleY})`
  }

  const setStretch = (next: number) => {
    if (stretchPx === next) return
    stretchPx = next
    paintStretch()
  }

  const stretchAt = (clientX: number, rect: DOMRect, sign: 1 | -1) => {
    const past = sign < 0 ? rect.left - clientX : clientX - rect.right
    const overflow = Math.max(0, past - TUNING.deadZonePx)
    return sign * TUNING.maxStretchPx * Math.sqrt(Math.min(overflow / TUNING.cursorRangePx, 1))
  }

  const updateStretch = (clientX: number, rect: DOMRect) => {
    stopStretch()
    if (clientX < rect.left) setStretch(stretchAt(clientX, rect, -1))
    else if (clientX > rect.right) setStretch(stretchAt(clientX, rect, 1))
    else setStretch(0)
  }

  const releaseStretch = () => {
    if (stretchPx === 0) return
    stopStretch()
    stopStretch = springHome(stretchPx, setStretch)
  }

  // --- value plumbing ----------------------------------------------------
  let stopProp: Stop = NOOP
  let stopPointer: Stop = NOOP
  let snapFrame = 0
  let snapFrom = reported
  let snapTarget = reported
  let snapStarted = 0
  const stopSnap = () => {
    cancelAnimationFrame(snapFrame)
    snapFrame = 0
  }
  const updateSnap = (now: number) => {
    const progress = Math.min(1, (now - snapStarted) / STEP_SNAP_DURATION)
    setReported(snapFrom + (snapTarget - snapFrom) * SNAP_EASE(progress))
    return progress
  }
  const retargetSnap = (next: number) => {
    const now = performance.now()
    if (snapFrame) updateSnap(now)
    snapFrom = reported
    snapTarget = next
    snapStarted = now
    if (snapFrame) return
    snapFrame = requestAnimationFrame(function tick(frameNow) {
      if (updateSnap(frameNow) < 1) snapFrame = requestAnimationFrame(tick)
      else snapFrame = 0
    })
  }
  let dragging = false

  const commit = (next: number, fromDrag: boolean) => {
    if (next === value) return
    value = next
    rangeInput.value = String(next)
    onChange(next, fromDrag)
  }

  /** Tween the fill toward the committed value — used for every non-drag change. */
  const settle = () => {
    stopProp()
    stopProp = tween(reported, value, PROP_CHANGE_DURATION, PROP_EASE, setReported)
  }

  // --- pointer drag ------------------------------------------------------
  let pointerId: number | null = null
  let lastStepped: number | null = null
  let downAt: { x: number; y: number } | null = null
  let isClick = true

  const valueAt = (clientX: number, rect: DOMRect) =>
    clamp(snap(clamp((clientX - rect.left) / rect.width, 0, 1) * range + min, step), min, max)

  const applyPointer = (clientX: number) => {
    const rect = shell.getBoundingClientRect()
    if (!rect.width) return
    updateStretch(clientX, rect)
    const stepped = valueAt(clientX, rect)
    if (stepped !== lastStepped) {
      const crossed = Math.round(Math.abs(stepped - (lastStepped ?? stepped)) / step)
      playTick()
      lastStepped = stepped
      // Keep one rAF loop alive while retargeting. Cancel-and-restart can drop
      // every update when pointer events arrive faster than display frames.
      if (prefersReducedMotion() || crossed > 1) {
        stopSnap()
        setReported(stepped)
      } else {
        retargetSnap(stepped)
      }
    }
    commit(stepped, true)
  }

  drag.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    const rect = shell.getBoundingClientRect()
    if (!rect.width) return
    event.preventDefault()
    stopProp()
    stopPointer()
    stopSnap()
    drag.setPointerCapture(event.pointerId)
    pointerId = event.pointerId
    dragging = true
    isClick = true
    downAt = { x: event.clientX, y: event.clientY }

    // Tween toward the tapped position; a drag past the threshold cancels this
    // and switches to direct tracking, otherwise it plays out as tap-to-jump.
    const target = valueAt(event.clientX, rect)
    lastStepped = target
    // Tick once per detent the fill crosses on the way, so a tap-to-jump sounds
    // like the bar travelling through them rather than landing in silence. A
    // long jump collapses into a buzz under the audio layer's own rate cap,
    // exactly as a fast drag does.
    let lastTick = clamp(snap(reported, step), min, max)
    const reportAndTick = (next: number) => {
      setReported(next)
      const detent = clamp(snap(next, step), min, max)
      if (detent === lastTick) return
      lastTick = detent
      playTick()
    }
    stopPointer = tween(reported, target, PROP_CHANGE_DURATION, PROP_EASE, reportAndTick)
    commit(target, false)
  })

  drag.addEventListener('pointermove', (event) => {
    if (!dragging || pointerId !== event.pointerId) return
    if (isClick) {
      if (!downAt || Math.abs(event.clientX - downAt.x) < CLICK_THRESHOLD) return
      stopPointer()
      isClick = false
    }
    applyPointer(event.clientX)
  })

  // Fires on pointerup, on the pointer leaving the element, and on a forced
  // OS-level release — pointerup alone misses the finger-flies-off case.
  drag.addEventListener('lostpointercapture', (event) => {
    if (pointerId !== event.pointerId) return
    dragging = false
    pointerId = null
    releaseStretch()
    // After a real drag `reported` can hold a sub-step fraction; tween it to the
    // committed value. A tap already animated toward its target.
    if (!isClick) {
      stopPointer()
      stopPointer = tween(reported, value, PROP_CHANGE_DURATION, PROP_EASE, setReported)
      onRelease?.(value)
    }
    isClick = true
    downAt = null
    lastStepped = null
    stopSnap()
    // Without this a fast flick that queued ~40ms of ticks keeps clicking after
    // the finger is gone.
    cancelPendingTicks()
  })

  // --- keyboard ----------------------------------------------------------
  rangeInput.addEventListener('input', () => {
    if (dragging) return
    const next = Number(rangeInput.value)
    if (next === value) return
    value = next
    onChange(next, false)
    settle()
  })

  // Shift + arrow jumps 10x step; plain arrows fall through to the native ±step.
  rangeInput.addEventListener('keydown', (event) => {
    if (!event.shiftKey) return
    const dir =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? -1
          : 0
    if (!dir) return
    event.preventDefault()
    const next = clamp(snap(value + dir * step * 10, step), min, max)
    if (next === value) return
    commit(next, false)
    settle()
  })

  // --- click-to-type readout --------------------------------------------
  const seed = formatSeed ?? format
  // Hiding the input blurs it, and blur commits — so Escape has to close the
  // edit out from under its own blur handler or it commits the draft it was
  // asked to throw away.
  let editing = false

  const endEdit = () => {
    editing = false
    input.hidden = true
    readout.hidden = false
  }

  const beginEdit = () => {
    input.value = seed ? seed(value) : String(value)
    editing = true
    readout.hidden = true
    input.hidden = false
    input.focus()
    input.select()
  }

  const commitEdit = () => {
    if (!editing) return
    // Lenient on purpose: a decorated seed like "Default – 0.20" still round-trips.
    const parsed = parseFloat(input.value)
    if (!Number.isNaN(parsed)) {
      const next = clamp(snap(parsed, step), min, max)
      commit(next, false)
      settle()
    }
    endEdit()
  }

  readout.addEventListener('click', beginEdit)
  input.addEventListener('blur', commitEdit)
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitEdit()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      endEdit()
      return
    }
    const dir =
      event.key === 'ArrowUp' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowDown' || event.key === 'ArrowLeft'
          ? -1
          : 0
    if (!dir) return
    event.preventDefault()
    const base = parseFloat(input.value)
    const from = Number.isNaN(base) ? value : base
    const next = clamp(snap(from + dir * step * (event.shiftKey ? 10 : 1), step), min, max)
    input.value = seed ? seed(next) : String(next)
    commit(next, false)
    settle()
  })

  // Double-clicking the label reverts to the value the slider mounted with.
  pick<HTMLElement>('label').addEventListener('dblclick', () => {
    if (initialValue === value) return
    commit(initialValue, false)
    settle()
  })

  return {
    get value() {
      return value
    },
    set(next: number) {
      const stepped = clamp(snap(next, step), min, max)
      if (stepped === value) return
      value = stepped
      rangeInput.value = String(stepped)
      settle()
    },
    destroy() {
      stopProp()
      stopPointer()
      stopSnap()
      stopStretch()
    },
  }
}
