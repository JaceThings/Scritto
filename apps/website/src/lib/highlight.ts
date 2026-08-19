import { highlightSelection } from '@highlighters/core'

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

/**
 * `::selection` is only suppressed once this is running, so the browser's own
 * paint stands in if the script never does.
 */
export const startSelectionHighlight = () => {
  if (matchMedia(TOUCH).matches) return () => {}

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = 'html.selection-highlight-ready ::selection { background-color: transparent; color: inherit }'
    document.head.append(style)
  }
  document.documentElement.classList.add('selection-highlight-ready')

  const mark = highlightSelection(isDark() ? DARK_INK : LIGHT)
  const scheme = matchMedia(DARK)
  const restyle = () => mark.update(isDark() ? DARK_INK : LIGHT)
  scheme.addEventListener('change', restyle)
  const themed = new MutationObserver(restyle)
  themed.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

  return () => {
    scheme.removeEventListener('change', restyle)
    themed.disconnect()
    mark.remove()
    document.documentElement.classList.remove('selection-highlight-ready')
  }
}
