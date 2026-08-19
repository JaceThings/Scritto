import '@scritto/core'
import type { Scritto, Trend } from '@scritto/core'
// The roll's shape lives in one module-level object rather than per instance.
// The site resolves `@scritto/core` to this same source, so the studio holds the
// object the element itself reads.
import { CONFIG } from '../../../../packages/core/src/const'
import { captureHost, download } from '../lib/raster'

const SCRUB_STEPS = 1000

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
  const dims = find<HTMLParagraphElement>('dims')

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
    out('time').textContent = `${seconds(at)} / ${seconds(span)}`
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
  const roll = (keepPosition: boolean) => {
    stop()
    const fraction = keepPosition && span > 0 ? at / span : 0
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
    })
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
      seek(at + (now - last))
      if (at >= span) {
        stop()
        return
      }
      tick(now)
    })
  }

  play.addEventListener('click', () => {
    if (playing) {
      stop()
      return
    }
    playing = true
    play.textContent = '❚❚'
    play.setAttribute('aria-label', 'Pause')
    if (at >= span) seek(0)
    tick(performance.now())
  })

  scrub.addEventListener('input', () => {
    stop()
    seek((Number(scrub.value) / SCRUB_STEPS) * span)
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

  find<HTMLButtonElement>('export').addEventListener('click', () => {
    void shoot().then((canvas) => download(canvas, `scritto-${Date.now()}.png`))
  })

  roll(false)
  scrub.value = String(SCRUB_STEPS * 0.4)
  queueMicrotask(() => seek(span * 0.4))

  window.scrittoStudio = { capture: shoot, seek, span: () => span }

  return () => {
    stop()
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
    }
  }
}
