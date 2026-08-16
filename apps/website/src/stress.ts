import { measureNaturalWidth, prepareWithSegments } from '@chenglou/pretext'
import type { NumericText } from '@scritto/core'
import '@scritto/core'
import './styles.css'

const params = new URLSearchParams(location.search)
const scenario = params.get('scenario') || 'spans'
const COUNT = clamp(Number(params.get('count') || 64), 8, 400)
const ROUNDS = clamp(Number(params.get('rounds') || 40), 4, 200)
const RUNS = clamp(Number(params.get('runs') || 3), 1, 9)
const AUTO = params.has('auto')

const VALUES = ['104', '1.3', '1,204', '88', '9,999', '12', '1,000', '1,000,000']

const page = document.querySelector('#page')!
const out = document.querySelector('#out')!
const form = document.querySelector<HTMLFormElement>('#form')!
const hosts: NumericText[] = []

for (const [id, value] of [
  ['scenario', scenario],
  ['count', String(COUNT)],
  ['rounds', String(ROUNDS)],
  ['runs', String(RUNS)],
] as const) {
  const field = document.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)
  if (field) field.value = value
}

const makeHost = () => {
  const el = document.createElement('numeric-text') as NumericText
  el.setOptions({ respectMotionPreference: false, transition: { duration: 280 } })
  el.update(VALUES[0], false)
  hosts.push(el)
  return el
}

const line = (i: number, slot: Node) => {
  const wrap = document.createElement(scenario === 'divs' ? 'div' : 'p')
  wrap.append(`Line ${i + 1} settled at `, slot, ' after the last tick, then the copy kept going so the value sits inside a real paragraph.')
  return wrap
}

const slotFor = (i: number) => {
  const host = makeHost()
  const kind = scenario === 'mixed' ? (i % 2 === 0 ? 'span' : 'div') : scenario === 'divs' ? 'div' : 'span'
  if (scenario === 'flow') {
    const flow = document.createElement('numeric-flow')
    const p = document.createElement('p')
    p.append('Used ', host, ' tokens this month, enough that nearby words have to slide when the figure grows or shrinks.')
    flow.append(p)
    return flow
  }
  if (kind === 'div') {
    const box = document.createElement('div')
    box.style.display = 'inline-block'
    box.style.fontWeight = '600'
    box.append(host)
    return line(i, box)
  }
  const span = document.createElement('span')
  span.style.fontWeight = '600'
  span.append(host)
  return line(i, span)
}

for (let i = 0; i < COUNT; i++) page.append(slotFor(i))

const leftover = () => {
  let n = 0
  for (const host of hosts) n += host.shadowRoot?.getAnimations({ subtree: true }).length ?? 0
  return n
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const samplePretext = () => {
  const errors: number[] = []
  const glyphErrors: number[] = []
  const n = Math.min(hosts.length, 16)
  for (let i = 0; i < n; i++) {
    const host = hosts[i]
    const font = getComputedStyle(host).font
    const value = host.value
    const whole = measureNaturalWidth(prepareWithSegments(value, font))
    const dom = host.getBoundingClientRect().width
    errors.push(Math.abs(whole - dom))
    let glyphs = 0
    for (const ch of value) glyphs += measureNaturalWidth(prepareWithSegments(ch === ' ' ? '\u00A0' : ch, font))
    glyphErrors.push(Math.abs(glyphs - dom))
  }
  return {
    samples: n,
    wholeMax: Math.max(0, ...errors),
    wholeMedian: median(errors),
    glyphMax: Math.max(0, ...glyphErrors),
    glyphMedian: median(glyphErrors),
  }
}

const oneRun = async () => {
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

  const t0 = performance.now()
  let updateMs = 0
  for (let round = 0; round < ROUNDS; round++) {
    const value = VALUES[(round + 1) % VALUES.length]
    const u0 = performance.now()
    for (const host of hosts) host.update(value, true)
    updateMs += performance.now() - u0
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }
  await new Promise((resolve) => setTimeout(resolve, 400))
  const wall = performance.now() - t0
  cancelAnimationFrame(raf)
  observer.disconnect()

  const fps = frames / (wall / 1000)
  return {
    fps,
    dropped,
    frames,
    wall,
    updateMs,
    longTasks: longTasks.length,
    longMs: longTasks.reduce((sum, n) => sum + n, 0),
    leftover: leftover(),
  }
}

const run = async () => {
  out.textContent = 'running…'
  const results = []
  for (let i = 0; i < RUNS; i++) {
    results.push(await oneRun())
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  const pretext = samplePretext()
  const fps = results.map((r) => r.fps)
  const report = {
    scenario,
    hosts: COUNT,
    rounds: ROUNDS,
    runs: RUNS,
    fps,
    fpsMedian: median(fps),
    droppedMedian: median(results.map((r) => r.dropped)),
    updateMsMedian: median(results.map((r) => r.updateMs)),
    longTasksMedian: median(results.map((r) => r.longTasks)),
    leftoverMedian: median(results.map((r) => r.leftover)),
    pretext,
    pass: median(fps) >= 55,
  }
  ;(window as Window & { __STRESS__?: typeof report }).__STRESS__ = report
  out.textContent = JSON.stringify(report, null, 2)
  return report
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  const next = new URL(location.href)
  const data = new FormData(form)
  for (const [key, value] of data) next.searchParams.set(key, String(value))
  next.searchParams.delete('auto')
  if (next.search === location.search) void run()
  else location.href = next.toString()
})

if (AUTO || params.toString()) queueMicrotask(() => void run())

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}
