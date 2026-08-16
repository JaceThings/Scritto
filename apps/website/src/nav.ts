// Ported from Lisse's root route: the header and footer never unmount, the body
// cross-fades on route change, and the footer slides to its new position while
// the incoming body is still hidden.

import { playClick } from './sounds'

const FADE_MS = 250
const FOOTER_SLIDE_MS = 350
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'
// Governs the Home link's enter/exit and the sibling links sliding to fill it.
const NAV_LAYOUT_MS = 420
const NAV_EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)'

export type PageInit = (root: ParentNode) => (() => void) | void

const normalize = (pathname: string) => {
  const file = pathname.slice(pathname.lastIndexOf('/') + 1)
  if (file === 'playground.html') return '/playground'
  if (file === '' || file === 'index.html') return '/'
  return pathname
}

const settled = (animation: Animation) =>
  animation.finished.catch(() => {}).then(() => undefined)

const documents = new Map<string, Document>()

const load = async (url: URL) => {
  const key = url.pathname
  const cached = documents.get(key)
  if (cached) return cached
  const res = await fetch(url.href, { headers: { accept: 'text/html' } })
  if (!res.ok) throw new Error(`${url.pathname} ${res.status}`)
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html')
  documents.set(key, doc)
  return doc
}

export const startRouter = (pages: Record<string, PageInit>) => {
  const page = document.querySelector<HTMLElement>('#page')
  const footer = document.querySelector<HTMLElement>('footer')
  const nav = document.querySelector<HTMLElement>('#site-nav')
  if (!page || !footer) return

  let route = normalize(location.pathname)
  let dispose = pages[route]?.(document) ?? undefined
  let busy = false

  const slots = () => [...(nav?.querySelectorAll<HTMLElement>('.nav-slot') ?? [])]
  const homeSlot = nav?.querySelector<HTMLElement>('[data-nav-home]') ?? null

  /** Shows Home everywhere but the home page, sliding the other links across. */
  const syncNav = (next: string) => {
    if (!homeSlot || !nav) return
    const wanted = next !== '/'
    if (wanted === !homeSlot.hidden) return

    const others = slots().filter((slot) => slot !== homeSlot)
    const before = new Map(others.map((slot) => [slot, slot.getBoundingClientRect().left]))

    if (wanted) {
      homeSlot.hidden = false
    } else {
      // Take the outgoing link out of flow first, so the siblings' target
      // positions are final before they start sliding.
      const rect = homeSlot.getBoundingClientRect()
      const navRect = nav.getBoundingClientRect()
      homeSlot.style.position = 'absolute'
      homeSlot.style.left = `${rect.left - navRect.left}px`
      homeSlot.style.top = `${rect.top - navRect.top}px`
    }

    for (const slot of others) {
      const shift = (before.get(slot) ?? 0) - slot.getBoundingClientRect().left
      if (Math.abs(shift) < 0.5) continue
      slot.animate(
        { transform: [`translateX(${shift}px)`, 'none'] },
        { duration: NAV_LAYOUT_MS, easing: NAV_EASE },
      )
    }

    if (wanted) {
      homeSlot.animate(
        { opacity: [0, 1], transform: ['translateX(-6px)', 'none'] },
        { duration: NAV_LAYOUT_MS, easing: NAV_EASE },
      )
      return
    }
    const exit = homeSlot.animate(
      { opacity: [1, 0], transform: ['none', 'translateX(-6px)'] },
      { duration: NAV_LAYOUT_MS, easing: NAV_EASE },
    )
    void settled(exit).then(() => {
      homeSlot.hidden = true
      homeSlot.style.position = ''
      homeSlot.style.left = ''
      homeSlot.style.top = ''
    })
  }

  const navigate = async (url: URL, push: boolean) => {
    if (busy) return
    busy = true
    // The entrance cascade belongs to the first load; route changes cross-fade.
    document.documentElement.classList.add('routed')
    try {
      const doc = await load(url)
      const next = doc.querySelector<HTMLElement>('#page')
      if (!next) {
        location.href = url.href
        return
      }

      await settled(page.animate({ opacity: [1, 0] }, { duration: FADE_MS, easing: EASE }))
      page.style.opacity = '0'

      const footerBefore = footer.getBoundingClientRect().top

      dispose?.()
      dispose = undefined
      page.className = next.className
      page.replaceChildren(...next.cloneNode(true).childNodes)
      document.title = doc.title
      if (push) history.pushState(null, '', url)
      route = normalize(url.pathname)
      syncNav(route)
      dispose = pages[route]?.(document) ?? undefined

      const shift = footerBefore - footer.getBoundingClientRect().top
      if (Math.abs(shift) > 0.5) {
        footer.animate(
          { transform: [`translateY(${shift}px)`, 'none'] },
          { duration: FOOTER_SLIDE_MS, easing: EASE },
        )
      }

      const reveal = page.animate(
        { opacity: [0, 1] },
        { duration: FADE_MS, easing: EASE, delay: FOOTER_SLIDE_MS, fill: 'backwards' },
      )
      void settled(reveal).then(() => {
        page.style.opacity = ''
      })
    } catch {
      location.href = url.href
    } finally {
      busy = false
    }
  }

  // Scrolls to the top before navigating, so the persistent header is on screen
  // when the body swaps.
  const leave = (url: URL, sameRoute: boolean) => {
    const go = () => {
      if (sameRoute) return
      void navigate(url, true)
    }
    if (window.scrollY <= 0) {
      go()
      return
    }
    let started = false
    const once = () => {
      if (started) return
      started = true
      go()
    }
    // `scrollend` is missing on older Safari — feature-detect, and fall back to
    // a distance-scaled timeout.
    if (window.onscrollend !== undefined) {
      window.addEventListener('scrollend', once, { once: true })
      // Safety net: scrollend can be missed on a re-click mid-scroll.
      window.setTimeout(once, 900)
    } else {
      window.setTimeout(once, Math.min(700, window.scrollY * 0.6))
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (event.button !== 0) return
    const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>('.footer-link')
    const link = anchor?.hasAttribute('data-route') ? anchor : null
    if (!link) {
      if (anchor) playClick()
      return
    }
    const url = new URL(link.href, location.href)
    if (url.origin !== location.origin) return
    const sameRoute = normalize(url.pathname) === route
    // Silent when it's the route we're already on — the link still scrolls to
    // the top, but nothing navigated.
    if (!sameRoute) playClick()
    event.preventDefault()
    leave(url, sameRoute)
  })

  window.addEventListener('popstate', () => {
    const url = new URL(location.href)
    if (normalize(url.pathname) === route) return
    void navigate(url, false)
  })
}
