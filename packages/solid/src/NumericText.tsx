import '@scritto/core'
import type { NumericTextProps, NumericText as NumericTextElement } from '@scritto/core'
import { createEffect, onMount, splitProps, type JSX } from 'solid-js'
import { isServer } from 'solid-js/web'

type Props = NumericTextProps & JSX.HTMLAttributes<HTMLElement>
const NumericText = (props: Props) => {
  const [p, rest] = splitProps(props, ['value', 'trend', 'transition', 'respectMotionPreference', 'animated'])

  let ref: NumericTextElement | undefined
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
      })
    }
  })

  onMount(() => {
    isMounted = true
  })

  return (
    <numeric-text ref={ref} role="img" aria-label={p.value + ''} {...rest}>
      {isServer ? p.value : ''}
    </numeric-text>
  )
}

export default NumericText
