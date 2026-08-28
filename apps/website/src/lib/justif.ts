export const bindJustif = (root: ParentNode = document) => {
  const paragraphs = [...root.querySelectorAll<HTMLElement>('p.text-justify')].filter(
    (p) => !p.closest('scritto-flow') && !p.querySelector('scritto-flow, scritto-text'),
  )
  if (!paragraphs.length) return () => {}

  let stopped = false
  let idleId: number | undefined
  let timeoutId: number | undefined
  let controller: { destroy: () => void } | undefined

  const start = () => {
    idleId = undefined
    timeoutId = undefined
    void Promise.all([import('justif'), import('justif/hyphenate/en-us')]).then(
      ([{ justify }, { hyphenateEnUS }]) => {
        if (stopped) return
        controller = justify(paragraphs, { hyphenate: hyphenateEnUS })
      },
    )
  }

  // rIC is after first paint; Safari has no rIC, so wait for `load` and yield.
  const schedule = () => {
    if (typeof requestIdleCallback === 'function') {
      idleId = requestIdleCallback(start)
      return
    }
    timeoutId = window.setTimeout(start, 0)
  }

  if (typeof requestIdleCallback === 'function' || document.readyState === 'complete') {
    schedule()
  } else {
    window.addEventListener('load', schedule, { once: true })
  }

  return () => {
    stopped = true
    window.removeEventListener('load', schedule)
    if (idleId !== undefined) cancelIdleCallback(idleId)
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    controller?.destroy()
  }
}
