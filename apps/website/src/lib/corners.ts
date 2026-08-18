import {
  APPLE_SMOOTHING,
  acquirePosition,
  createDropShadow,
  createSvgEffects,
  extractAndStripEffects,
  generateClipPath,
  getLayoutSize,
  hasEffects,
  mergeEffects,
  observeAnchor,
  observeResize,
  releasePosition,
  restoreStyles,
} from '@lisse/core'
import type { Measured, SmoothCornerOptions } from '@lisse/core'

const FIGURE_CORNERS: SmoothCornerOptions = {
  topLeft: { radius: 12, smoothing: APPLE_SMOOTHING },
  topRight: { radius: 12, smoothing: APPLE_SMOOTHING },
  bottomLeft: { radius: 20, smoothing: APPLE_SMOOTHING },
  bottomRight: { radius: 20, smoothing: APPLE_SMOOTHING },
}

const FIGURE_PLAIN: SmoothCornerOptions = { radius: 12, smoothing: APPLE_SMOOTHING }

const SURFACES: ReadonlyArray<[selector: string, corners: SmoothCornerOptions]> = [
  ['.install-row', { radius: 8, smoothing: APPLE_SMOOTHING }],
  ['.slider-track', { radius: 4, smoothing: APPLE_SMOOTHING }],
  ['.pill > span', { radius: 8, smoothing: APPLE_SMOOTHING }],
]

const bound = new WeakSet<HTMLElement>()

const attach = (el: HTMLElement, options: SmoothCornerOptions) => {
  if (bound.has(el)) return () => {}
  bound.add(el)

  const extracted = extractAndStripEffects(el)
  const merged = mergeEffects(extracted, undefined)
  const anchor = el.parentElement
  let effectsHandle: ReturnType<typeof createSvgEffects> | undefined
  let shadowHandle: ReturnType<typeof createDropShadow> | undefined
  let didAcquire = false
  let unobserveAnchor: (() => void) | undefined

  if (hasEffects(merged) && anchor) {
    didAcquire = acquirePosition(anchor)
    effectsHandle = createSvgEffects(anchor, el)
    if (merged.shadow) shadowHandle = createDropShadow(anchor, el)
    unobserveAnchor = observeAnchor(anchor, el)
  }

  const sync = (measured?: Measured) => {
    const { width, height } = measured ?? extracted.size ?? getLayoutSize(el)
    if (width <= 0 || height <= 0) return
    el.style.clipPath = generateClipPath(width, height, options)
    // The stylesheet radius is a first-paint fallback, and would clip the path.
    el.style.borderRadius = '0'
    if (!effectsHandle) return
    const placed = measured && 'offsetLeft' in measured ? measured : undefined
    const offset = {
      x: placed?.offsetLeft ?? el.offsetLeft,
      y: placed?.offsetTop ?? el.offsetTop,
    }
    effectsHandle.update(options, merged, width, height, offset)
    if (shadowHandle && merged.shadow) {
      shadowHandle.update(options, merged.shadow, width, height, offset)
    }
  }

  sync()
  const unobserve = observeResize(el, sync)

  return () => {
    unobserve()
    unobserveAnchor?.()
    effectsHandle?.destroy()
    shadowHandle?.destroy()
    restoreStyles(el, extracted.savedStyles)
    if (didAcquire && anchor) releasePosition(anchor)
    el.style.clipPath = ''
    el.style.borderRadius = ''
    bound.delete(el)
  }
}

/** Clips the site's rounded surfaces to a smooth-corner path, shadows following. */
export const bindCorners = (root: ParentNode = document) => {
  const bindAll = () => {
    const stops = SURFACES.flatMap(([selector, corners]) =>
      [...root.querySelectorAll<HTMLElement>(selector)].map((el) => attach(el, corners)),
    )
    for (const el of root.querySelectorAll<HTMLElement>('.figure')) {
      stops.push(attach(el, el.querySelector('.row') ? FIGURE_CORNERS : FIGURE_PLAIN))
    }
    return stops
  }

  let stops = bindAll()

  // A shadow is read off the element once and redrawn as SVG, so the surface
  // would keep the shadow of whichever theme it was bound under. Read it again
  // when the theme changes, a frame later, once the new tokens have resolved.
  let queued = 0
  const rebind = () => {
    cancelAnimationFrame(queued)
    queued = requestAnimationFrame(() => {
      for (const stop of stops) stop()
      stops = bindAll()
    })
  }
  const scheme = matchMedia('(prefers-color-scheme: dark)')
  scheme.addEventListener('change', rebind)
  const themed = new MutationObserver(rebind)
  themed.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

  return () => {
    cancelAnimationFrame(queued)
    scheme.removeEventListener('change', rebind)
    themed.disconnect()
    for (const stop of stops) stop()
  }
}
