// Drives the real element through every case and records what the DOM did.
// Needs a dev server on 5175: `bun run play`.
import { chromium } from 'playwright'
import type { Scritto } from '@scritto/core'
import { writeFileSync } from 'node:fs'

type Case = { group: string; from: string; to: string; note?: string }

const CASES: Case[] = [
  { group: 'Counters', from: '9', to: '10' },
  { group: 'Counters', from: '99', to: '100' },
  { group: 'Counters', from: '999', to: '1,000' },
  { group: 'Counters', from: '1,204', to: '1,205' },
  { group: 'Counters', from: '1,204', to: '88,900' },
  { group: 'Counters', from: '12,345', to: '1,234' },
  { group: 'Counters', from: '1', to: '1,000,000' },
  { group: 'Counters', from: '100', to: '99' },
  { group: 'Money', from: '$2.50', to: '$12.75' },
  { group: 'Money', from: '$9.99', to: '$10.00' },
  { group: 'Money', from: '€1,204', to: '€1,205' },
  { group: 'Money', from: '-$4.00', to: '$4.00' },
  { group: 'Percent', from: '99%', to: '100%' },
  { group: 'Percent', from: '0.9', to: '1.0' },
  { group: 'Percent', from: '-1', to: '0' },
  { group: 'Time', from: '12:59', to: '13:00' },
  { group: 'Time', from: '9:41 AM', to: '9:42 AM' },
  { group: 'Time', from: '1 second', to: '2 seconds' },
  { group: 'Time', from: '59 seconds', to: '1 minute 0 seconds' },
  { group: 'Time', from: '2 minutes 12 seconds', to: '2 minutes 13 seconds' },
  { group: 'Time', from: 'Monday', to: 'Tuesday' },
  { group: 'Time', from: 'March', to: 'April' },
  { group: 'Labels', from: '1 unread', to: '2 unread' },
  { group: 'Labels', from: 'Track 1 of 12', to: 'Track 2 of 12' },
  { group: 'Labels', from: '3 files', to: '4 files' },
  { group: 'Labels', from: 'loading', to: 'loaded' },
  { group: 'Labels', from: 'Draft', to: 'Published' },
  { group: 'Labels', from: '12 km', to: '12 miles' },
  { group: 'Words', from: 'seven', to: 'nine' },
  { group: 'Words', from: 'light', to: 'daylight' },
  { group: 'Words', from: 'daylight', to: 'light' },
  { group: 'Words', from: 'Creative', to: 'Code' },
  { group: 'Words', from: 'supercalifragilisticlight', to: 'light', note: 'the Apple travel case' },
  { group: 'Words', from: 'the light you seek is within you', to: 'you are the daylight' },
  { group: 'Scripts', from: '👋', to: '🌍' },
  { group: 'Scripts', from: 'Hello 👋', to: 'Hola 👋' },
  { group: 'Scripts', from: '一', to: '二' },
  { group: 'Scripts', from: '٣', to: '٤' },
  { group: 'Scripts', from: 'Grüße', to: 'Grüßen' },
  { group: 'Shape', from: 'abcdef', to: 'abcXY', note: 'prefix only' },
  { group: 'Shape', from: 'abcdef', to: 'XYdef', note: 'suffix only' },
  { group: 'Shape', from: 'abcXXXdef', to: 'abcYYYYYdef', note: 'both ends' },
  { group: 'Shape', from: 'xxlightxx', to: 'yylightyy', note: 'floating run' },
  { group: 'Shape', from: 'zzzzdaylightzzzz', to: 'qqqqdaylightqqqq', note: 'floating run, long' },
  { group: 'Shape', from: '11', to: '1,001', note: 'floating run pays for a separator' },
  { group: 'Counters', from: '7', to: '8' },
  { group: 'Counters', from: '19', to: '20' },
  { group: 'Money', from: '$1,000', to: '$999' },
  { group: 'Percent', from: '3%', to: '30%' },
  { group: 'Percent', from: '100%', to: '99%' },
  { group: 'Time', from: '11:59 PM', to: '12:00 AM' },
  { group: 'Time', from: 'in 5 minutes', to: 'in 4 minutes' },
  { group: 'Time', from: 'Today', to: 'Tomorrow' },
  { group: 'Time', from: '31 December', to: '1 January' },
  { group: 'Labels', from: 'Battery 84%', to: 'Battery 83%' },
  { group: 'Labels', from: '2.4 MB', to: '24.1 MB' },
  { group: 'Labels', from: 'v1.9.0', to: 'v1.10.0' },
  { group: 'Labels', from: '4 of 10', to: '5 of 10' },
  { group: 'Labels', from: 'Offline', to: 'Online' },
  { group: 'Labels', from: '18 °C', to: '19 °C' },
  { group: 'Words', from: 'one', to: 'two' },
  { group: 'Words', from: 'nineteen', to: 'twenty' },
  { group: 'Scripts', from: '零', to: '一' },
  { group: 'Scripts', from: 'Ελλάδα', to: 'Ελλάδας' },
  { group: 'Scripts', from: '🌑', to: '🌒' },
]

const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1600, height: 400 } })
await p.goto('http://localhost:5175/studio', { waitUntil: 'networkidle' })
await p.waitForFunction(() => !!customElements.get('scritto-text'), null, { timeout: 20000 })
await p.evaluate(() => {
  const host = document.createElement('scritto-text')
  host.id = 'probe'
  host.setAttribute('style', 'position:fixed;left:40px;top:120px;font-size:48px;font-weight:550;line-height:1;font-variant-numeric:tabular-nums')
  document.body.append(host)
})
await p.waitForTimeout(400)

const results = []
for (const spec of CASES) {
  const row = await p.evaluate(async ({ from, to }) => {
    // SAFETY: this script creates #probe above, once the element is defined.
    const host = document.querySelector('#probe') as Scritto
    host.setOptions({ respectMotionPreference: false, transition: { duration: 400 } })
    host.update('', false)
    host.update(from, false)
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    const root = host.shadowRoot!
    const live = () => [...root.querySelectorAll<HTMLElement>('.char')]
    const before = new Map<HTMLElement, { text: string; x: number }>()
    for (const c of live()) before.set(c, { text: c.textContent ?? '', x: c.getBoundingClientRect().left })
    const widthBefore = host.getBoundingClientRect().width

    host.update(to, true)
    await new Promise((r) => queueMicrotask(() => r(null)))

    const exitsBox = root.querySelector('.exits')
    const chars = live()
    const kept: string[] = []
    const entering: string[] = []
    const exiting: string[] = []
    for (const c of chars) {
      const inExits = exitsBox?.contains(c) ?? false
      const text = c.textContent ?? ''
      if (inExits) { exiting.push(text); continue }
      const anims = c.getAnimations()
      if (anims.length === 0) {
        kept.push(text)
      } else {
        entering.push(text)
      }
    }
    const all = [...root.querySelectorAll<HTMLElement>('.char')].flatMap((c) => c.getAnimations())
    const span = all.reduce((m, a) => Math.max(m, Number(a.effect?.getComputedTiming().endTime ?? 0)), 0)
    const delays = all.map((a) => Math.round(Number(a.effect?.getComputedTiming().delay ?? 0)))
    const keptEls = chars.filter((c) => !(exitsBox?.contains(c) ?? false) && c.getAnimations().length === 0)
    const keptFrom = keptEls.map((c) => before.get(c)?.x ?? null)
    await new Promise((r) => setTimeout(r, 700))
    let moved = 0
    keptEls.forEach((c, i) => {
      const was = keptFrom[i]
      if (was === null) return
      moved = Math.max(moved, Math.abs(c.getBoundingClientRect().left - was))
    })
    const widthAfter = host.getBoundingClientRect().width
    return {
      kept: kept.join(''), entering: entering.join(''), exiting: exiting.join(''),
      travel: Math.round(moved), widthBefore: Math.round(widthBefore), widthAfter: Math.round(widthAfter),
      span: Math.round(span), stagger: [Math.min(...delays, 0), Math.max(...delays, 0)],
    }
  }, spec)
  results.push({ ...spec, ...row })
  await p.waitForTimeout(60)
}
writeFileSync(new URL('cases.json', import.meta.url), JSON.stringify(results, null, 2))
for (const r of results) {
  console.log(`${r.group.padEnd(9)} ${JSON.stringify(r.from).padEnd(34)} -> ${JSON.stringify(r.to).padEnd(24)} kept=${JSON.stringify(r.kept).padEnd(16)} travel=${String(r.travel).padStart(4)}px  w=${r.widthBefore}->${r.widthAfter}  in=${JSON.stringify(r.entering).slice(0,18).padEnd(20)} out=${JSON.stringify(r.exiting).slice(0,18)}`)
}
await b.close()
