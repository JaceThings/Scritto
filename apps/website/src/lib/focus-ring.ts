import { APPLE_SMOOTHING, generatePath } from '@lisse/core'

// Squircle overlay tracking the keyboard-focused `[data-focus-ring]`, drawn in
// page coordinates so scrolling needs no listener. The 14px default is
// concentric with the site's 8px surfaces, whose hit areas pad them by 6px.

const RING = '[data-focus-ring]'
const SECTION = '[data-focus-section]'

const SPRING = { stiffness: 1100, damping: 60, mass: 0.4 }
const FADE_IN: KeyframeAnimationOptions = {
  duration: 180,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
  fill: 'forwards',
}
const FADE_OUT: KeyframeAnimationOptions = { ...FADE_IN, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }
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

const KEYS = ['x', 'y', 'w', 'h', 'tl', 'tr', 'br', 'bl'] as const
type Key = (typeof KEYS)[number]
type State = Record<Key, number>

const zeroed = () => ({ x: 0, y: 0, w: 0, h: 0, tl: 0, tr: 0, br: 0, bl: 0 }) satisfies State

const hostOf = (el: EventTarget | null) => (el instanceof Element ? el.closest<HTMLElement>(RING) : null)
const sectionOf = (el: Element | null) => el?.closest(SECTION) ?? null

const num = (value: string | undefined) => {
  const n = Number(value)
  return value === undefined || value === '' || !Number.isFinite(n) ? null : n
}

const insetOf = (el: HTMLElement) => ({
  x: num(el.dataset.focusInsetX) ?? 0,
  y: num(el.dataset.focusInsetY) ?? 0,
})

const stateOf = (el: HTMLElement) => {
  const r = el.getBoundingClientRect()
  const inset = insetOf(el)
  const base = num(el.dataset.focusRadius) ?? RADIUS
  const nest = Math.min(inset.x, inset.y)
  const top = (num(el.dataset.focusRadiusTop) ?? base) + nest
  const bottom = (num(el.dataset.focusRadiusBottom) ?? base) + nest
  return {
    x: r.left + window.scrollX - inset.x,
    y: r.top + window.scrollY - inset.y,
    w: r.width + inset.x * 2,
    h: r.height + inset.y * 2,
    tl: top,
    tr: top,
    br: bottom,
    bl: bottom,
  } satisfies State
}

// generatePath opens each side with a line back to where the previous corner
// would have ended if the radii matched: harmless to a fill, a spur to a
// stroke. Each pair's second line is the real edge.
const trimSpurs = (d: string) => {
  const cmds = d.match(/[A-Za-z][^A-Za-z]*/g) ?? []
  const kept: string[] = []
  let i = 0
  const isLine = (cmd: string | undefined) => cmd?.[0] === 'L'
  const takeCorner = () => {
    while (i < cmds.length && /[ac]/i.test(cmds[i][0])) kept.push(cmds[i++])
  }

  kept.push(cmds[i++] ?? '')
  if (isLine(cmds[i])) kept.push(cmds[i++])
  for (let side = 0; side < 3; side++) {
    takeCorner()
    if (isLine(cmds[i]) && isLine(cmds[i + 1])) i++
    if (isLine(cmds[i])) kept.push(cmds[i++])
  }
  takeCorner()
  while (i < cmds.length) kept.push(cmds[i++])
  return kept.join('').trim()
}

const pathOf = (s: State) => {
  const cap = Math.min(s.w, s.h) / 2.5
  const corner = (n: number) => ({
    radius: Math.min(Math.max(0, n), cap),
    smoothing: APPLE_SMOOTHING,
  })
  return trimSpurs(
    generatePath(s.w, s.h, {
      topLeft: corner(s.tl),
      topRight: corner(s.tr),
      bottomRight: corner(s.br),
      bottomLeft: corner(s.bl),
    }),
  )
}

// The ring fades with its target, so it inherits whatever the ancestors are
// doing — entrance cascade, route cross-fade, collapse — without naming a case.
const inheritedOpacity = (el: HTMLElement) => {
  let opacity = 1
  for (let node: HTMLElement | null = el; node && node !== document.body; node = node.parentElement) {
    const own = parseFloat(getComputedStyle(node).opacity)
    if (Number.isFinite(own)) opacity *= own
  }
  return opacity
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

  const cur = zeroed()
  const vel = zeroed()
  const dest = zeroed()

  let visible = false
  let fadingOut = false
  let target: HTMLElement | null = null
  let pending: State | null = null
  let modality: 'keyboard' | 'mouse' = 'mouse'
  let fade: Animation | null = null
  let focusOutRaf = 0
  let raf = 0
  let last = 0

  const paint = () => {
    const w = Math.max(0, cur.w)
    const h = Math.max(0, cur.h)
    svg.style.width = `${w}px`
    svg.style.height = `${h}px`
    svg.style.transform = `translate(${cur.x}px, ${cur.y}px)`
    path.setAttribute('d', w === 0 || h === 0 ? '' : pathOf({ ...cur, w, h }))
  }

  const snap = (next: State) => {
    if (target) path.style.opacity = String(inheritedOpacity(target))
    for (const key of KEYS) {
      cur[key] = dest[key] = next[key]
      vel[key] = 0
    }
    paint()
  }

  const step = (dt: number) => {
    const steps = Math.max(1, Math.ceil(dt / 0.004))
    const h = dt / steps
    for (let i = 0; i < steps; i++) {
      for (const key of KEYS) {
        const force =
          (-SPRING.stiffness * (cur[key] - dest[key]) - SPRING.damping * vel[key]) / SPRING.mass
        vel[key] += force * h
        cur[key] += vel[key] * h
      }
    }
    paint()
  }

  const follow = (now: number) => {
    const dt = Math.min(0.032, (now - last) / 1000)
    last = now
    if (visible && target && !fadingOut) {
      if (!target.isConnected) hide()
      else {
        Object.assign(dest, stateOf(target))
        path.style.opacity = String(inheritedOpacity(target))
      }
    }
    if (!visible && !fadingOut) {
      raf = 0
      return
    }
    step(dt)
    raf = requestAnimationFrame(follow)
  }

  const kick = () => {
    if (raf !== 0) return
    last = performance.now()
    raf = requestAnimationFrame(follow)
  }

  const fadeTo = (to: number, options: KeyframeAnimationOptions, onDone?: () => void) => {
    fade?.cancel()
    const from = parseFloat(getComputedStyle(svg).opacity) || 0
    fade = svg.animate({ opacity: [from, to] }, options)
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
    fadingOut = false
    target = null
    pending = null
    fadeTo(0, FADE_OUT)
  }

  const moveTo = (el: HTMLElement) => {
    const next = stateOf(el)
    const crossing = visible && sectionOf(target) !== sectionOf(el)
    target = el

    if (fadingOut) {
      pending = next
      return
    }
    if (!visible) {
      snap(next)
      visible = true
    } else if (crossing) {
      // Snap while invisible instead of sliding the full distance between groups.
      fadingOut = true
      pending = next
      fadeTo(0, FADE_OUT, () => {
        const held = pending
        fadingOut = false
        pending = null
        if (!held) return
        snap(held)
        fadeTo(1, FADE_IN)
        kick()
      })
      kick()
      return
    } else {
      Object.assign(dest, next)
    }
    fadeTo(1, FADE_IN)
    kick()
  }

  const onFocusIn = (event: FocusEvent) => {
    const host = hostOf(event.target)
    cancelAnimationFrame(focusOutRaf)
    focusOutRaf = 0
    if (!host || modality !== 'keyboard') hide()
    else moveTo(host)
  }

  const onFocusOut = () => {
    cancelAnimationFrame(focusOutRaf)
    // A Tab lands its focusin next frame; hide only if nothing caught the focus.
    focusOutRaf = requestAnimationFrame(() => {
      focusOutRaf = 0
      if (!hostOf(document.activeElement)) hide()
    })
  }

  const onKey = (event: KeyboardEvent) => {
    if (!NAV_KEYS.has(event.key) || event.metaKey || event.ctrlKey || event.altKey) return
    modality = 'keyboard'
  }

  const onPointer = () => {
    modality = 'mouse'
    hide()
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
