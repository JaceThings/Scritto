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
    // Stylesheet radius is a first-paint fallback. Once the path is on, it
    // has to go: CSS intersects the two and squares the curve off.
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

/** Clip the site's rounded surfaces to a smooth-corner path and follow it with extracted shadows. */
export const bindCorners = (root: ParentNode = document) => {
  const stops: Array<() => void> = []

  for (const el of root.querySelectorAll<HTMLElement>('.install-row')) {
    stops.push(attach(el, { radius: 8, smoothing: APPLE_SMOOTHING }))
  }

  for (const el of root.querySelectorAll<HTMLElement>('.figure')) {
    const corners = el.querySelector('.row') ? FIGURE_CORNERS : { radius: 12, smoothing: APPLE_SMOOTHING }
    stops.push(attach(el, corners))
  }

  for (const el of root.querySelectorAll<HTMLElement>('.slider-track')) {
    stops.push(attach(el, { radius: 4, smoothing: APPLE_SMOOTHING }))
  }

  for (const el of root.querySelectorAll<HTMLElement>('.pill > span')) {
    stops.push(attach(el, { radius: 8, smoothing: APPLE_SMOOTHING }))
  }

  return () => {
    for (const stop of stops) stop()
  }
}
