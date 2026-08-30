export type Value = string | number

export type Transition = {
  /** @default 550 */
  duration: number
  /** @default "linear(0,.1052,.3155,.532,.7112,.8414,.9265,.9765,1.0023,1.013,1.0151,1.0133,1.01,1.0068,1.0041,1.0022,1.001,1)" */
  easing: string
}

export type Trend = -1 | 0 | 1

export type NumericTextOptions = {
  transition?: Partial<Transition>
  /** @default 0 */
  trend?: Trend
  /** @default true */
  respectMotionPreference?: boolean
}

export type NumericTextProps = NumericTextOptions & {
  value: Value
  /** @default true */
  animated?: boolean
}
