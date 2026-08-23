export type Value = string | number

export type Transition = {
  duration: number
  easing: string
}

export type Trend = -1 | 0 | 1

/**
 * Whether a travelling edge fades its ghosts. `auto` fades only where they
 * would reach a neighbour or leave the box a reader sees as holding the value,
 * so text with room around it fades on its own opacity and keeps its shape.
 */
export type EdgeFade = 'auto' | 'always' | 'never'

export type ScrittoOptions = {
  transition?: Partial<Transition>
  trend?: Trend
  respectMotionPreference?: boolean
  bounce?: boolean
  edgeFade?: EdgeFade
}

export type ScrittoProps = ScrittoOptions & {
  value: Value
  animated?: boolean
}
