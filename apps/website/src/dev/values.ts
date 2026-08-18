// Twelve live ways to edit the value list, side by side, so one can be picked
// and the rest thrown away.

import '@scritto/core'
import type { Scritto } from '@scritto/core'
import { bindCorners } from '../lib/corners'
import { same } from '../lib/list'
import { STATE_CHANGE_EASE } from '../lib/motion'
import { createPills } from '../components/pills'
import { playClick } from '../lib/sounds'
import { springEasing } from '../lib/spring'

const PRESETS = {
  Words: ['Creative', 'Create', 'Code', 'Code editor', 'Creator'],
  Numbers: ['24', '-20', '10', '5', '$2.5', '$2'],
  Emoji: ['Hello 👋', 'Hola 👋', 'Hey 👋'],
}

const PRESET_NAMES = ['Words', 'Numbers', 'Emoji'] as const satisfies readonly (keyof typeof PRESETS)[]

type Mode = (typeof PRESET_NAMES)[number] | 'Custom'

const MODE_OPTIONS = [
  { value: 'Words', label: 'Words' },
  { value: 'Numbers', label: 'Numbers' },
  { value: 'Emoji', label: 'Emoji' },
  { value: 'Custom', label: 'Custom' },
] as const satisfies readonly { value: Mode; label: string }[]

const modeOf = (list: readonly string[]): Mode =>
  PRESET_NAMES.find((name) => same(list, PRESETS[name])) ?? 'Custom'

// === bits ==================================================================

const svg = (body: string, size = 12) =>
  `<svg viewBox="0 0 12 12" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

const X = svg('<path d="M3.2 3.2 8.8 8.8M8.8 3.2 3.2 8.8" />')
const PLUS = svg('<path d="M6 2.6v6.8M2.6 6h6.8" />')
const LEFT = svg('<path d="M7.4 2.6 4 6l3.4 3.4" />')
const RIGHT = svg('<path d="M4.6 2.6 8 6l-3.4 3.4" />')
const GRIP = svg(
  '<g fill="currentColor" stroke="none"><circle cx="4.4" cy="2.6" r="0.9" /><circle cx="7.6" cy="2.6" r="0.9" /><circle cx="4.4" cy="6" r="0.9" /><circle cx="7.6" cy="6" r="0.9" /><circle cx="4.4" cy="9.4" r="0.9" /><circle cx="7.6" cy="9.4" r="0.9" /></g>',
)

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const iconButton = (icon: string, label: string, className = 'icon-btn') => {
  const button = el('button', className)
  button.type = 'button'
  button.innerHTML = icon
  button.setAttribute('aria-label', label)
  return button
}

const textInput = (className: string, value = '') => {
  const input = el('input', className)
  input.type = 'text'
  input.value = value
  input.spellcheck = false
  input.autocomplete = 'off'
  return input
}

// One offscreen span measures every content-sized input on the page.
const mirror = el('span')
mirror.setAttribute('aria-hidden', 'true')
mirror.style.cssText = 'position:fixed;top:-100vh;left:0;white-space:pre;visibility:hidden;pointer-events:none'

const autosize = (input: HTMLInputElement, pad = 2) => {
  if (!mirror.isConnected) document.body.append(mirror)
  const css = getComputedStyle(input)
  mirror.style.font = css.font
  mirror.style.fontFamily = css.fontFamily
  mirror.style.fontSize = css.fontSize
  mirror.style.fontWeight = css.fontWeight
  mirror.style.letterSpacing = css.letterSpacing
  mirror.textContent = input.value || input.placeholder || ' '
  input.style.width = `${Math.ceil(mirror.getBoundingClientRect().width) + pad}px`
}

// === the card each option is dropped into ==================================

type Ctl = {
  readonly list: string[]
  readonly host: Scritto
  activeIndex(): number
  commit(next: string[]): void
  show(index: number): void
  advance(): void
  onShow(fn: () => void): void
}

type Editor = { sync: () => void; focus: () => void }

type Variant = {
  id: string
  title: string
  note: string
  build: (mount: HTMLElement, ctl: Ctl) => Editor
  /** True when the editor lays out its own full-width rows instead of sitting in one. */
  bare?: boolean
  /** True to sit in the card's plain label-left / value-right row. */
  field?: boolean
}

const STAGE_TEXT = 'text-[28px] leading-none font-[550] tracking-[-0.25px]'

const createCard = (parent: Element, variant: Variant, order: number) => {
  const section = el('section', 'stagger flex w-full flex-col gap-4')
  section.style.setProperty('--i', String(order))

  const head = el('div', 'flex w-full flex-col gap-3 px-1 text-text-primary')
  const title = el('h2', 'text-[16px] leading-none font-[550] tracking-[-0.25px]', `${order + 1} · ${variant.title}`)
  const note = el('p', 'text-[14px] leading-[1.4] font-medium tracking-[-0.25px]', variant.note)
  head.append(title, note)

  const figure = el('div', 'figure')
  const trigger = el('button', 'stage stage-short')
  trigger.type = 'button'
  trigger.setAttribute('aria-label', 'Advance the value')
  const host = document.createElement('scritto-text')
  host.className = STAGE_TEXT
  host.setAttribute('role', 'img')
  trigger.append(host)

  const pillRow = el('div', 'row')
  const pillMount = el('div', 'pill-group')
  pillMount.setAttribute('aria-label', 'Value set')
  pillRow.append(pillMount)

  const editorMount = variant.bare
    ? el('div', 'contents')
    : el('div', variant.field ? 'row row-field' : 'row row-values')
  figure.append(trigger, pillRow, editorMount)
  section.append(head, figure)

  let list = [...PRESETS.Words]
  let cursor = 0
  const watchers: (() => void)[] = []

  const live = () => list.filter(Boolean)

  const paint = (animate: boolean) => {
    const values = live()
    if (!values.length) return
    cursor = ((cursor % values.length) + values.length) % values.length
    const value = values[cursor]
    host.setOptions({
      respectMotionPreference: false,
      transition: { duration: 550, easing: springEasing(0.2) },
    })
    host.update(value, animate)
    host.setAttribute('aria-label', value)
    for (const watcher of watchers) watcher()
  }

  const ctl: Ctl = {
    get list() {
      return list
    },
    host,
    activeIndex() {
      let rank = -1
      for (let i = 0; i < list.length; i++) {
        if (!list[i]) continue
        rank += 1
        if (rank === cursor) return i
      }
      return -1
    },
    commit(next) {
      list = next
      pills.set(modeOf(live()))
      paint(true)
    },
    show(index) {
      const values = live()
      if (!values.length) return
      let rank = 0
      for (let i = 0; i < index && i < list.length; i++) if (list[i]) rank += 1
      // A blank entry has no slot yet: hold the last real value rather than wrap.
      cursor = Math.min(rank, values.length - 1)
      paint(true)
    },
    advance() {
      cursor += 1
      paint(true)
    },
    onShow(fn) {
      watchers.push(fn)
    },
  }

  const editor = variant.build(editorMount, ctl)

  const pills = createPills(pillMount, MODE_OPTIONS, 'Words', (mode) => {
    if (mode === 'Custom') {
      editor.focus()
      return
    }
    list = [...PRESETS[mode]]
    cursor = 0
    editor.sync()
    paint(true)
  })

  trigger.addEventListener('click', () => {
    playClick()
    cursor += 1
    paint(true)
  })

  // Content-sized inputs measure 0 until they are in the document.
  parent.append(section)
  editor.sync()
  paint(false)
}

// === 1 · chips =============================================================

const chipsEditor = (mount: HTMLElement, ctl: Ctl): Editor => {
  const block = el('div', 'values')
  const header = el('div', 'values-head')
  const count = el('span', 'values-note')
  header.append(el('span', 'values-label', 'Values'), count)
  const field = el('div', 'chip-field')
  block.append(header, field)
  mount.append(block)

  const draft = textInput('chip-add')
  draft.placeholder = 'Add value'

  const texts = () => [...field.querySelectorAll<HTMLInputElement>('.chip-text')]
  const push = () => {
    const values = texts().map((input) => input.value)
    count.textContent = `${values.filter(Boolean).length} values`
    ctl.commit(values)
  }

  const focusText = (chip: Element | null | undefined) => {
    const input = chip?.querySelector<HTMLInputElement>('.chip-text')
    if (input) input.focus()
    else draft.focus()
  }

  const chipFor = (value: string) => {
    const chip = el('span', 'chip')
    const text = textInput('chip-text', value)
    text.setAttribute('aria-label', 'Value')
    autosize(text)

    text.addEventListener('input', () => {
      autosize(text)
      push()
    })
    // An emptied chip is a deletion only once the caret leaves.
    text.addEventListener('blur', () => {
      if (text.value.trim()) return
      chip.remove()
      push()
    })
    text.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        draft.focus()
        return
      }
      if (event.key === 'Backspace' && !text.value) {
        event.preventDefault()
        const prev = chip.previousElementSibling
        chip.remove()
        push()
        focusText(prev)
      }
    })

    const remove = iconButton(X, `Remove ${value}`, 'chip-x')
    remove.addEventListener('click', () => {
      chip.remove()
      push()
      draft.focus()
    })

    chip.append(text, remove)
    return chip
  }

  const addDraft = () => {
    const value = draft.value.trim()
    if (!value) return
    draft.value = ''
    field.insertBefore(chipFor(value), draft)
    push()
  }

  draft.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      addDraft()
      return
    }
    if (event.key === 'Backspace' && !draft.value) {
      event.preventDefault()
      focusText(draft.previousElementSibling)
    }
  })
  draft.addEventListener('blur', addDraft)

  return {
    sync() {
      field.replaceChildren(...ctl.list.map(chipFor), draft)
      count.textContent = `${ctl.list.length} values`
    },
    focus() {
      draft.focus()
    },
  }
}

// === 2 · lines =============================================================

const linesEditor = (mount: HTMLElement, ctl: Ctl): Editor => {
  const block = el('div', 'values')
  const header = el('div', 'values-head')
  header.append(el('span', 'values-label', 'Values'), el('span', 'values-note', 'One per line'))
  const area = el('textarea', 'values-area')
  area.rows = 1
  area.spellcheck = false
  area.setAttribute('aria-label', 'Values, one per line')
  block.append(header, area)
  mount.append(block)

  const grow = () => {
    area.style.height = 'auto'
    area.style.height = `${area.scrollHeight}px`
  }

  area.addEventListener('input', () => {
    grow()
    ctl.commit(area.value.split('\n').map((line) => line.trim()))
  })

  return {
    sync() {
      area.value = ctl.list.join('\n')
      grow()
    },
    focus() {
      area.focus()
      area.setSelectionRange(area.value.length, area.value.length)
    },
  }
}

// === 3 · stepper ===========================================================

const stepperEditor = (mount: HTMLElement, ctl: Ctl): Editor => {
  const block = el('div', 'values')
  const header = el('div', 'values-head')
  const count = el('span', 'values-note')
  header.append(el('span', 'values-label', 'Values'), count)

  const bar = el('div', 'stepper')
  const prev = iconButton(LEFT, 'Previous value')
  const next = iconButton(RIGHT, 'Next value')
  const input = textInput('stepper-input')
  input.setAttribute('aria-label', 'Current value')
  const add = iconButton(PLUS, 'Add value')
  const drop = iconButton(X, 'Remove this value')
  bar.append(prev, input, next, el('span', 'stepper-gap'), add, drop)
  block.append(header, bar)
  mount.append(block)

  let values: string[] = []
  let at = 0

  const render = () => {
    at = Math.max(0, Math.min(at, values.length - 1))
    input.value = values[at] ?? ''
    count.textContent = `${at + 1} of ${values.length}`
    drop.disabled = values.length < 2
  }

  const step = (by: number) => {
    if (!values.length) return
    at = (at + by + values.length) % values.length
    render()
    ctl.show(at)
    input.focus()
    input.select()
  }

  prev.addEventListener('click', () => step(-1))
  next.addEventListener('click', () => step(1))

  input.addEventListener('input', () => {
    values[at] = input.value
    ctl.commit([...values])
    count.textContent = `${at + 1} of ${values.filter(Boolean).length || 1}`
  })
  input.addEventListener('blur', () => {
    if (values[at]?.trim() || values.length < 2) return
    values.splice(at, 1)
    render()
    ctl.commit([...values])
  })
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    step(1)
  })

  add.addEventListener('click', () => {
    values.splice(at + 1, 0, '')
    at += 1
    render()
    input.focus()
  })

  drop.addEventListener('click', () => {
    if (values.length < 2) return
    values.splice(at, 1)
    render()
    ctl.commit([...values])
    ctl.show(at)
  })

  ctl.onShow(() => {
    const active = ctl.activeIndex()
    if (active < 0 || active === at) return
    at = active
    render()
  })

  return {
    sync() {
      values = [...ctl.list]
      at = 0
      render()
    },
    focus() {
      input.focus()
      input.select()
    },
  }
}

// === 4 · list ==============================================================

const REORDER_EASE = STATE_CHANGE_EASE

const listEditor = (mount: HTMLElement, ctl: Ctl): Editor => {
  const rows = el('div', 'flex w-full flex-col')
  const addRow = el('button', 'list-add row')
  addRow.type = 'button'
  addRow.innerHTML = `${PLUS}<span>Add value</span>`
  mount.append(rows, addRow)

  let values: string[] = []

  const rowEls = () => [...rows.querySelectorAll<HTMLElement>('.list-row')]

  const push = () => ctl.commit([...values])

  const focusRow = (index: number) => {
    rowEls()[index]?.querySelector<HTMLInputElement>('.list-input')?.focus()
  }

  const render = () => {
    rows.replaceChildren(...values.map((value, i) => rowFor(value, i)))
  }

  const drag = (row: HTMLElement, grip: HTMLElement, event: PointerEvent) => {
    const all = rowEls()
    const from = all.indexOf(row)
    const height = row.getBoundingClientRect().height
    if (from < 0 || !height) return
    const startY = event.clientY
    let to = from
    row.dataset.dragging = 'true'
    grip.setPointerCapture(event.pointerId)

    const move = (e: PointerEvent) => {
      const offset = e.clientY - startY
      row.style.transform = `translateY(${offset}px)`
      const target = Math.max(0, Math.min(all.length - 1, from + Math.round(offset / height)))
      if (target === to) return
      to = target
      // Everything between the old and new slot steps aside by one row.
      for (const [i, other] of all.entries()) {
        if (other === row) continue
        const shift = from < to && i > from && i <= to ? -height : from > to && i >= to && i < from ? height : 0
        other.style.transition = `transform 220ms ${REORDER_EASE}`
        other.style.transform = shift ? `translateY(${shift}px)` : 'translateY(0px)'
      }
    }

    const end = () => {
      grip.removeEventListener('pointermove', move)
      grip.removeEventListener('lostpointercapture', end)
      for (const other of all) {
        other.style.transition = ''
        other.style.transform = ''
      }
      delete row.dataset.dragging
      if (to !== from) {
        values.splice(to, 0, ...values.splice(from, 1))
        push()
      }
      render()
      rowEls()[to]?.querySelector<HTMLElement>('.list-grip')?.focus()
    }

    grip.addEventListener('pointermove', move)
    grip.addEventListener('lostpointercapture', end)
  }

  const moveBy = (index: number, by: number) => {
    const target = index + by
    if (target < 0 || target >= values.length) return
    values.splice(target, 0, ...values.splice(index, 1))
    push()
    render()
    rowEls()[target]?.querySelector<HTMLElement>('.list-grip')?.focus()
  }

  const rowFor = (value: string, index: number) => {
    const row = el('div', 'list-row row')
    const grip = iconButton(GRIP, `Reorder ${value || 'value'}`, 'list-grip')
    grip.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      drag(row, grip, event)
    })
    grip.addEventListener('keydown', (event) => {
      const by = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
      if (!by) return
      event.preventDefault()
      moveBy(rowEls().indexOf(row), by)
    })

    const input = textInput('list-input', value)
    input.placeholder = 'Empty'
    input.setAttribute('aria-label', `Value ${index + 1}`)
    input.addEventListener('input', () => {
      values[rowEls().indexOf(row)] = input.value
      push()
    })
    input.addEventListener('keydown', (event) => {
      const here = rowEls().indexOf(row)
      if (event.key === 'Enter') {
        event.preventDefault()
        values.splice(here + 1, 0, '')
        push()
        render()
        focusRow(here + 1)
        return
      }
      if (event.key === 'Backspace' && !input.value && values.length > 1) {
        event.preventDefault()
        values.splice(here, 1)
        push()
        render()
        focusRow(Math.max(0, here - 1))
      }
    })

    const remove = iconButton(X, `Remove ${value || 'value'}`, 'chip-x')
    remove.addEventListener('click', () => {
      if (values.length < 2) return
      values.splice(rowEls().indexOf(row), 1)
      push()
      render()
    })

    row.append(grip, input, remove)
    return row
  }

  addRow.addEventListener('click', () => {
    values.push('')
    push()
    render()
    focusRow(values.length - 1)
  })

  return {
    sync() {
      values = [...ctl.list]
      render()
    },
    focus() {
      addRow.click()
    },
  }
}

// === 5 · rail ==============================================================

const railEditor = (mount: HTMLElement, ctl: Ctl): Editor => {
  const block = el('div', 'values')
  const header = el('div', 'values-head')
  const count = el('span', 'values-note')
  header.append(el('span', 'values-label', 'Values'), count)
  const rail = el('div', 'rail')
  block.append(header, rail)
  mount.append(block)

  let values: string[] = []

  const chips = () => [...rail.querySelectorAll<HTMLElement>('.chip')]
  const push = () => {
    count.textContent = `${values.filter(Boolean).length} values`
    ctl.commit([...values])
  }

  const highlight = () => {
    const active = ctl.activeIndex()
    for (const [i, chip] of chips().entries()) chip.dataset.active = String(i === active)
  }

  const chipFor = (value: string, index: number) => {
    const chip = el('span', 'chip')
    const text = textInput('chip-text', value)
    text.readOnly = true
    text.placeholder = 'Value'
    text.setAttribute('aria-label', value || 'New value')
    autosize(text)

    const edit = () => {
      text.readOnly = false
      text.focus()
      text.select()
      remove.hidden = false
    }
    text.addEventListener('pointerdown', (event) => {
      if (!text.readOnly) return
      event.preventDefault()
      const here = chips().indexOf(chip)
      if (here === ctl.activeIndex()) {
        edit()
        return
      }
      ctl.show(here)
    })
    text.addEventListener('input', () => {
      values[chips().indexOf(chip)] = text.value
      autosize(text)
      push()
    })
    text.addEventListener('blur', () => {
      text.readOnly = true
      remove.hidden = chips().indexOf(chip) !== ctl.activeIndex()
      if (text.value.trim()) return
      values.splice(chips().indexOf(chip), 1)
      push()
      render()
    })
    text.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== 'Escape') return
      event.preventDefault()
      text.blur()
    })

    const remove = iconButton(X, `Remove ${value}`, 'chip-x')
    remove.hidden = index !== ctl.activeIndex()
    remove.addEventListener('click', () => {
      if (values.length < 2) return
      values.splice(chips().indexOf(chip), 1)
      push()
      render()
    })

    chip.append(text, remove)
    return chip
  }

  const add = iconButton(PLUS, 'Add value', 'token-add')
  add.addEventListener('click', () => {
    values.push('')
    push()
    render()
    ctl.show(values.length - 1)
    const last = chips().at(-1)?.querySelector<HTMLInputElement>('.chip-text')
    if (!last) return
    last.readOnly = false
    last.focus()
    last.select()
  })

  const render = () => {
    rail.replaceChildren(...values.map(chipFor), add)
    highlight()
  }

  ctl.onShow(() => {
    highlight()
    for (const [i, chip] of chips().entries()) {
      const remove = chip.querySelector<HTMLElement>('.chip-x')
      if (remove) remove.hidden = i !== ctl.activeIndex()
    }
    chips()[ctl.activeIndex()]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  })

  return {
    sync() {
      values = [...ctl.list]
      count.textContent = `${values.length} values`
      render()
    },
    focus() {
      add.click()
    },
  }
}

// === 6 · inline tokens =====================================================

const tokensEditor = (mount: HTMLElement, ctl: Ctl): Editor => {
  mount.classList.add('row-field')
  const label = el('span', 'row-label', 'Values')
  const line = el('div', 'tokens')
  const add = iconButton(PLUS, 'Add value', 'token-add')
  mount.append(label, line, add)

  let values: string[] = []

  const push = () => ctl.commit([...values])

  const editToken = (button: HTMLButtonElement, index: number) => {
    const input = textInput('token-input', values[index])
    input.placeholder = 'Value'
    input.setAttribute('aria-label', `Value ${index + 1}`)
    button.replaceWith(input)
    autosize(input, 4)
    input.focus()
    input.select()

    const done = () => {
      values[index] = input.value.trim()
      if (!values[index]) values.splice(index, 1)
      push()
      render()
    }

    input.addEventListener('input', () => {
      values[index] = input.value
      autosize(input, 4)
      ctl.commit([...values])
    })
    input.addEventListener('blur', done)
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault()
        input.blur()
        return
      }
      if (event.key === 'Backspace' && !input.value && values.length > 1) {
        event.preventDefault()
        values.splice(index, 1)
        push()
        render()
        focusToken(Math.max(0, index - 1))
      }
    })
  }

  const tokens = () => [...line.querySelectorAll<HTMLButtonElement>('.token')]
  const focusToken = (index: number) => tokens()[index]?.focus()

  const render = () => {
    const parts: HTMLElement[] = []
    for (const [i, value] of values.entries()) {
      if (i) parts.push(el('span', 'token-sep', '|'))
      const token = el('button', 'token', value)
      token.type = 'button'
      token.setAttribute('aria-label', `Edit ${value}`)
      token.addEventListener('click', () => editToken(token, i))
      parts.push(token)
    }
    line.replaceChildren(...parts)
    line.scrollLeft = line.scrollWidth
  }

  add.addEventListener('click', () => {
    values.push('')
    render()
    const last = tokens().at(-1)
    if (last) editToken(last, values.length - 1)
  })

  return {
    sync() {
      values = [...ctl.list]
      render()
    },
    focus() {
      add.click()
    },
  }
}

// Quieter batch: nothing but the values at rest, every affordance a keystroke
// or a hover.

let seq = 0
const uid = () => `values-${(seq += 1)}`

const fieldLabel = (input: HTMLElement) => {
  const label = el('label', 'row-label', 'Values')
  input.id = uid()
  label.htmlFor = input.id
  return label
}

const caretTo = (input: HTMLInputElement, at: number) => {
  input.focus()
  const clamped = Math.max(0, Math.min(at, input.value.length))
  input.setSelectionRange(clamped, clamped)
}

// === 7 · sentence ==========================================================

// Split on comma + space, so "1,234" stays one value.
const SENTENCE_SPLIT = /,\s+/

const sentenceEditor = (mount: HTMLElement, ctl: Ctl): Editor => {
  const input = textInput('field')
  input.setAttribute('aria-label', 'Values, separated by commas')
  mount.append(fieldLabel(input), input)

  input.addEventListener('input', () => {
    ctl.commit(input.value.split(SENTENCE_SPLIT).map((value) => value.trim()))
  })

  return {
    sync() {
      input.value = ctl.list.join(', ')
    },
    focus() {
      if (input.value && !input.value.endsWith(', ')) input.value += ', '
      caretTo(input, input.value.length)
    },
  }
}

// === 8 · hops ==============================================================

const hopsEditor = (mount: HTMLElement, ctl: Ctl): Editor => {
  const line = el('div', 'quiet-line')
  mount.append(el('span', 'row-label', 'Values'), line)

  let values: string[] = []

  const inputs = () => [...line.querySelectorAll<HTMLInputElement>('.quiet-input')]
  const push = () => ctl.commit([...values])

  const render = (focus?: { index: number; caret: number }) => {
    const parts: HTMLElement[] = []
    for (const [i, value] of values.entries()) {
      if (i) parts.push(el('span', 'quiet-sep', ','))
      parts.push(fieldFor(value, i))
    }
    line.replaceChildren(...parts)
    if (focus) {
      const input = inputs()[focus.index]
      if (input) caretTo(input, focus.caret)
    }
    line.scrollLeft = line.scrollWidth
  }

  const fieldFor = (value: string, index: number) => {
    const input = textInput('quiet-input', value)
    input.setAttribute('aria-label', `Value ${index + 1}`)
    autosize(input)

    input.addEventListener('input', () => {
      values[index] = input.value
      autosize(input)
      push()
    })
    input.addEventListener('blur', () => {
      if (values[index]?.trim() || values.length < 2) return
      values.splice(index, 1)
      push()
      render()
    })
    input.addEventListener('keydown', (event) => {
      const caret = input.selectionStart ?? 0
      const collapsed = caret === input.selectionEnd
      if (event.key === 'Enter' || event.key === ',') {
        // A comma is drawn, never typed: it splits the value at the caret.
        event.preventDefault()
        const tail = input.value.slice(caret)
        values[index] = input.value.slice(0, caret)
        values.splice(index + 1, 0, tail)
        push()
        render({ index: index + 1, caret: 0 })
        return
      }
      if (event.key === 'Backspace' && collapsed && caret === 0 && index > 0) {
        event.preventDefault()
        const join = values[index - 1].length
        values[index - 1] += input.value
        values.splice(index, 1)
        push()
        render({ index: index - 1, caret: join })
        return
      }
      if (event.key === 'ArrowLeft' && collapsed && caret === 0 && index > 0) {
        event.preventDefault()
        const prev = inputs()[index - 1]
        if (prev) caretTo(prev, prev.value.length)
        return
      }
      if (event.key === 'ArrowRight' && collapsed && caret === input.value.length && index < values.length - 1) {
        event.preventDefault()
        const next = inputs()[index + 1]
        if (next) caretTo(next, 0)
      }
    })

    return input
  }

  return {
    sync() {
      values = [...ctl.list]
      render()
    },
    focus() {
      values.push('')
      push()
      render({ index: values.length - 1, caret: 0 })
    },
  }
}

// === 9 · current ===========================================================

const currentEditor = (mount: HTMLElement, ctl: Ctl): Editor => {
  const input = textInput('field')
  input.setAttribute('aria-label', 'The value on the card')
  mount.append(fieldLabel(input), input)

  // An empty entry is not in the rolling list yet, so hold its index until it is.
  let slot: number | null = null
  const target = () => slot ?? ctl.activeIndex()

  input.addEventListener('input', () => {
    const at = target()
    if (at < 0) return
    const next = [...ctl.list]
    next[at] = input.value
    ctl.commit(next)
    if (slot === null || !input.value.trim()) return
    ctl.show(slot)
    slot = null
  })

  input.addEventListener('keydown', (event) => {
    const at = target()
    if (event.key === 'Enter') {
      event.preventDefault()
      const next = [...ctl.list]
      next.splice(at + 1, 0, '')
      slot = at + 1
      input.value = ''
      ctl.commit(next)
      return
    }
    if (event.key === 'Backspace' && !input.value && ctl.list.filter(Boolean).length > 1) {
      event.preventDefault()
      const next = [...ctl.list]
      next.splice(at, 1)
      slot = null
      ctl.commit(next)
      input.value = ctl.list[ctl.activeIndex()] ?? ''
    }
  })

  input.addEventListener('blur', () => {
    slot = null
    input.value = ctl.list[ctl.activeIndex()] ?? ''
  })

  const follow = () => {
    // Never while the caret is here: clearing the field moves the stage on, and
    // following that would rename the wrong value mid-keystroke.
    if (slot !== null || document.activeElement === input) return
    input.value = ctl.list[ctl.activeIndex()] ?? ''
  }
  ctl.onShow(follow)

  return {
    sync() {
      slot = null
      follow()
    },
    focus() {
      const next = [...ctl.list]
      slot = next.length
      next.push('')
      input.value = ''
      ctl.commit(next)
      input.focus()
    },
  }
}

// === 10 · plain ============================================================

const plainEditor = (mount: HTMLElement, ctl: Ctl): Editor => {
  mount.classList.add('row-top')
  const area = el('textarea', 'values-plain')
  area.rows = 1
  area.spellcheck = false
  area.setAttribute('aria-label', 'Values, one per line')
  mount.append(fieldLabel(area), area)

  const grow = () => {
    area.style.height = 'auto'
    area.style.height = `${area.scrollHeight}px`
  }

  area.addEventListener('input', () => {
    grow()
    ctl.commit(area.value.split('\n').map((value) => value.trim()))
  })

  return {
    sync() {
      area.value = ctl.list.join('\n')
      grow()
    },
    focus() {
      area.focus()
      area.setSelectionRange(area.value.length, area.value.length)
    },
  }
}

// === 11 · on the card ======================================================

const onCardEditor = (mount: HTMLElement, ctl: Ctl): Editor => {
  const line = el('div', 'quiet-line quiet-words')
  mount.append(el('span', 'row-label', 'Values'), line)

  const host = ctl.host
  host.classList.add('stage-text')
  const trigger = host.closest<HTMLElement>('.stage')!
  const figure = host.closest<HTMLElement>('.figure')!
  const input = textInput(`stage-edit ${STAGE_TEXT}`)
  input.hidden = true
  input.setAttribute('aria-label', 'Edit this value')
  // Over the stage, not inside it: a control nested in a button is invalid and
  // its clicks would advance the card.
  figure.style.position = 'relative'
  figure.append(input)

  const close = () => {
    input.hidden = true
    host.style.visibility = ''
  }

  const open = () => {
    const at = ctl.activeIndex()
    if (at < 0) return
    input.style.top = `${trigger.offsetTop + trigger.offsetHeight / 2}px`
    input.value = ctl.list[at]
    autosize(input, 4)
    // Unpainted rather than hidden, which would collapse the stage.
    host.style.visibility = 'hidden'
    input.hidden = false
    input.focus()
    input.select()
  }

  host.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    open()
  })
  // Hiding the text on pointerdown retargets the click to the card behind it, so
  // an open editor is what identifies one to swallow.
  trigger.addEventListener(
    'click',
    (event) => {
      if (input.hidden) return
      event.stopImmediatePropagation()
      event.preventDefault()
    },
    true,
  )

  input.addEventListener('input', () => {
    const at = ctl.activeIndex()
    if (at < 0) return
    const next = [...ctl.list]
    next[at] = input.value
    autosize(input, 4)
    ctl.commit(next)
  })
  input.addEventListener('blur', close)
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      // The word for the value just edited, not the element that opened the editor:
      // an Enter chain re-renders the row and detaches it.
      line.querySelector<HTMLElement>('.quiet-jump[data-active="true"]')?.focus()
      return
    }
    if (event.key !== 'Enter') return
    event.preventDefault()
    close()
    ctl.advance()
    open()
  })

  const render = () => {
    const active = ctl.activeIndex()
    line.replaceChildren(
      ...ctl.list.map((value, i) => {
        const jump = el('button', 'quiet-jump', value)
        jump.type = 'button'
        jump.dataset.active = String(i === active)
        jump.setAttribute('aria-label', i === active ? `Edit ${value}` : `Show ${value}`)
        // The stage's text lives inside the card's button, so the word for the
        // value showing is the keyboard way in.
        jump.addEventListener('click', () => {
          if (i === ctl.activeIndex()) open()
          else ctl.show(i)
        })
        return jump
      }),
    )
  }

  ctl.onShow(render)

  return {
    sync: render,
    focus: open,
  }
}

// === 12 · words ============================================================

const wordsEditor = (mount: HTMLElement, ctl: Ctl): Editor => {
  const line = el('div', 'quiet-line quiet-words')
  const add = iconButton(PLUS, 'Add value', 'quiet-add')
  mount.append(el('span', 'row-label', 'Values'), line, add)

  let values: string[] = []

  const push = () => ctl.commit([...values])

  // Removing a word rebuilds the row: focus the neighbour's delete so repeated
  // presses work.
  const landAfterRemoving = (index: number) => {
    const slots = [...line.querySelectorAll<HTMLElement>('.word-slot')]
    const slot = slots[Math.min(index, slots.length - 1)]
    slot?.querySelector<HTMLElement>('.word-x')?.focus()
  }

  const edit = (word: HTMLElement, index: number) => {
    const input = textInput('quiet-input', values[index])
    input.setAttribute('aria-label', `Value ${index + 1}`)
    word.replaceWith(input)
    autosize(input)
    input.focus()
    input.select()

    input.addEventListener('input', () => {
      values[index] = input.value
      autosize(input)
      push()
    })
    input.addEventListener('blur', () => {
      const dropped = !values[index]?.trim() && values.length > 1
      if (dropped) values.splice(index, 1)
      push()
      render()
      if (dropped) landAfterRemoving(index)
    })
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault()
        input.blur()
        return
      }
      if (event.key === 'Backspace' && !input.value && values.length > 1) {
        event.preventDefault()
        input.blur()
      }
    })
  }

  const render = () => {
    line.replaceChildren(
      ...values.map((value, i) => {
        const slot = el('span', 'word-slot')
        const word = el('button', 'word', value)
        word.type = 'button'
        word.setAttribute('aria-label', `Edit ${value}`)
        word.addEventListener('click', () => edit(word, i))
        const drop = iconButton(X, `Remove ${value}`, 'word-x')
        drop.addEventListener('click', () => {
          if (values.length < 2) return
          values.splice(i, 1)
          push()
          render()
          landAfterRemoving(i)
        })
        slot.append(word, drop)
        return slot
      }),
    )
  }

  add.addEventListener('click', () => {
    values.push('')
    render()
    const last = line.querySelector<HTMLElement>('.word-slot:last-child .word')
    if (last) edit(last, values.length - 1)
  })

  return {
    sync() {
      values = [...ctl.list]
      render()
    },
    focus() {
      add.click()
    },
  }
}

// === page ==================================================================

const VARIANTS: Variant[] = [
  {
    id: 'chips',
    title: 'Chips',
    note: 'Each value is a chip. Type in the trailing field and press Enter or comma to add one; click a chip to rename it, ✕ to drop it. Backspace on an empty field grabs the last chip.',
    build: chipsEditor,
  },
  {
    id: 'lines',
    title: 'Lines',
    note: 'One value per line, in a box that grows to fit. Nothing to learn and nothing to escape — a value can contain any character, bars included.',
    build: linesEditor,
  },
  {
    id: 'stepper',
    title: 'Stepper',
    note: 'One value at a time. The arrows walk the list and roll the card with you, so you are always editing the value you can see. Stays a single line no matter how many values there are.',
    build: stepperEditor,
  },
  {
    id: 'list',
    title: 'List',
    note: 'Every value gets its own row, draggable by the grip to reorder (arrow keys work too). The most room to work in, and by far the tallest.',
    build: listEditor,
    bare: true,
  },
  {
    id: 'rail',
    title: 'Rail',
    note: 'The value list doubles as the position indicator: the filled chip is the one on the card. Tap another to roll to it, tap it again to rename it. Scrolls sideways instead of wrapping.',
    build: railEditor,
  },
  {
    id: 'tokens',
    title: 'Inline',
    note: 'Today’s row with the typing taken out — the bars are drawn, not typed. Click any value to edit it in place, + to append. The smallest change from what is there now.',
    build: tokensEditor,
  },
]

const QUIET: Variant[] = [
  {
    id: 'sentence',
    title: 'Sentence',
    note: 'One line of plain text you edit like a sentence. A comma followed by a space starts a new value, so “1,234” survives intact — the only thing you cannot write is a value containing “, ”. Nothing on screen but the values.',
    build: sentenceEditor,
    field: true,
  },
  {
    id: 'hops',
    title: 'Hops',
    note: 'Reads like the sentence above, but the commas are drawn, not typed. Each value is its own field and the caret hops between them: comma or Enter splits at the caret, Backspace at the start joins back, arrows walk across. No punctuation is ever a character.',
    build: hopsEditor,
    field: true,
  },
  {
    id: 'current',
    title: 'Current',
    note: 'Only the value the card is showing. Click the card to walk the list and this follows; type to rename what you see, Enter for a new one, Backspace on empty to drop it. No arrows, no counter, no list.',
    build: currentEditor,
    field: true,
  },
  {
    id: 'plain',
    title: 'Plain',
    note: 'One value per line and nothing else — no count, no hint, no placeholder. The block grows as you type. A value can hold any character, commas and bars included.',
    build: plainEditor,
    field: true,
  },
  {
    id: 'oncard',
    title: 'On the card',
    note: 'The big text is the field. Click the value itself to edit it, Enter to commit and roll to the next; clicking anywhere else on the card still advances. The row underneath is just the list in plain words — tap one to jump to it.',
    build: onCardEditor,
    field: true,
  },
  {
    id: 'words',
    title: 'Words',
    note: 'At rest, bare words with no fills and no buttons. Hover a word and its delete fades in beside it; hover the row and the add appears at the end. Click a word to rename it in place.',
    build: wordsEditor,
    field: true,
  },
]

const mount = document.querySelector('#variants')
if (mount) {
  for (const [i, variant] of VARIANTS.entries()) createCard(mount, variant, i)
}

const quietMount = document.querySelector('#quiet')
if (quietMount) {
  for (const [i, variant] of QUIET.entries()) createCard(quietMount, variant, VARIANTS.length + i)
}

bindCorners()
