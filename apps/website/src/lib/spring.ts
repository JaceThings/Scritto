// Bounce is Apple's parameter, 1 - damping ratio, so the slider stays
// continuous with the two curves the core ships: 0.20 default, 0.30 bouncy.
export const BOUNCE_DEFAULT = 0.2
export const BOUNCE_BOUNCY = 0.3

const OMEGA_PER_ZETA = 11.19
// Below damping ratio 0.7 the frequency tracks a fixed decay rate, so a loose
// spring still settles inside the window.
const SETTLED_DECAY = 5.48
const SAMPLES = 48

const response = (zeta: number, omega: number, t: number) => {
  if (zeta >= 1) return 1 - Math.exp(-omega * t) * (1 + omega * t)
  const damped = omega * Math.sqrt(1 - zeta * zeta)
  return (
    1 -
    Math.exp(-zeta * omega * t) *
      (Math.cos(damped * t) + ((zeta * omega) / damped) * Math.sin(damped * t))
  )
}

/** A CSS `linear()` easing for the given bounce, in the core's `transition.easing` shape. */
export const springEasing = (bounce: number) => {
  const zeta = Math.min(1, Math.max(0.02, 1 - bounce))
  const omega = Math.max(OMEGA_PER_ZETA * zeta, SETTLED_DECAY / zeta)
  const points = new Array<string>(SAMPLES)
  for (let i = 0; i < SAMPLES; i++) {
    const t = i / (SAMPLES - 1)
    points[i] = response(zeta, omega, t).toFixed(4).replace(/\.?0+$/, '') || '0'
  }
  // The last stop has to land on 1 or every glyph settles off its target.
  points[SAMPLES - 1] = '1'
  return `linear(${points.join(',')})`
}
