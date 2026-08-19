import '@scritto/core'
import type { Scritto, Trend } from '@scritto/core'
// The roll's shape lives in one module-level object rather than per instance.
// The site resolves `@scritto/core` to this same source, so the studio holds the
// object the element itself reads.
import { CONFIG } from '../../../../packages/core/src/const'
import { captureHost, download } from '../lib/raster'

const SCRUB_STEPS = 1000
const FPS = 60
const FRAME_MS = 1000 / FPS
const THUMBS = 16
const THUMB_HEIGHT = 54

type Knob = 'size' | 'weight' | 'duration' | 'blur' | 'travel' | 'scale' | 'rotate' | 'stagger' | 'shot' | 'pad'

const FORMAT = {
  size: (value: number) => `${value}px`,
  weight: (value: number) => String(value),
  duration: (value: number) => `${value}ms`,
  blur: (value: number) => `${value.toFixed(3)}em`,
  travel: (value: number) => `${value.toFixed(2)}em`,
  scale: (value: number) => value.toFixed(2),
  rotate: (value: number) => `${value}°`,
  stagger: (value: number) => value.toFixed(2),
  shot: (value: number) => `${value}×`,
  pad: (value: number) => `${value}px`,
} satisfies Record<Knob, (value: number) => string>

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)}s`

export const initStudio = (root: ParentNode = document) => {
  const find = <T extends HTMLElement>(role: string) => root.querySelector<T>(`[data-role="${role}"]`)!
  const out = (name: string) => root.querySelector<HTMLOutputElement>(`[data-out="${name}"]`)!
  const host = root.querySelector<Scritto>('#studio-text')!

  const from = find<HTMLInputElement>('from')
  const to = find<HTMLInputElement>('to')
  const trend = find<HTMLSelectElement>('trend')
  const bounce = find<HTMLInputElement>('bounce')
  const colour = find<HTMLInputElement>('color')
  const scrub = find<HTMLInputElement>('scrub')
  const play = find<HTMLButtonElement>('play')
  const loop = find<HTMLButtonElement>('loop')
  const rate = find<HTMLSelectElement>('rate')
  const strip = find<HTMLElement>('strip')
  const playhead = find<HTMLElement>('playhead')
  const dims = find<HTMLParagraphElement>('dims')

  // The stage is transparent, so a black default disappears on the dark page.
  const inkFromPage = () => {
    const rgb = getComputedStyle(host).color.match(/\d+/g)
    if (!rgb || rgb.length < 3) return null
    return `#${rgb.slice(0, 3).map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`
  }

  const knob = (name: Knob) => Number(find<HTMLInputElement>(name).value)
  const knobs: Knob[] = ['size', 'weight', 'duration', 'blur', 'travel', 'scale', 'rotate', 'stagger', 'shot', 'pad']

  let running: Animation[] = []
  let span = 1
  let at = 0
  let playing = false
  let frame = 0

  // A document's animations stop at the shadow boundary, so the roll's own
  // glyphs are only reachable through the root that holds them.
  const tracked = () => [...host.getAnimations({ subtree: true }), ...(host.shadowRoot?.getAnimations() ?? [])]

  const seek = (ms: number) => {
    at = clamp(ms, 0, span)
    for (const animation of running) animation.currentTime = at
    scrub.value = String(Math.round((at / span) * SCRUB_STEPS))
    playhead.style.left = `${(at / span) * 100}%`
    const frames = Math.max(1, Math.round(span / FRAME_MS))
    out('time').textContent = `${seconds(at)} / ${seconds(span)} · ${Math.round(at / FRAME_MS)}/${frames}`
  }

  const step = (frames: number) => {
    stop()
    seek(at + frames * FRAME_MS)
  }

  const stop = () => {
    playing = false
    cancelAnimationFrame(frame)
    play.textContent = '▶'
    play.setAttribute('aria-label', 'Play')
  }

  /**
   * The animations are held paused and driven by hand, so nothing ever reaches
   * its finish: a roll that finished would release its outgoing glyphs, and
   * scrubbing back would find them gone.
   */
  const roll = (keepPosition: boolean, openAt = 0) => {
    stop()
    const fraction = keepPosition && span > 0 ? at / span : openAt
    CONFIG.blur = knob('blur')
    CONFIG.y = knob('travel')
    CONFIG.scale = knob('scale')
    CONFIG.rotate = knob('rotate')
    CONFIG.stagger = knob('stagger')

    host.style.fontSize = `${knob('size')}px`
    host.style.fontWeight = String(knob('weight'))
    host.style.color = colour.value

    host.setOptions({
      respectMotionPreference: false,
      bounce: bounce.checked,
      // SAFETY: the select only offers the three values a trend can take.
      trend: Number(trend.value) as Trend,
      transition: { duration: knob('duration') },
    })

    for (const animation of running) animation.cancel()
    running = []
    host.update(from.value, false)
    host.update(to.value, true)

    queueMicrotask(() => {
      running = tracked()
      for (const animation of running) animation.pause()
      span = running.reduce((longest, animation) => {
        const end = animation.effect?.getComputedTiming().endTime
        return Math.max(longest, Number(end ?? 0))
      }, 1)
      seek(fraction * span)
      measure()
      // Every knob movement re-rolls, and a strip costs sixteen captures, so it
      // waits for the hand to stop.
      clearTimeout(stripQueued)
      stripQueued = window.setTimeout(() => void buildStrip(), 250)
    })
  }

  let stripGen = 0
  let stripQueued = 0

  /**
   * One rasterised frame per cell. A thumbnail is the same capture the export
   * uses, so the strip is the transition rather than a drawing of it. Building
   * it walks the animations to each position, which is why it runs once a change
   * has settled and never while something is playing.
   */
  const buildStrip = async () => {
    const gen = ++stripGen
    const cells: HTMLCanvasElement[] = []
    strip.replaceChildren(playhead)
    for (let i = 0; i < THUMBS; i++) {
      const cell = document.createElement('canvas')
      cell.width = 1
      cell.height = 1
      cell.title = `${seconds((span * i) / (THUMBS - 1))}`
      cells.push(cell)
      strip.append(cell)
    }
    const held = at
    for (let i = 0; i < THUMBS; i++) {
      if (gen !== stripGen) return
      seek((span * i) / (THUMBS - 1))
      await new Promise((done) => requestAnimationFrame(() => done(null)))
      if (gen !== stripGen) return
      const box = host.getBoundingClientRect()
      const scale = box.height ? Math.min(1, THUMB_HEIGHT / box.height) : 1
      const shot = await captureHost(host, scale, 6)
      if (gen !== stripGen) return
      const cell = cells[i]
      cell.width = shot.width
      cell.height = shot.height
      cell.getContext('2d')?.drawImage(shot, 0, 0)
    }
    if (gen !== stripGen) return
    seek(held)
  }

  const measure = () => {
    const box = host.getBoundingClientRect()
    const scale = knob('shot')
    const pad = knob('pad')
    const width = Math.round((box.width + pad * 2) * scale)
    const height = Math.round((box.height + pad * 2) * scale)
    dims.textContent = `${width} × ${height} px`
  }

  const tick = (last: number) => {
    frame = requestAnimationFrame((now) => {
      const next = at + (now - last) * Number(rate.value)
      if (next >= span) {
        if (loop.getAttribute('aria-pressed') !== 'true') {
          seek(span)
          stop()
          return
        }
        seek(next - span)
      } else {
        seek(next)
      }
      tick(now)
    })
  }

  const start = () => {
    playing = true
    play.textContent = '❚❚'
    play.setAttribute('aria-label', 'Pause')
    if (at >= span) seek(0)
    tick(performance.now())
  }

  const toggle = () => (playing ? stop() : start())

  play.addEventListener('click', toggle)
  find<HTMLButtonElement>('back').addEventListener('click', () => step(-1))
  find<HTMLButtonElement>('next').addEventListener('click', () => step(1))
  loop.addEventListener('click', () => {
    const on = loop.getAttribute('aria-pressed') === 'true'
    loop.setAttribute('aria-pressed', String(!on))
  })

  scrub.addEventListener('input', () => {
    stop()
    seek((Number(scrub.value) / SCRUB_STEPS) * span)
  })

  strip.addEventListener('pointerdown', (event) => {
    const box = strip.getBoundingClientRect()
    if (!box.width) return
    stop()
    seek(((event.clientX - box.left) / box.width) * span)
  })

  for (const name of knobs) {
    const input = find<HTMLInputElement>(name)
    const label = out(name)
    const paint = () => (label.textContent = FORMAT[name](Number(input.value)))
    paint()
    input.addEventListener('input', () => {
      paint()
      if (name === 'shot' || name === 'pad') {
        measure()
        return
      }
      roll(true)
    })
  }

  for (const el of [from, to, trend, bounce, colour]) {
    el.addEventListener('change', () => roll(true))
  }
  for (const el of [from, to]) el.addEventListener('input', () => roll(true))

  for (const preset of find<HTMLElement>('presets').querySelectorAll<HTMLButtonElement>('button')) {
    preset.addEventListener('click', () => {
      from.value = preset.dataset.from ?? ''
      to.value = preset.dataset.to ?? ''
      roll(false)
    })
  }

  find<HTMLButtonElement>('replay').addEventListener('click', () => roll(false))

  const shoot = () => captureHost(host, knob('shot'), knob('pad'))

  // A shortcut has no business firing while somebody is typing a value.
  const typing = (target: EventTarget | null) =>
    target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)

  window.addEventListener('keydown', (event) => {
    if (event.key === ' ' && !typing(event.target)) {
      event.preventDefault()
      toggle()
      return
    }
    const jump = event.shiftKey ? 10 : 1
    if (event.key === '.' || event.key === 'ArrowRight') {
      if (event.key === 'ArrowRight' && typing(event.target)) return
      event.preventDefault()
      step(jump)
      return
    }
    if (event.key === ',' || event.key === 'ArrowLeft') {
      if (event.key === 'ArrowLeft' && typing(event.target)) return
      event.preventDefault()
      step(-jump)
      return
    }
    if (event.key === 'Home' && !typing(event.target)) {
      event.preventDefault()
      step(-Infinity)
      return
    }
    if (event.key === 'End' && !typing(event.target)) {
      event.preventDefault()
      stop()
      seek(span)
      return
    }
    if ((event.key === 'l' || event.key === 'L') && !typing(event.target)) {
      event.preventDefault()
      loop.click()
      return
    }
    if ((event.key === 's' || event.key === 'S') && event.metaKey && event.altKey) {
      event.preventDefault()
      void shoot().then((canvas) => download(canvas, `scritto-${Date.now()}.png`))
    }
  })


  find<HTMLButtonElement>('export').addEventListener('click', () => {
    void shoot().then((canvas) => download(canvas, `scritto-${Date.now()}.png`))
  })

  colour.value = inkFromPage() ?? colour.value
  roll(false, 0.4)

  window.scrittoStudio = { capture: shoot, seek, span: () => span, strip: buildStrip }

  return () => {
    stop()
    stripGen += 1
    clearTimeout(stripQueued)
    for (const animation of running) animation.cancel()
  }
}

declare global {
  interface ShadowRoot {
    getAnimations(): Animation[]
  }

  interface Window {
    scrittoStudio?: {
      capture: () => Promise<HTMLCanvasElement>
      seek: (ms: number) => void
      span: () => number
      strip: () => Promise<void>
    }
  }
}

initStudio(document)
