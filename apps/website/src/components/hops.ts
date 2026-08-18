import { same } from '../lib/list'
import { STATE_CHANGE_EASE, SWAP_IN_MS, SWAP_OUT_MS, SWAP_SCALE, reducedMotion } from '../lib/motion'

const SEP = ','
const HINT_ID = 'values-hint'

/**
 * The values as one comma-separated line whose commas are drawn rather than typed.
 * Each value is its own field: a comma or Enter splits the one under the caret,
 * Backspace at its start joins it back to the one before, and the arrows step across
 * the boundaries. The trade is that a value cannot contain a comma.
 */
export const createHops = (mount: HTMLElement, onChange: (values: string[]) => void) => {
  let values: string[] = []
  let reported: string[] = []
  let current = 0

  const inputs = () => [...mount.querySelectorAll<HTMLInputElement>('.hop-value')]
  const liveHops = () => [...mount.querySelectorAll<HTMLElement>('.hop:not([data-exit])')]

  const caretTo = (input: HTMLInputElement, at: number) => {
    input.focus()
    const clamped = Math.max(0, Math.min(at, input.value.length))
    input.setSelectionRange(clamped, clamped)
  }

  const emit = () => {
    const live = values.filter(Boolean)
    // A half-typed blank is not a change: reporting one would roll the card back
    // to its first value and read the preset as Custom.
    if (same(live, reported)) return
    reported = live
    onChange(live)
  }

  const paintFace = (face: HTMLElement, value: string) => {
    face.textContent = value || '\u00a0'
  }

  const setSep = (hop: HTMLElement, show: boolean) => {
    const sep = hop.querySelector('.hop-sep')
    if (show === !!sep) return
    if (!show) {
      sep?.remove()
      return
    }
    const next = document.createElement('span')
    next.className = 'hop-sep'
    next.textContent = SEP
    next.setAttribute('aria-hidden', 'true')
    hop.append(next)
  }

  const syncCurrent = () => {
    let live = -1
    for (const hop of liveHops()) {
      const input = hop.querySelector<HTMLInputElement>('.hop-value')
      if (input?.value) live += 1
      if (input?.value && live === current) hop.setAttribute('aria-current', 'true')
      else hop.removeAttribute('aria-current')
    }
  }

  const hopFor = (value: string, index: number) => {
    const hop = document.createElement('span')
    hop.className = 'hop'

    const slot = document.createElement('span')
    slot.className = 'hop-slot'

    const face = document.createElement('span')
    face.className = 'hop-face'
    face.setAttribute('aria-hidden', 'true')
    paintFace(face, value)

    const input = document.createElement('input')
    input.className = 'hop-value'
    input.type = 'text'
    input.size = 1
    input.value = value
    input.spellcheck = false
    input.autocomplete = 'off'
    input.setAttribute('aria-label', `Value ${index + 1}`)
    input.setAttribute('aria-describedby', HINT_ID)
    slot.append(face, input)

    const splitAt = (from: number, to: number, incoming: string) => {
      const parts = incoming.split(',')
      const last = parts[parts.length - 1] ?? ''
      values.splice(
        index,
        1,
        input.value.slice(0, from) + parts[0],
        ...parts.slice(1, -1),
        last + input.value.slice(to),
      )
      render({ index: index + parts.length - 1, caret: last.length })
      emit()
    }

    input.addEventListener('focus', () => {
      // Tab into a field selects the value, painting a system fill behind the
      // word; collapse to a caret so the surface does not change.
      const collapse = () => {
        if (document.activeElement !== input) return
        if (input.selectionStart !== 0 || input.selectionEnd !== input.value.length) return
        if (!input.value.length) return
        input.setSelectionRange(0, 0)
      }
      collapse()
      requestAnimationFrame(collapse)
      setTimeout(collapse, 0)
    })

    input.addEventListener('beforeinput', (event) => {
      if (!input.isConnected) return
      if (event.inputType !== 'insertText' || !event.data?.includes(',')) return
      event.preventDefault()
      const from = input.selectionStart ?? input.value.length
      const to = input.selectionEnd ?? from
      splitAt(from, to, event.data)
    })

    input.addEventListener('input', () => {
      // IME, mobile, and raw value writes bypass beforeinput.
      if (input.value.includes(',')) {
        splitAt(0, input.value.length, input.value)
        return
      }
      values[index] = input.value
      paintFace(face, input.value)
      emit()
    })

    input.addEventListener('blur', () => {
      // A rebuild detaches fields, which blurs them: `index` would point at
      // somebody else's value by then.
      if (!input.isConnected) return
      if (values[index]?.trim() || values.length < 2) return
      values.splice(index, 1)
      render()
      emit()
    })

    input.addEventListener('paste', (event) => {
      const text = event.clipboardData?.getData('text')
      if (!text?.includes(',')) return
      event.preventDefault()
      const from = input.selectionStart ?? input.value.length
      const to = input.selectionEnd ?? from
      splitAt(from, to, text.split(',').map((part) => part.trim()).join(','))
    })

    input.addEventListener('keydown', (event) => {
      const caret = input.selectionStart ?? 0
      const collapsed = caret === input.selectionEnd
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault()
        splitAt(caret, caret, ',')
        return
      }
      if (event.key === 'Backspace' && collapsed && caret === 0 && index > 0) {
        event.preventDefault()
        const join = values[index - 1].length
        values[index - 1] += input.value
        values.splice(index, 1)
        render({ index: index - 1, caret: join })
        emit()
        return
      }
      if (event.key === 'ArrowLeft' && collapsed && caret === 0 && index > 0) {
        event.preventDefault()
        const prev = inputs()[index - 1]
        if (prev) caretTo(prev, prev.value.length)
        return
      }
      if (event.key === 'ArrowRight' && collapsed && caret === input.value.length) {
        const next = inputs()[index + 1]
        if (!next) return
        event.preventDefault()
        caretTo(next, 0)
      }
    })

    hop.append(slot)
    setSep(hop, index < values.length - 1)
    return hop
  }

  const render = (focus?: { index: number; caret: number }) => {
    mount.replaceChildren(...values.map(hopFor))
    syncCurrent()
    if (!focus) return
    const input = inputs()[focus.index]
    if (input) caretTo(input, focus.caret)
  }

  let popGen = 0

  const morph = () => {
    const gen = ++popGen
    const outgoing = [...mount.querySelectorAll<HTMLElement>('.hop')]
    const outs = outgoing.map((hop) => {
      for (const anim of hop.getAnimations()) anim.cancel()
      hop.dataset.exit = ''
      const css = getComputedStyle(hop)
      return hop.animate(
        [
          {
            opacity: css.opacity,
            transform: css.transform === 'none' ? 'scale(1)' : css.transform,
          },
          { opacity: 0, transform: `scale(${SWAP_SCALE})` },
        ],
        { duration: SWAP_OUT_MS, easing: STATE_CHANGE_EASE, fill: 'forwards' },
      )
    })
    void Promise.all(outs.map((anim) => anim.finished.catch(() => {}))).then(() => {
      if (gen !== popGen) return
      for (const hop of outgoing) hop.remove()
      render()
      for (const hop of liveHops()) {
        hop.animate(
          { opacity: [0, 1], transform: [`scale(${SWAP_SCALE})`, 'scale(1)'] },
          { duration: SWAP_IN_MS, easing: STATE_CHANGE_EASE },
        )
      }
    })
  }

  mount.addEventListener('copy', (event) => {
    const active = document.activeElement
    if (
      active instanceof HTMLInputElement &&
      mount.contains(active) &&
      active.selectionStart !== active.selectionEnd
    ) {
      return
    }
    event.preventDefault()
    event.clipboardData?.setData('text/plain', values.filter(Boolean).join(', '))
  })

  return {
    set(next: readonly string[]) {
      const incoming = next.flatMap((value) => value.split(',').map((part) => part.trim()))
      const animate = values.length > 0 && mount.querySelector('.hop') && !same(values, incoming)
      values = incoming
      reported = values.filter(Boolean)
      if (animate && !reducedMotion()) morph()
      else render()
    },
    append() {
      values.push('')
      popGen++
      for (const hop of mount.querySelectorAll<HTMLElement>('.hop[data-exit]')) hop.remove()
      render({ index: values.length - 1, caret: 0 })
    },
    mark(index: number) {
      current = index
      syncCurrent()
    },
  }
}
