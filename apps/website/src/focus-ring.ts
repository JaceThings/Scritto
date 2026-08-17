import { APPLE_SMOOTHING, generatePath } from '@lisse/core'

// This site's page-coordinate squircle overlay on an absolute SVG so
// scroll does not need a listener. Tracks the keyboard-focused
// `[data-focus-ring]`. Pointer focus leaves no ring. Stages sit on a
// straight row edge, so their bottom radii stay 0; compact controls
// keep a uniform radius. Corner radii spring with the box so a capsule
// does not go square-bottomed before it has grown into the stage.

const RING = '[data-focus-ring]'
const SECTION = '[data-focus-section]'

const SPRING = { stiffness: 1100, damping: 60, mass: 0.4 }
const FADE_IN_MS = 180
const FADE_OUT_MS = 180
const FADE_IN_EASE = 'cubic-bezier(0.2, 0, 0, 1)'
const FADE_OUT_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'
const STROKE = 2
const RADIUS = 14

const NAV_KEYS = new Set([
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
])

const BOX_KEYS = ['x', 'y', 'w', 'h'] as const
const CORNER_KEYS = ['tl', 'tr', 'br', 'bl'] as const

type Rect = { x: number; y: number; w: number; h: number }
type Radii = { tl: number; tr: number; br: number; bl: number }

const hostOf = (el: HTMLElement | null) => el?.closest<HTMLElement>(RING) ?? null

const surfaceOf = (el: HTMLElement) =>
  el.querySelector<HTMLElement>('[data-focus-surface]') ?? el

const num = (value: string | undefined) => {
  if (value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const padOf = (el: HTMLElement) => {
  const inset = Number(el.dataset.focusInset) || 0
  const insetX = el.dataset.focusInsetX !== undefined ? Number(el.dataset.focusInsetX) : inset
  const insetY = el.dataset.focusInsetY !== undefined ? Number(el.dataset.focusInsetY) : inset
  return { insetX, insetY }
}

const radiiOf = (el: HTMLElement): Radii => {
  const { insetX, insetY } = padOf(el)
  const nest = Math.min(insetX, insetY)
  const all = num(el.dataset.focusRadius)
  const top = num(el.dataset.focusRadiusTop)
  const bottom = num(el.dataset.focusRadiusBottom)
  const fallback = all ?? RADIUS
  const t = (top ?? fallback) + nest
  const b = (bottom ?? fallback) + nest
  return {
    tl: Math.max(0, num(el.dataset.focusRadiusTl) ?? t),
    tr: Math.max(0, num(el.dataset.focusRadiusTr) ?? t),
    br: Math.max(0, num(el.dataset.focusRadiusBr) ?? b),
    bl: Math.max(0, num(el.dataset.focusRadiusBl) ?? b),
  }
}

const cornerOf = (n: number, cap: number) => ({
  radius: Math.min(Math.max(0, n), cap),
  smoothing: APPLE_SMOOTHING,
})

const pathOf = (w: number, h: number, radii: Radii) => {
  const cap = Math.min(w, h) / 2.5
  const d = generatePath(w, h, {
    topLeft: cornerOf(radii.tl, cap),
    topRight: cornerOf(radii.tr, cap),
    bottomRight: cornerOf(radii.br, cap),
    bottomLeft: cornerOf(radii.bl, cap),
  })
  // After a rounded corner the template lines to the next corner's p.
  // A 0-radius neighbour makes that (w, 0) — a square tip on the curve.
  if (radii.br < 0.05 && radii.tr > 0) return d.replace(/ L [\d.]+ 0\.0000(?= L )/, '')
  return d
}

const measure = (el: HTMLElement): Rect => {
  const surface = surfaceOf(el)
  const r = surface.getBoundingClientRect()
  const { insetX, insetY } = padOf(el)
  return {
    x: r.left + window.scrollX - insetX,
    y: r.top + window.scrollY - insetY,
    w: r.width + insetX * 2,
    h: r.height + insetY * 2,
  }
}

const sectionOf = (el: HTMLElement | null) => el?.closest(SECTION) ?? null

const isMidExit = (el: HTMLElement) => {
  let node: HTMLElement | null = el.parentElement
  while (node && node !== document.body) {
    // The entrance cascade animates opacity on `.stagger`. That is not an
    // exit — hiding the ring for it would leave later cards with no overlay.
    if (node.classList.contains('stagger')) {
      node = node.parentElement
      continue
    }
    const op = parseFloat(getComputedStyle(node).opacity)
    if (Number.isFinite(op) && op < 1) return true
    node = node.parentElement
  }
  return false
}

export const startFocusRing = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('aria-hidden', 'true')
  Object.assign(svg.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    overflow: 'visible',
    pointerEvents: 'none',
    zIndex: '9999',
    opacity: '0',
  })
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'var(--color-text-primary)')
  path.setAttribute('stroke-width', String(STROKE))
  svg.append(path)
  document.body.append(svg)

  let visible = false
  let fadingOut = false
  let target: HTMLElement | null = null
  let pending: { rect: Rect; radii: Radii } | null = null
  let modality: 'keyboard' | 'mouse' = 'mouse'
  let fade: Animation | null = null
  let focusOutRaf = 0

  const cur = {
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    vx: 0,
    vy: 0,
    vw: 0,
    vh: 0,
    tl: RADIUS,
    tr: RADIUS,
    br: RADIUS,
    bl: RADIUS,
    vtl: 0,
    vtr: 0,
    vbr: 0,
    vbl: 0,
  }
  const dest = { x: 0, y: 0, w: 0, h: 0, tl: RADIUS, tr: RADIUS, br: RADIUS, bl: RADIUS }

  const paint = () => {
    const w = Math.max(0, cur.w)
    const h = Math.max(0, cur.h)
    svg.style.width = `${w}px`
    svg.style.height = `${h}px`
    svg.style.transform = `translate(${cur.x}px, ${cur.y}px)`
    if (w === 0 || h === 0) {
      path.setAttribute('d', '')
      return
    }
    path.setAttribute('d', pathOf(w, h, { tl: cur.tl, tr: cur.tr, br: cur.br, bl: cur.bl }))
  }

  const snap = (next: Rect, nextR: Radii) => {
    dest.x = cur.x = next.x
    dest.y = cur.y = next.y
    dest.w = cur.w = next.w
    dest.h = cur.h = next.h
    dest.tl = cur.tl = nextR.tl
    dest.tr = cur.tr = nextR.tr
    dest.br = cur.br = nextR.br
    dest.bl = cur.bl = nextR.bl
    cur.vx = cur.vy = cur.vw = cur.vh = 0
    cur.vtl = cur.vtr = cur.vbr = cur.vbl = 0
    paint()
  }

  const slide = (next: Rect, nextR: Radii) => {
    dest.x = next.x
    dest.y = next.y
    dest.w = next.w
    dest.h = next.h
    dest.tl = nextR.tl
    dest.tr = nextR.tr
    dest.br = nextR.br
    dest.bl = nextR.bl
  }

  const aim = (el: HTMLElement, next?: Rect) => slide(next ?? measure(el), radiiOf(el))

  const fadeTo = (to: number, duration: number, ease: string, onDone?: () => void) => {
    fade?.cancel()
    const from = parseFloat(getComputedStyle(svg).opacity) || 0
    fade = svg.animate({ opacity: [from, to] }, { duration, easing: ease, fill: 'forwards' })
    void fade.finished
      .then(() => {
        if (fade?.playState !== 'finished') return
        svg.style.opacity = String(to)
        onDone?.()
      })
      .catch(() => {})
  }

  const hide = () => {
    if (!visible) return
    visible = false
    target = null
    fadingOut = false
    pending = null
    fadeTo(0, FADE_OUT_MS, FADE_OUT_EASE)
  }

  const moveTo = (el: HTMLElement, next: Rect) => {
    const crossing = visible && sectionOf(target) !== sectionOf(el)
    const nextR = radiiOf(el)
    target = el
    if (fadingOut) {
      pending = { rect: next, radii: nextR }
      return
    }
    if (!visible) {
      snap(next, nextR)
      visible = true
      fadeTo(1, FADE_IN_MS, FADE_IN_EASE)
      kick()
      return
    }
    if (crossing) {
      fadingOut = true
      pending = { rect: next, radii: nextR }
      fadeTo(0, FADE_OUT_MS, FADE_OUT_EASE, () => {
        const held = pending
        fadingOut = false
        pending = null
        if (!held) return
        snap(held.rect, held.radii)
        fadeTo(1, FADE_IN_MS, FADE_IN_EASE)
        kick()
      })
      kick()
      return
    }
    slide(next, nextR)
    fadeTo(1, FADE_IN_MS, FADE_IN_EASE)
    kick()
  }

  const onFocusIn = (event: FocusEvent) => {
    const host = hostOf(event.target as HTMLElement | null)
    if (!host) {
      hide()
      return
    }
    cancelAnimationFrame(focusOutRaf)
    focusOutRaf = 0
    if (modality !== 'keyboard') {
      hide()
      return
    }
    moveTo(host, measure(host))
  }

  const onFocusOut = () => {
    cancelAnimationFrame(focusOutRaf)
    focusOutRaf = requestAnimationFrame(() => {
      focusOutRaf = 0
      const active = document.activeElement as HTMLElement | null
      if (hostOf(active)) return
      hide()
    })
  }

  const onKey = (event: KeyboardEvent) => {
    if (!NAV_KEYS.has(event.key)) return
    if (event.metaKey || event.ctrlKey || event.altKey) return
    modality = 'keyboard'
  }

  const onPointer = () => {
    modality = 'mouse'
    hide()
  }

  let last = performance.now()
  let raf = 0
  const follow = (now: number) => {
    const dt = Math.min(0.032, (now - last) / 1000)
    last = now
    if (visible && target && !fadingOut) {
      if (!target.isConnected || isMidExit(target)) hide()
      else aim(target)
    }
    if (visible || fadingOut) {
      const steps = Math.max(1, Math.ceil(dt / 0.004))
      const h = dt / steps
      for (let i = 0; i < steps; i++) {
        for (const key of BOX_KEYS) {
          const vel = `v${key}` as const
          const force =
            (-SPRING.stiffness * (cur[key] - dest[key]) - SPRING.damping * cur[vel]) / SPRING.mass
          cur[vel] += force * h
          cur[key] += cur[vel] * h
        }
        for (const key of CORNER_KEYS) {
          const vel = `v${key}` as const
          const force =
            (-SPRING.stiffness * (cur[key] - dest[key]) - SPRING.damping * cur[vel]) / SPRING.mass
          cur[vel] += force * h
          cur[key] += cur[vel] * h
        }
      }
      paint()
      raf = requestAnimationFrame(follow)
    } else {
      raf = 0
    }
  }

  const kick = () => {
    if (raf !== 0) return
    last = performance.now()
    raf = requestAnimationFrame(follow)
  }

  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('focusout', onFocusOut)
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('pointerdown', onPointer, true)

  return () => {
    cancelAnimationFrame(raf)
    cancelAnimationFrame(focusOutRaf)
    fade?.cancel()
    svg.remove()
    document.removeEventListener('focusin', onFocusIn)
    document.removeEventListener('focusout', onFocusOut)
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('pointerdown', onPointer, true)
  }
}
