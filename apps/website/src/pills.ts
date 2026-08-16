// Ported from Lisse's RadioPillGroup: a segmented radiogroup that wraps, with
// the hit area grown past the visible pill and the selected background
// crossfading on the same curve as the rest of a preset change.

import { playPillSelect } from './sounds'

export type PillOption<T extends string> = { value: T; label: string }

export const createPills = <T extends string>(
  mount: HTMLElement,
  options: readonly PillOption<T>[],
  initial: T,
  onPick: (value: T) => void,
) => {
  if (options.length === 4) mount.dataset.columns = '4'
  let current = initial

  const sync = () => {
    for (const [i, button] of buttons.entries()) {
      const checked = options[i].value === current
      button.setAttribute('aria-checked', String(checked))
      button.tabIndex = checked ? 0 : -1
    }
  }

  const pick = (index: number) => {
    const next = options[index].value
    if (next === current) return
    playPillSelect()
    current = next
    sync()
    onPick(current)
  }

  const buttons = options.map((option, i) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'pill'
    button.setAttribute('role', 'radio')
    const label = document.createElement('span')
    label.textContent = option.label
    button.append(label)
    button.addEventListener('click', () => pick(i))
    button.addEventListener('keydown', (event) => {
      const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
      const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
      if (!forward && !back) return
      event.preventDefault()
      const next = (i + (forward ? 1 : -1) + options.length) % options.length
      pick(next)
      buttons[next].focus()
    })
    return button
  })

  sync()
  mount.replaceChildren(...buttons)

  return {
    /** Moves the selection without firing `onPick` — for when something else already did the work. */
    set(value: T) {
      if (value === current) return
      current = value
      sync()
    },
  }
}
