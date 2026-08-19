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
  /**
   * Speed the outgoing glyphs up when a change lands on ink that is still
   * leaving. Off by default: it keeps a spammed value legible, but on a
   * readout driven by a drag it makes each digit vanish instead of roll.
   */
  hurry?: boolean
}

export type ScrittoProps = ScrittoOptions & {
  value: Value
  animated?: boolean
}
