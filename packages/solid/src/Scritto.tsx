import '@scritto/core'
import type { ScrittoProps, Scritto as ScrittoElement } from '@scritto/core'
import { createEffect, onMount, splitProps, type JSX } from 'solid-js'
import { isServer } from 'solid-js/web'

type Props = ScrittoProps & JSX.HTMLAttributes<HTMLElement>
const Scritto = (props: Props) => {
  const [p, rest] = splitProps(props, ['value', 'trend', 'transition', 'respectMotionPreference', 'bounce', 'edgeFade', 'animated'])

  let ref: ScrittoElement | undefined
  let isMounted = false

  createEffect(() => {
    if (ref) ref.update(p.value, isMounted && (p.animated ?? true))
  })

  createEffect(() => {
    if (ref) {
      ref.setOptions({
        trend: p.trend,
        transition: p.transition,
        respectMotionPreference: p.respectMotionPreference,
        bounce: p.bounce,
        edgeFade: p.edgeFade,
      })
    }
  })

  onMount(() => {
    isMounted = true
  })

  return (
    <scritto-text ref={ref} role="img" aria-label={p.value + ''} {...rest}>
      {isServer ? p.value : ''}
    </scritto-text>
  )
}

export default Scritto
