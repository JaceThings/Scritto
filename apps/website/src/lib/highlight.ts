import type { MarkHandle } from '@highlighters/core'

const STYLE_ID = 'selection-highlight-styles'
const TOUCH = '(hover: none) and (pointer: coarse)'
const DARK = '(prefers-color-scheme: dark)'

const TIP = { angle: 7, overshoot: 7.5, angleJitter: 10 }

/**
 * The page's own ink. Inverted for dark, where `multiply` sinks any ink toward
 * black and `screen` lifts a cream band the light text stays legible on. `vivid`
 * is set either way because `update` merges: left out, light keeps dark's screen
 * layer and washes out to nothing.
 */
const LIGHT = { color: 'rgb(115, 87, 74)', opacity: 0.45, vivid: false, tip: TIP } as const
const DARK_INK = { color: 'rgb(254, 241, 223)', opacity: 0.35, vivid: 'screen', tip: TIP } as const

const isDark = () =>
  document.documentElement.dataset.theme === 'dark' ||
  (document.documentElement.dataset.theme !== 'light' && matchMedia(DARK).matches)

const ink = () => (isDark() ? DARK_INK : LIGHT)

/**
 * `::selection` is only suppressed once the overlay is actually painting, so
 * the browser's own highlight stands in for the first selection (and if the
 * script never loads).
 */
export const startSelectionHighlight = () => {
  if (matchMedia(TOUCH).matches) return () => {}

  let stopped = false
  let mark: MarkHandle | undefined
  let scheme: MediaQueryList | undefined
  let themed: MutationObserver | undefined
  let restyle: (() => void) | undefined

  const install = ({ highlightSelection }: typeof import('@highlighters/core')) => {
    if (stopped || mark) return

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = 'html.selection-highlight-ready ::selection { background-color: transparent; color: inherit }'
      document.head.append(style)
    }
    document.documentElement.classList.add('selection-highlight-ready')

    mark = highlightSelection(ink())
    scheme = matchMedia(DARK)
    restyle = () => mark?.update(ink())
    scheme.addEventListener('change', restyle)
    themed = new MutationObserver(restyle)
    themed.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  }

  const drop = () => {
    document.removeEventListener('selectstart', onSelectStart)
    document.removeEventListener('selectionchange', onSelectionChange)
  }

  const load = () => {
    drop()
    void import('@highlighters/core').then(install)
  }

  // The DOM event is `selectstart` (not `selectionstart`). It covers drag-select
  // and Chromium Ctrl/Cmd+A; Firefox Select All never fires it (bug 1742153), so
  // `selectionchange` is the keyboard fallback. `pointerdown` would fetch on
  // clicks that never select.
  const onSelectStart = () => load()
  const onSelectionChange = () => {
    if (getSelection()?.isCollapsed !== false) return
    load()
  }

  document.addEventListener('selectstart', onSelectStart, { once: true })
  document.addEventListener('selectionchange', onSelectionChange)

  return () => {
    stopped = true
    drop()
    if (scheme && restyle) scheme.removeEventListener('change', restyle)
    themed?.disconnect()
    mark?.remove()
    document.documentElement.classList.remove('selection-highlight-ready')
  }
}
