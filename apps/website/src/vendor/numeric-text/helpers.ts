import type { Transition } from './types'
import { SPACE } from './const'

export const BROWSER = typeof window !== 'undefined'
export const ServerSafeHTMLElement = BROWSER ? HTMLElement : (class {} as unknown as typeof HTMLElement)
export const isReducedMotion = () => {
  return BROWSER && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export const createEl = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const el = document.createElement(tag)
  el.setAttribute('aria-hidden', 'true')
  if (className) el.className = className
  if (text) el.textContent = text
  return el
}

export const getRect = (el: HTMLElement) => el.getBoundingClientRect()

export const cancelAnim = (el: HTMLElement) => {
  for (const a of el.getAnimations()) a.cancel()
}

export const flip = (el: HTMLElement, dx: number, transition: Transition) => {
  if (!dx) return
  cancelAnim(el)
  el.animate(
    { transform: [`translateX(${dx}px)`, ''] },
    {
      duration: transition.duration,
      easing: transition.easing,
      fill: 'both',
    },
  )
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const splitGraphemes = (value: string): string[] => {
  const result: string[] = []
  for (const item of segmenter.segment(value)) {
    result.push(item.segment === ' ' ? SPACE : item.segment)
  }
  return result
}

export const diff = (prev: HTMLElement[], newValue: string) => {
  const curr = splitGraphemes(newValue)

  const lenOld = prev.length
  const lenNew = curr.length

  // 1. PREFIX SCAN
  let start = 0
  while (start < lenOld && start < lenNew && prev[start].textContent === curr[start]) {
    start++
  }

  // 2. SUFFIX SCAN
  let end = 0
  const maxSuffix = Math.min(lenOld - start, lenNew - start)
  while (end < maxSuffix) {
    if (prev[lenOld - 1 - end].textContent !== curr[lenNew - 1 - end]) break
    end++
  }

  // 3. MIDDLE EXTRACTION
  const middleLabels = curr.slice(start, lenNew - end)

  return { prefixCount: start, suffixCount: end, middleLabels }
}
