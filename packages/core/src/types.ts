export type Value = string | number

export type Transition = {
  duration: number
  easing: string
}

export type Trend = -1 | 0 | 1

export type ScrittoOptions = {
  transition?: Partial<Transition>
  trend?: Trend
  respectMotionPreference?: boolean
  bounce?: boolean
  /** Speed outgoing glyphs up when a change lands on ink that is still leaving. */
  hurry?: boolean
}

export type ScrittoProps = ScrittoOptions & {
  value: Value
  animated?: boolean
}
