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
   * Let the glyphs carry whatever the change displaces — the host's edge, a
   * kept run, the words after it — so neighbours wait for the new glyphs to
   * land and ride in behind them, and a paragraph reflows a line at a time.
   * Off, they slide on a plain ease from the first frame.
   */
  wave?: boolean
}

export type ScrittoProps = ScrittoOptions & {
  value: Value
  animated?: boolean
}
