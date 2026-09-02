// Only `#page` swaps: the old body fades out, the footer slides to its new
// position while the new body is hidden, then that fades in.

import { playClick } from './sounds'

const FADE_MS = 250
const FOOTER_SLIDE_MS = 350
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'
const NAV_MS = 420
const NAV_EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)'
const NAV_SHIFT = 6

export type PageInit = (root: ParentNode) => (() => void) | void
export type PageLoad = () => Promise<PageInit>

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

const hrefs = (root: ParentNode) =>
  [...root.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map((link) => link.href)

// A page only links the sheets it needs, so a client-side hop has to bring
// the destination's extra CSS with it or the new body paints unstyled.
const ensureSheets = (doc: Document) => {
  const have = new Set(hrefs(document))
  return Promise.all(
    hrefs(doc)
      .filter((href) => !have.has(href))
      .map(
        (href) =>
          new Promise<void>((resolve) => {
            const link = document.createElement('link')
            link.rel = 'stylesheet'
            link.href = href
            link.addEventListener('load', () => resolve(), { once: true })
            link.addEventListener('error', () => resolve(), { once: true })
            document.head.append(link)
          }),
      ),
  )
}

/**
 * Home comes and goes with the route. Leaving, it is taken out of the flow
 * first, so the siblings close the gap while it fades where it stood.
 */
const toggleHome = (nav: HTMLElement, show: boolean) => {
  const home = nav.querySelector<HTMLElement>('.nav-home')
  if (!home || home.hidden === !show) return
  const siblings = [...nav.querySelectorAll<HTMLElement>('.nav-slot:not(.nav-home)')]
  const before = siblings.map((el) => el.getBoundingClientRect().left)
  const timing = { duration: NAV_MS, easing: NAV_EASE }
  if (show) {
    home.hidden = false
    home.animate({ opacity: [0, 1], transform: [`translateX(${-NAV_SHIFT}px)`, 'none'] }, timing)
  } else {
    const { left, top } = home.getBoundingClientRect()
    const origin = nav.getBoundingClientRect()
    home.style.cssText = `position:absolute;left:${left - origin.left}px;top:${top - origin.top}px`
    const fade = home.animate({ opacity: [1, 0], transform: ['none', `translateX(${-NAV_SHIFT}px)`] }, timing)
    void settled(fade).then(() => {
      home.hidden = true
      home.style.cssText = ''
    })
  }
  siblings.forEach((el, i) => {
    const dx = before[i] - el.getBoundingClientRect().left
    if (Math.abs(dx) > 0.5) el.animate({ transform: [`translateX(${dx}px)`, 'none'] }, timing)
  })
}

export const startRouter = (pages: Record<string, PageLoad>) => {
  const page = document.querySelector<HTMLElement>('#page')
  const footer = document.querySelector<HTMLElement>('footer')
  const nav = footer?.querySelector<HTMLElement>('#site-nav')
  if (!page || !footer || !nav) return

  let route = normalize(location.pathname)
  // A direct hit on playground.html is the same page; the bar should not say so.
  if (route !== location.pathname) history.replaceState(null, '', route + location.search + location.hash)
  let dispose: (() => void) | undefined
  let gen = 0
  const home = nav.querySelector<HTMLElement>('.nav-home')
  if (home) home.hidden = route === '/'

  const enter = async (path: string, root: ParentNode, token: number) => {
    const loadPage = pages[path]
    if (!loadPage) return
    const init = await loadPage()
    if (token !== gen) return
    dispose = init(root) ?? undefined
  }

  void enter(route, document, gen)

  const navigate = async (url: URL, push: boolean) => {
    const token = ++gen
    document.documentElement.classList.add('routed')
    const nextRoute = normalize(url.pathname)
    toggleHome(nav, nextRoute !== '/')
    // Kick the destination module now so it overlaps the HTML fetch instead of
    // waiting for it — first paint of the new page still waits on both.
    const ready = pages[nextRoute]?.()
    try {
      const doc = await load(url)
      if (token !== gen) return
      const next = doc.querySelector<HTMLElement>('#page')
      if (!next) {
        location.href = url.href
        return
      }

      const sheets = ensureSheets(doc)
      await settled(page.animate({ opacity: [1, 0] }, { duration: FADE_MS, easing: EASE }))
      if (token !== gen) return
      await sheets
      if (token !== gen) return
      page.style.opacity = '0'

      const footerBefore = footer.getBoundingClientRect().top

      dispose?.()
      dispose = undefined
      page.className = next.className
      page.replaceChildren(...next.cloneNode(true).childNodes)
      document.title = doc.title
      if (push) history.pushState(null, '', nextRoute + url.search + url.hash)
      route = nextRoute
      const init = ready ? await ready : undefined
      if (token !== gen) return
      dispose = init?.(document) ?? undefined

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
        if (token !== gen) return
        page.style.opacity = ''
      })
    } catch {
      if (token !== gen) return
      location.href = url.href
    }
  }

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
    // `scrollend` is missing on older Safari; fall back to a scaled timeout.
    if (window.onscrollend !== undefined) {
      window.addEventListener('scrollend', once, { once: true })
      window.setTimeout(once, 900)
    } else {
      window.setTimeout(once, Math.min(700, window.scrollY * 0.6))
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (event.button !== 0) return
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('.footer-link') : null
    const link = anchor?.hasAttribute('data-route') ? anchor : null
    if (!link) {
      if (anchor) playClick()
      return
    }
    const url = new URL(link.href, location.href)
    if (url.origin !== location.origin) return
    const sameRoute = normalize(url.pathname) === route
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
