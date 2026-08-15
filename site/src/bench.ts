import type { NumericText } from '@numeric-text/core'
import './styles.css'
import { bindThemeToggle } from './theme'

const baseline = new URLSearchParams(location.search).has('baseline')
if (baseline) await import('https://esm.sh/@numeric-text/core@0.1.4')
else await import('../../packages/core/dist/index.js')

const COUNT = 100
const ROUNDS = 50
const VALUES = ['104', '1.3', '1,204', '88', '9,999', '12']

const grid = document.querySelector('#grid')!
const out = document.querySelector('#out')!
const hosts: NumericText[] = []

for (let i = 0; i < COUNT; i++) {
  const el = document.createElement('numeric-text') as NumericText
  el.setOptions({ respectMotionPreference: false })
  el.update(VALUES[0], false)
  grid.append(el)
  hosts.push(el)
}

const leftover = () => {
  let n = 0
  for (const host of hosts) n += host.shadowRoot?.getAnimations({ subtree: true }).length ?? 0
  return n
}

const run = async () => {
  out.textContent = 'running…'
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
  await new Promise((resolve) => setTimeout(resolve, 900))
  const wall = performance.now() - t0
  cancelAnimationFrame(raf)
  observer.disconnect()

  const long = longTasks.reduce((sum, n) => sum + n, 0)
  out.textContent = [
    `build ${baseline ? 'published 0.1.4' : 'local'}`,
    `hosts ${COUNT}`,
    `rounds ${ROUNDS}`,
    `updates ${COUNT * ROUNDS}`,
    `wall ${wall.toFixed(1)} ms`,
    `update work ${updateMs.toFixed(1)} ms`,
    `long tasks ${longTasks.length} (${long.toFixed(1)} ms)`,
    `frames ${frames}`,
    `dropped (>21ms) ${dropped}`,
    `animations left ${leftover()}`,
  ].join('\n')
}

bindThemeToggle(document.querySelector('#theme')!)
document.querySelector('#run')!.addEventListener('click', () => void run())
