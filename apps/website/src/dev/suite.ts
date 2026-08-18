import { flushStats, type Scritto } from '@scritto/core'

declare global {
  interface Performance {
    /** Chromium only. */
    memory?: { usedJSHeapSize: number }
  }
  interface Window {
    /** What `run-suite.ts` reads once the page has finished measuring. */
    __BENCH__?: { done: boolean; cases: Report[] }
  }
}
import '@scritto/core'
import { bindThemeToggle } from './theme'

type Built = { hosts: Scritto[]; words?: number }

type Case = {
  id: string
  label: string
  rounds: number
  bounce?: boolean
  animate?: boolean
  values: string[]
  setup: (root: HTMLElement) => Built
}

export type Report = {
  id: string
  label: string
  hosts: number
  words: number
  wordSpans: number
  rounds: number
  setupMs: number
  fps: number
  dropped: number
  updateMs: number
  longTasks: number
  longMs: number
  leftover: number
  heapMb: number | null
  error: string | null
}

const NUMBERS = ['104', '1.3', '1,204', '88', '9,999', '12', '1,000', '1,000,000']
const GROW = ['1', '1,234,567', '12', '999,999']
const PEEL = ['999', '1,000', '1,000,000', '12']
const EMOJI = ['Hello 👋', 'Hola 👋', 'Hey 👋']
const TEXT = ['Creative', 'Create', 'Code', 'Creator']
const DIGITS = ['1', '9876543210', '1234567890', '5555555555']
const LEX =
  'the collector logged tokens across every running job in the queue this cycle just enough extra width that a few words drop and climb back once the figure shrinks to a short tally'.split(
    ' ',
  )

const makeHost = (value = NUMBERS[0]) => {
  const el = document.createElement('scritto-text')
  el.setOptions({ respectMotionPreference: false, transition: { duration: 280 } })
  el.update(value, false)
  return el
}

const gridOf = (root: HTMLElement, hosts: Scritto[], dir = 'ltr') => {
  root.dir = dir
  const grid = document.createElement('div')
  grid.className = 'flex flex-wrap gap-x-4 gap-y-2 text-xl font-semibold'
  for (const host of hosts) grid.append(host)
  root.append(grid)
  return { hosts }
}

const line = (slot: Node, tag: 'p' | 'div') => {
  const wrap = document.createElement(tag)
  wrap.append('Line settled at ', slot, ' after the last tick, then the copy kept going so nearby words have to move.')
  return wrap
}

const wordsAround = (n: number, host: Node) => {
  const at = Math.floor(n / 3)
  const chunk = (start: number, count: number) =>
    Array.from({ length: count }, (_, i) => LEX[(start + i) % LEX.length]).join(' ')
  const frag = document.createDocumentFragment()
  frag.append(chunk(0, at), ' ', host, ' ', chunk(at, n - at))
  return frag
}

const flowOf = (child: Node, width = '36rem') => {
  const flow = document.createElement('scritto-flow')
  flow.style.display = 'block'
  flow.style.width = width
  flow.style.maxWidth = '100%'
  const p = document.createElement('p')
  p.append(child)
  flow.append(p)
  return flow
}

const copyHosts = (root: HTMLElement, n: number, kind: 'span' | 'div') => {
  const hosts: Scritto[] = []
  for (let i = 0; i < n; i++) {
    const host = makeHost()
    hosts.push(host)
    if (kind === 'span') {
      const span = document.createElement('span')
      span.style.fontWeight = '600'
      span.append(host)
      root.append(line(span, 'p'))
    } else {
      const box = document.createElement('div')
      box.style.display = 'inline-block'
      box.style.fontWeight = '600'
      box.append(host)
      root.append(line(box, 'div'))
    }
  }
  return { hosts }
}

const flowHosts = (root: HTMLElement, n: number, words: number, values: string[]) => {
  const hosts: Scritto[] = []
  for (let i = 0; i < n; i++) {
    const host = makeHost(values[0])
    hosts.push(host)
    root.append(flowOf(wordsAround(words, host)))
  }
  return { hosts, words: n * words }
}

const paragraph = (root: HTMLElement, words: number) => {
  const host = makeHost(GROW[0])
  const stage = document.createElement('div')
  stage.style.maxHeight = '16rem'
  stage.style.overflow = 'auto'
  stage.append(flowOf(wordsAround(words, host)))
  root.append(stage)
  return { hosts: [host], words }
}

const CASES: Case[] = [
  {
    id: 'isolated-100',
    label: '100 isolated numbers',
    rounds: 30,
    values: NUMBERS,
    setup: (root) => gridOf(root, Array.from({ length: 100 }, () => makeHost())),
  },
  {
    id: 'isolated-400',
    label: '400 isolated numbers',
    rounds: 16,
    values: NUMBERS,
    setup: (root) => gridOf(root, Array.from({ length: 400 }, () => makeHost())),
  },
  {
    id: 'instant-400',
    label: '400 hosts, no animation',
    rounds: 16,
    animate: false,
    values: NUMBERS,
    setup: (root) => gridOf(root, Array.from({ length: 400 }, () => makeHost())),
  },
  {
    id: 'copy-spans-64',
    label: '64 numbers inside spans',
    rounds: 24,
    values: NUMBERS,
    setup: (root) => copyHosts(root, 64, 'span'),
  },
  {
    id: 'copy-divs-64',
    label: '64 numbers inside divs',
    rounds: 24,
    values: NUMBERS,
    setup: (root) => copyHosts(root, 64, 'div'),
  },
  {
    id: 'flow-short-32',
    label: '32 short flow sentences',
    rounds: 20,
    values: NUMBERS,
    setup: (root) => flowHosts(root, 32, 12, NUMBERS),
  },
  {
    id: 'flow-wrap-12',
    label: '12 wrapping paragraphs, one flush',
    rounds: 16,
    values: GROW,
    setup: (root) => flowHosts(root, 12, 40, GROW),
  },
  {
    id: 'flow-lines-24',
    label: '24 wrapping lines moving together',
    rounds: 16,
    values: GROW,
    setup: (root) => flowHosts(root, 24, 36, GROW),
  },
  {
    id: 'flow-words-200',
    label: '1 flow, 200-word paragraph',
    rounds: 12,
    values: GROW,
    setup: (root) => paragraph(root, 200),
  },
  {
    id: 'flow-words-2000',
    label: '1 flow, 2,000-word paragraph',
    rounds: 8,
    values: GROW,
    setup: (root) => paragraph(root, 2000),
  },
  {
    id: 'flow-words-5000',
    label: '1 flow, 5,000-word paragraph',
    rounds: 6,
    values: GROW,
    setup: (root) => paragraph(root, 5000),
  },
  {
    id: 'flow-words-20000',
    label: '1 flow, 20,000-word paragraph',
    rounds: 3,
    values: GROW,
    setup: (root) => paragraph(root, 20000),
  },
  {
    id: 'grow-shrink',
    label: 'Grow and shrink 1 ↔ 1,234,567',
    rounds: 24,
    values: GROW,
    setup: (root) => gridOf(root, [makeHost(GROW[0])]),
  },
  {
    id: 'comma-peel',
    label: 'Comma peel 999 ↔ 1,000,000',
    rounds: 24,
    values: PEEL,
    setup: (root) => gridOf(root, [makeHost(PEEL[0])]),
  },
  {
    id: 'bounce-off',
    label: '8 hosts, bounce off',
    rounds: 20,
    bounce: false,
    values: NUMBERS,
    setup: (root) => gridOf(root, Array.from({ length: 8 }, () => makeHost())),
  },
  {
    id: 'bounce-on',
    label: '8 hosts, bounce on',
    rounds: 20,
    bounce: true,
    values: NUMBERS,
    setup: (root) => gridOf(root, Array.from({ length: 8 }, () => makeHost())),
  },
  {
    id: 'rtl',
    label: 'RTL numbers',
    rounds: 20,
    values: NUMBERS,
    setup: (root) => gridOf(root, Array.from({ length: 8 }, () => makeHost()), 'rtl'),
  },
  {
    id: 'emoji',
    label: 'Emoji / grapheme swap',
    rounds: 20,
    values: EMOJI,
    setup: (root) => gridOf(root, Array.from({ length: 8 }, () => makeHost(EMOJI[0]))),
  },
  {
    id: 'text-morph',
    label: 'String morph Creative → Code',
    rounds: 20,
    values: TEXT,
    setup: (root) => gridOf(root, Array.from({ length: 8 }, () => makeHost(TEXT[0]))),
  },
  {
    id: 'long-digits',
    label: '10-digit churn',
    rounds: 20,
    values: DIGITS,
    setup: (root) => gridOf(root, Array.from({ length: 8 }, () => makeHost(DIGITS[0]))),
  },
]

const leftoverOf = (hosts: Scritto[]) => {
  let n = 0
  for (const host of hosts) n += host.shadowRoot?.getAnimations().length ?? 0
  return n
}

const heapMb = () => {
  const { memory } = performance
  return memory ? memory.usedJSHeapSize / 1024 / 1024 : null
}

const measure = async (spec: Case, root: HTMLElement): Promise<Report> => {
  const empty: Report = {
    id: spec.id,
    label: spec.label,
    hosts: 0,
    words: 0,
    wordSpans: 0,
    rounds: spec.rounds,
    setupMs: 0,
    fps: 0,
    dropped: 0,
    updateMs: 0,
    longTasks: 0,
    longMs: 0,
    leftover: 0,
    heapMb: null,
    error: null,
  }

  try {
    root.replaceChildren()
    const tSetup = performance.now()
    const built = spec.setup(root)
    const setupMs = performance.now() - tSetup
    const { hosts } = built
    const wordSpans = root.querySelectorAll('[data-word]').length
    if (built.words && wordSpans < built.words * 0.8) {
      throw new Error(`wordify missed spans: ${wordSpans} / ${built.words}`)
    }

    for (const host of hosts) {
      host.setOptions({
        bounce: spec.bounce === true,
        respectMotionPreference: false,
        transition: { duration: 280 },
      })
    }

    const longTasks: number[] = []
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(entry.duration)
    })
    observer.observe({ type: 'longtask', buffered: false })

    let frames = 0
    let dropped = 0
    let last = performance.now()
    let raf = 0
    const onFrame = (now: number) => {
      frames += 1
      const dt = now - last
      last = now
      if (dt > 21) dropped += 1
      raf = requestAnimationFrame(onFrame)
    }
    raf = requestAnimationFrame(onFrame)

    const animate = spec.animate !== false
    let updateMs = 0
    const t0 = performance.now()
    for (let round = 0; round < spec.rounds; round++) {
      const value = spec.values[(round + 1) % spec.values.length]
      const u0 = performance.now()
      for (const host of hosts) host.update(value, animate)
      await Promise.resolve()
      updateMs += performance.now() - u0
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    await new Promise((resolve) => setTimeout(resolve, animate ? 360 : 32))
    const wall = performance.now() - t0
    cancelAnimationFrame(raf)
    observer.disconnect()

    return {
      ...empty,
      hosts: hosts.length,
      words: built.words ?? 0,
      wordSpans,
      setupMs,
      fps: frames / (wall / 1000),
      dropped,
      updateMs,
      longTasks: longTasks.length,
      longMs: longTasks.reduce((sum, n) => sum + n, 0),
      leftover: leftoverOf(hosts),
      heapMb: heapMb(),
    }
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : String(error) }
  }
}

const page = document.querySelector<HTMLElement>('#page')!
const table = document.querySelector<HTMLElement>('#results')!
const status = document.querySelector<HTMLElement>('#status')!
const reports: Report[] = []

const paintRow = (report: Report) => {
  const row = document.querySelector(`[data-case="${report.id}"]`)
  if (!row) return
  const values = [
    report.error ? `err ${report.error}` : report.fps.toFixed(1),
    report.updateMs.toFixed(1),
    report.setupMs.toFixed(1),
    String(report.longTasks),
    String(report.dropped),
    String(report.leftover),
    report.heapMb === null ? '—' : report.heapMb.toFixed(0),
  ]
  row.querySelectorAll('[data-metric]').forEach((cell, i) => {
    cell.textContent = values[i]
  })
  row.toggleAttribute('data-fail', Boolean(report.error) || (!report.error && report.fps < 30))
}

const publish = (done: boolean) => {
  window.__BENCH__ = { done, cases: reports }
}

const runOne = async (spec: Case) => {
  status.textContent = `running ${spec.id}…`
  flushStats.prepare = 0
  flushStats.commit = 0
  flushStats.finish = 0
  flushStats.hosts = 0
  const report = await measure(spec, page)
  const idx = reports.findIndex((item) => item.id === spec.id)
  if (idx === -1) reports.push(report)
  else reports[idx] = report
  paintRow(report)
  page.replaceChildren()
  await new Promise((resolve) => setTimeout(resolve, 80))
  return report
}

const runAll = async () => {
  reports.length = 0
  publish(false)
  for (const spec of CASES) await runOne(spec)
  status.textContent = `done · ${reports.length} cases`
  publish(true)
}

const head = document.createElement('tr')
head.className = 'text-muted'
head.innerHTML =
  '<th class="py-1 pr-4 text-left font-medium">case</th><th class="py-1 pr-3 text-right font-medium">fps</th><th class="py-1 pr-3 text-right font-medium">update ms</th><th class="py-1 pr-3 text-right font-medium">setup ms</th><th class="py-1 pr-3 text-right font-medium">long</th><th class="py-1 pr-3 text-right font-medium">drop</th><th class="py-1 pr-3 text-right font-medium">left</th><th class="py-1 text-right font-medium">heap</th><th></th>'

table.replaceChildren(
  head,
  ...CASES.map((spec) => {
    const tr = document.createElement('tr')
    tr.dataset.case = spec.id
    tr.innerHTML = `<td class="py-1 pr-4">${spec.label}</td><td class="py-1 pr-3 text-right font-medium" data-metric>—</td><td class="py-1 pr-3 text-right" data-metric>—</td><td class="py-1 pr-3 text-right" data-metric>—</td><td class="py-1 pr-3 text-right" data-metric>—</td><td class="py-1 pr-3 text-right" data-metric>—</td><td class="py-1 pr-3 text-right" data-metric>—</td><td class="py-1 text-right" data-metric>—</td><td class="py-1 pl-3"><button class="cursor-pointer border-0 bg-transparent p-0 text-accent" data-run="${spec.id}" type="button">run</button></td>`
    return tr
  }),
)

document.querySelector('#run-all')!.addEventListener('click', () => void runAll())
table.addEventListener('click', (event) => {
  const button = event.target
  if (!(button instanceof HTMLElement)) return
  const id = button.dataset.run
  if (!id) return
  const spec = CASES.find((item) => item.id === id)
  if (!spec) return
  void runOne(spec).then(() => {
    status.textContent = `done · ${spec.id}`
    publish(reports.length === CASES.length)
  })
})

bindThemeToggle(document.querySelector('#theme')!)
publish(false)

const params = new URLSearchParams(location.search)
const only = params.get('case')
if (params.has('auto')) {
  if (only) {
    const spec = CASES.find((item) => item.id === only)
    if (spec) void runOne(spec).then(() => publish(true))
    else {
      reports.push({
        id: only,
        label: only,
        hosts: 0,
        words: 0,
        wordSpans: 0,
        rounds: 0,
        setupMs: 0,
        fps: 0,
        dropped: 0,
        updateMs: 0,
        longTasks: 0,
        longMs: 0,
        leftover: 0,
        heapMb: null,
        error: 'unknown case',
      })
      publish(true)
    }
  } else void runAll()
}

export const CASE_IDS = CASES.map((spec) => spec.id)
