import type { Transition } from './types'
import { SHRINK_EASING, SPACE } from './const'

export const BROWSER = 'window' in globalThis
export const ServerSafeHTMLElement = globalThis.HTMLElement ?? class {}

let reducedMotionQuery: MediaQueryList | undefined
export const isReducedMotion = () =>
  BROWSER && (reducedMotionQuery ??= window.matchMedia('(prefers-reduced-motion: reduce)')).matches

const CLIP_OVERFLOW = /auto|scroll|hidden|clip/

export const visibleClip = (el: HTMLElement) => {
  let top = 0
  let left = 0
  let bottom = window.innerHeight
  let right = window.innerWidth
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflow, overflowX, overflowY } = getComputedStyle(node)
    if (!CLIP_OVERFLOW.test(overflow) && !CLIP_OVERFLOW.test(overflowX) && !CLIP_OVERFLOW.test(overflowY)) continue
    const rect = node.getBoundingClientRect()
    top = Math.max(top, rect.top)
    left = Math.max(left, rect.left)
    bottom = Math.min(bottom, rect.bottom)
    right = Math.min(right, rect.right)
  }
  return { top, left, bottom, right }
}

export const isOnscreen = (el: HTMLElement) => {
  const clip = visibleClip(el)
  if (clip.bottom <= clip.top || clip.right <= clip.left) return false
  const rect = el.getBoundingClientRect()
  return rect.bottom > clip.top && rect.top < clip.bottom && rect.right > clip.left && rect.left < clip.right
}

const CHAR_POOL: HTMLElement[] = []
const CHAR_POOL_MAX = 1024

export type Box = { left: number; right: number; width: number; top: number }

export const box = (left: number, width: number, top = 0): Box => ({ left, right: left + width, width, top })

export const createEl = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const el = document.createElement(tag)
  el.setAttribute('aria-hidden', 'true')
  if (className) el.className = className
  if (text) el.textContent = text
  return el
}

export const createChar = (text: string) => {
  const el = CHAR_POOL.pop()
  if (!el) return createEl('span', 'char', text)
  el.textContent = text
  return el
}

export const releaseChar = (el: HTMLElement) => {
  resetAnim(el)
  el.remove()
  if (CHAR_POOL.length < CHAR_POOL_MAX) CHAR_POOL.push(el)
}

export const cancelAnim = (el: HTMLElement) => {
  const anims = el.getAnimations()
  for (let i = 0; i < anims.length; i++) anims[i].cancel()
}

export const clearAnimStyle = (el: HTMLElement) => {
  if (!el.hasAttribute('style')) return
  el.style.removeProperty('opacity')
  el.style.removeProperty('transform')
  el.style.removeProperty('filter')
  if (!el.getAttribute('style')) el.removeAttribute('style')
}

export const resetAnim = (el: HTMLElement) => {
  cancelAnim(el)
  clearAnimStyle(el)
}

export const finishIdentityAnim = (event: AnimationPlaybackEvent) => {
  const anim = event.currentTarget
  if (anim instanceof Animation && anim.playState === 'finished') anim.cancel()
}

export const flip = (el: HTMLElement, dx: number, transition: Transition, alreadyCancelled = false) => {
  if (!dx) return
  if (!alreadyCancelled) cancelAnim(el)
  const anim = el.animate(
    { transform: [`translateX(${dx}px)`, ''] },
    { duration: transition.duration, easing: SHRINK_EASING, fill: 'both' },
  )
  anim.onfinish = finishIdentityAnim
  return anim
}

export const reconcileChildren = (parent: HTMLElement, nodes: HTMLElement[], start: number, end: number) => {
  let current = parent.firstChild
  for (let i = start; i < end; i++) {
    const node = nodes[i]
    if (node === current) current = current.nextSibling
    else parent.insertBefore(node, current)
  }
  while (current) {
    const next = current.nextSibling
    current.remove()
    current = next
  }
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

const splitGraphemes = (value: string): string[] => {
  const ascii = new Array<string>(value.length)
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code > 0x7f || (code === 0x0d && value.charCodeAt(i + 1) === 0x0a)) {
      const result: string[] = []
      for (const item of segmenter.segment(value)) result.push(item.segment === ' ' ? SPACE : item.segment)
      return result
    }
    ascii[i] = code === 0x20 ? SPACE : value[i]
  }
  return ascii
}

export const diff = (prev: HTMLElement[], newValue: string) => {
  const labels = splitGraphemes(newValue)
  const lenOld = prev.length
  const lenNew = labels.length

  let start = 0
  while (start < lenOld && start < lenNew && prev[start].textContent === labels[start]) start++

  let end = 0
  const maxSuffix = Math.min(lenOld - start, lenNew - start)
  while (end < maxSuffix && prev[lenOld - 1 - end].textContent === labels[lenNew - 1 - end]) end++

  return { prefixCount: start, suffixCount: end, labels }
}
