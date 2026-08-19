// Drives the real element through every case and records what the DOM did.
// Needs a dev server on 5175: `bun run play`.
import { chromium } from 'playwright'
import type { Scritto } from '@scritto/core'
import { writeFileSync } from 'node:fs'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1600, height: 400 } })
await p.goto('http://localhost:5175/studio', { waitUntil: 'networkidle' })
await p.waitForFunction(() => !!customElements.get('scritto-text'))
await p.evaluate(() => {
  const host = document.createElement('scritto-text')
  host.id = 'probe'
  host.setAttribute('style', 'position:fixed;left:40px;top:200px;font-size:48px;font-weight:550;line-height:1')
  document.body.append(host)
})
await p.waitForTimeout(300)
const out = await p.evaluate(async () => {
  // SAFETY: this script creates #probe above, once the element is defined.
  const host = document.querySelector('#probe') as Scritto
  host.setOptions({ respectMotionPreference: false, transition: { duration: 400 } })
  host.update('', false)
  host.update('Draft', false)
  await new Promise((r) => requestAnimationFrame(() => r(null)))
  host.update('Published', true)
  await new Promise((r) => queueMicrotask(() => r(null)))
  const root = host.shadowRoot!
  const rows = [...root.querySelectorAll<HTMLElement>('.char')].map((el) => {
    const a = el.getAnimations()[0]
    const timing = a?.effect?.getComputedTiming()
    return {
      text: el.textContent,
      exiting: root.querySelector('.exits')?.contains(el) === true,
      delay: Math.round(Number(timing?.delay ?? 0)),
      duration: Math.round(Number(timing?.duration ?? 0)),
      x: Math.round(el.getBoundingClientRect().left),
    }
  })
  // spring sample: read the width animation's easing
  const width = host.getAnimations()[0]
  return { rows, easing: String(width?.effect?.getTiming().easing ?? ''), spring: host.transition.easing }
})
writeFileSync(new URL('sweep-detail.json', import.meta.url), JSON.stringify(out, null, 2))
console.log('Draft -> Published, per glyph:')
for (const r of out.rows) console.log(`  ${r.exiting ? 'out' : ' in'} ${JSON.stringify(r.text)} x=${String(r.x).padStart(4)} delay=${String(r.delay).padStart(3)}ms duration=${r.duration}ms`)
console.log('width easing:', out.easing.slice(0, 60))
await b.close()
