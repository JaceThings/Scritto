import type { Scritto, Trend } from '@scritto/core'
import { playClick } from '../lib/sounds'
import { BOUNCE_DEFAULT, springEasing } from '../lib/spring'
import {
  STATE_CHANGE_EASE,
  SWAP_BLUR,
  SWAP_IN_MS,
  SWAP_OUT_MS,
  SWAP_SCALE,
  reducedMotion,
} from '../lib/motion'

export type StageOptions = { trend: Trend; duration: number; easing: string }

export const createStage = (
  root: ParentNode,
  id: string,
  values: string[],
  onIndex?: (index: number) => void,
) => {
  const host = root.querySelector<Scritto>(`#${id}`)!
  const trigger = host.closest('button')!
  const options: StageOptions = {
    trend: 0,
    duration: 550,
    easing: springEasing(BOUNCE_DEFAULT),
  }
  let list = values
  let index = 0

  const paint = (animate: boolean) => {
    const value = list[index % list.length]
    host.setOptions({
      respectMotionPreference: false,
      trend: options.trend,
      transition: { duration: options.duration, easing: options.easing },
    })
    host.update(value, animate)
    host.setAttribute('aria-label', value)
    onIndex?.(index % list.length)
  }

  const advance = () => {
    index += 1
    paint(true)
  }

  const replace = (next: string[]) => {
    if (!next.length) return
    list = next
    index = 0
    paint(false)
  }

  let gesture: Animation | null = null

  /**
   * A preset switch replaces the whole string, so the card hands one piece of
   * content to the next rather than rolling: it blurs away, swaps while
   * invisible, and comes back. Rolling "Creative" into "24" reads as noise.
   */
  const handoff = (change: () => void) => {
    if (reducedMotion()) {
      change()
      return
    }
    // Read before cancelling, so an interrupted swap turns around mid-gesture.
    const css = getComputedStyle(host)
    const at: Keyframe = {
      opacity: css.opacity,
      transform: css.transform === 'none' ? 'scale(1)' : css.transform,
      filter: css.filter === 'none' ? 'blur(0px)' : css.filter,
    }
    const gone: Keyframe = {
      opacity: 0,
      transform: `scale(${SWAP_SCALE})`,
      filter: `blur(${SWAP_BLUR}px)`,
    }
    gesture?.cancel()
    // Reversed, so the leg away rides the mirror of the curve that settles it back.
    const out = host.animate([gone, at], {
      duration: SWAP_OUT_MS,
      easing: STATE_CHANGE_EASE,
      direction: 'reverse',
      fill: 'forwards',
    })
    gesture = out
    void out.finished
      .then(() => {
        if (gesture !== out) return
        change()
        const back = host.animate(
          [gone, { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' }],
          { duration: SWAP_IN_MS, easing: STATE_CHANGE_EASE },
        )
        // Only now: cancelling the held exit any earlier shows a frame of the
        // new content at rest.
        out.cancel()
        gesture = back
        void back.finished
          .then(() => {
            if (gesture === back) gesture = null
          })
          .catch(() => {})
      })
      .catch(() => {})
  }

  trigger.addEventListener('click', () => {
    playClick()
    advance()
  })
  paint(false)

  return {
    host,
    advance,
    configure(patch: Partial<StageOptions>) {
      Object.assign(options, patch)
    },
    apply(patch: Partial<StageOptions>) {
      Object.assign(options, patch)
      advance()
    },
    replace,
    swap(next: string[]) {
      if (!next.length) return
      handoff(() => replace(next))
    },
    dispose() {
      gesture?.cancel()
      gesture = null
    },
  }
}
