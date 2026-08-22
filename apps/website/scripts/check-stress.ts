// Odd-usage sweep: every case renders a host in an unusual context, drives a
// few transitions, and asserts the same invariants — settled text, nothing
// leaked, no glyph over its neighbour, a stable line height, no console error.
// Run with `bun run check:stress` against a dev server.
import { chromium, type Page } from 'playwright'
import type { Scritto, ScrittoOptions } from '@scritto/core'

const BASE = (process.env.STRESS_URL ?? 'http://localhost:5175').replace(/\/$/, '')

type Case = {
  name: string
  /** Wraps the host. `HOST` is replaced by the element markup. */
  frame: string
  values: string[]
  hostStyle?: string
  containerStyle?: string
  options?: ScrittoOptions
  /** ms between updates; small values exercise interruption. */
  gap?: number
  /** Skip the neighbour-overlap check when text is deliberately laid on top of the host. */
  skipOverlap?: boolean
}

type Result = { violations: string[] }

declare global {
  interface Window {
    __stress: { run(spec: Omit<Case, 'name'>): Promise<Result> }
  }
}

const CASES: Case[] = [
  { name: 'plain grouped numbers', frame: 'Total: HOST', values: ['1', '1,204', '999', '1,000', '10,000', '9,999'] },
  { name: 'currency and units', frame: 'HOST per month', values: ['$0', '$2.50', '$2', '€1.234,56', '12 kg', '12.5 kg', '1 kg'] },
  { name: 'negatives', frame: 'Δ HOST', values: ['-1', '−20', '10', '-1,000', '0', '+5'] },
  { name: 'emoji', frame: 'HOST', values: ['Hello 👋', 'Hola 👋', 'Hey 👋🏽', '👨‍👩‍👧 family', 'Hey 👋'] },
  { name: 'CJK', frame: '数量：HOST 件', values: ['一', '十二', '一百二十', '三', '一千二百'] },
  { name: 'combining marks', frame: 'HOST', values: ['café', 'café', 'naïve', 'résumé', 'resume'] },
  { name: 'RTL', frame: '<span dir="rtl">המחיר HOST ש"ח</span>', values: ['1', '1,204', '99', '10,000', '5'], containerStyle: 'direction:rtl' },
  { name: 'empty and space', frame: 'x HOST y', values: ['', ' ', 'a', '', 'ab c', ''] },
  { name: 'very long', frame: 'HOST', values: ['1', '1,234,567,890,123,456,789', '12', '999,999,999,999', '0'] },
  { name: 'tiny font', frame: 'HOST', values: ['1,204', '9', '88,900', '12'], hostStyle: 'font-size:8px' },
  { name: 'huge font', frame: 'HOST', values: ['1,204', '9', '88,900', '12'], hostStyle: 'font-size:72px', containerStyle: 'width:600px' },
  { name: 'bold italic serif', frame: '<b><i>HOST</i></b>', values: ['1,204', '9', '88,900', '12'], containerStyle: 'font-family:Georgia,serif' },
  { name: 'letter-spaced uppercase', frame: 'HOST', values: ['ALPHA', 'BETA', 'GAMMA', 'ALPHA'], hostStyle: 'letter-spacing:0.2em;text-transform:uppercase' },
  { name: 'rapid churn 40ms', frame: 'HOST', values: ['1', '12', '123', '1,234', '12,345', '1', '99', '9,999'], gap: 40 },
  { name: 'rapid churn 8ms', frame: 'HOST', values: ['A', 'AB', 'ABC', 'ABCD', 'A', 'ABCDE', 'AB'], gap: 8 },
  { name: 'same value twice', frame: 'HOST', values: ['12', '12', '13', '13', '12'] },
  { name: 'flow: host mid sentence', frame: '<scritto-flow>The tally so far is HOST tickets, and rising through the weekend as the late shows report.</scritto-flow>', values: ['1', '1,234,567', '12', '987,654,321', '1'], containerStyle: 'width:320px' },
  { name: 'flow: host at line end', frame: '<scritto-flow>The tally so far is HOST</scritto-flow>', values: ['1', '1,234,567', '12', '987,654,321'], containerStyle: 'width:220px' },
  { name: 'flow: host at line start', frame: '<scritto-flow>HOST tickets sold so far this weekend across every screen.</scritto-flow>', values: ['1', '1,234,567', '12', '987,654,321'], containerStyle: 'width:220px' },
  { name: 'flow: glued punctuation', frame: '<scritto-flow>Sold: (HOST), see below.</scritto-flow>', values: ['1', '1,234,567', '12', '987,654,321'], containerStyle: 'width:200px' },
  { name: 'flow: two hosts one line', frame: '<scritto-flow>From HOST to <scritto-text id="probe2"></scritto-text> in a day.</scritto-flow>', values: ['1', '1,234,567', '12', '987,654,321'], containerStyle: 'width:260px' },
  { name: 'flow: nested inline', frame: '<scritto-flow>Now <b>HOST</b> and <a href="#">a link</a> after.</scritto-flow>', values: ['1', '1,234,567', '12', '987,654,321'], containerStyle: 'width:200px' },
  { name: 'flow: narrow column', frame: '<scritto-flow>Now HOST and then some more words to wrap around.</scritto-flow>', values: ['1', '1,234,567', '12', '987,654,321'], containerStyle: 'width:90px' },
  { name: 'flow: RTL paragraph', frame: '<scritto-flow dir="rtl">המספר הוא HOST והוא ממשיך לעלות כל הזמן.</scritto-flow>', values: ['1', '1,234,567', '12', '987,654,321'], containerStyle: 'width:220px;direction:rtl' },
  { name: 'flow: rapid churn', frame: '<scritto-flow>The tally so far is HOST tickets, and rising.</scritto-flow>', values: ['1', '1,234,567', '12', '987,654,321', '5', '55,555'], containerStyle: 'width:260px', gap: 60 },
  { name: 'flow: whitespace-nowrap span', frame: '<scritto-flow>Now <span style="white-space:nowrap">HOST units</span> here.</scritto-flow>', values: ['1', '1,234,567', '12', '987,654,321'], containerStyle: 'width:200px' },
  { name: 'flow: line-height 1', frame: '<scritto-flow>Now HOST and more words after it to wrap.</scritto-flow>', values: ['1', '1,234,567', '12', '987,654,321'], containerStyle: 'width:180px;line-height:1' },
  { name: 'flow: line-height 2.4', frame: '<scritto-flow>Now HOST and more words after it to wrap.</scritto-flow>', values: ['1', '1,234,567', '12', '987,654,321'], containerStyle: 'width:180px;line-height:2.4' },
  { name: 'flow: centered', frame: '<scritto-flow style="text-align:center;display:block">Now HOST and more words after.</scritto-flow>', values: ['1', '1,234,567', '12', '987,654,321'], containerStyle: 'width:220px' },
  { name: 'flow: justified', frame: '<scritto-flow style="text-align:justify;display:block">Now HOST and more words after it to make it wrap around.</scritto-flow>', values: ['1', '1,234,567', '12', '987,654,321'], containerStyle: 'width:220px' },
  { name: 'reduced motion off', frame: 'HOST', values: ['1', '1,204', '9'], options: { respectMotionPreference: false } },
  { name: 'transformed parent', frame: 'HOST', values: ['1', '1,204', '9', '88,900'], containerStyle: 'transform:scale(1.5) rotate(2deg);transform-origin:left' },
  { name: 'overflow hidden parent', frame: 'HOST', values: ['1', '1,204', '9', '88,900'], containerStyle: 'overflow:hidden;width:60px' },
  { name: 'inside button', frame: '<button>Count: HOST</button>', values: ['1', '1,204', '9', '88,900'] },
  { name: 'inside table cell', frame: '<table><tr><td>HOST</td><td>next</td></tr></table>', values: ['1', '1,204', '9', '88,900'] },
  { name: 'flex-centered button', frame: '<button style="display:flex;justify-content:center;width:300px;text-align:center">HOST</button>', values: ['104', '24', '1.3', '104', '9'] },
  { name: 'right-aligned block', frame: '<div style="text-align:right;width:300px">Total HOST</div>', values: ['1', '1,204', '9', '88,900'] },
  { name: 'inside flex row', frame: '<div style="display:flex;gap:8px"><span>a</span>HOST<span>b</span></div>', values: ['1', '1,204', '9', '88,900'] },
  { name: 'inside grid', frame: '<div style="display:grid;grid-template-columns:auto 1fr"><span>a</span>HOST</div>', values: ['1', '1,204', '9', '88,900'] },
  { name: 'position absolute', frame: 'HOST', values: ['1', '1,204', '9', '88,900'], hostStyle: 'position:absolute;top:0;left:0' },
  { name: 'display block', frame: 'HOST', values: ['1', '1,204', '9', '88,900'], hostStyle: 'display:block' },
  { name: 'display inline-block', frame: 'HOST', values: ['1', '1,204', '9', '88,900'], hostStyle: 'display:inline-block' },
  { name: 'padding and border on host', frame: 'HOST', values: ['1', '1,204', '9', '88,900'], hostStyle: 'padding:4px 12px;border:1px solid #999' },
  { name: 'newline in value', frame: 'HOST', values: ['a\nb', 'a b', 'ab', 'a\nb'] },
  { name: 'tabs and nbsp', frame: 'HOST', values: ['a\tb', 'a b', 'a b', 'ab'] },
  { name: 'zero-width joiner', frame: 'HOST', values: ['👩‍💻', '👩', '👩‍🔬', '👩‍💻'] },
]

const install = () => {
  window.__stress = {
    async run(spec: Omit<Case, 'name'>): Promise<Result> {
      const wrap = document.createElement('div')
      wrap.style.cssText = `position:fixed;top:40px;left:40px;background:#fff;font:16px/1.5 Inter,sans-serif;color:#333;padding:12px;${spec.containerStyle ?? ''}`
      wrap.innerHTML = spec.frame.replace('HOST', '<scritto-text id="probe"></scritto-text>')
      document.body.append(wrap)
      const host = wrap.querySelector<Scritto>('#probe')!
      const host2 = wrap.querySelector<Scritto>('#probe2')
      if (spec.hostStyle) host.style.cssText += ';' + spec.hostStyle
      await customElements.whenDefined('scritto-text')
      const opts = { respectMotionPreference: false, transition: { duration: 320 }, ...spec.options }
      host.setOptions(opts)
      host2?.setOptions(opts)
      const errors: string[] = []
      const onErr = (e: ErrorEvent) => errors.push(e.message)
      window.addEventListener('error', onErr)

      const violations: string[] = []
      const raf = () => new Promise((r) => requestAnimationFrame(r))
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

      const neighbourOverlap = () => {
        if (spec.skipOverlap) return 0
        const hr = host.getBoundingClientRect()
        if (!host.shadowRoot?.querySelector('.exits')) return 0
        const clipped = host.hasAttribute('data-shrink-clip')
        let glyphRight = -Infinity
        let glyphLeft = Infinity
        for (const g of host.shadowRoot!.querySelectorAll<HTMLElement>('.exits .char')) {
          const r = g.getBoundingClientRect()
          if (parseFloat(getComputedStyle(g).opacity) < 0.05) continue
          glyphRight = Math.max(glyphRight, r.right)
          glyphLeft = Math.min(glyphLeft, r.left)
        }
        if (glyphRight === -Infinity) return 0
        // The band's box reaches past the host to keep its own ink whole, but it
        // fades to nothing at the host's edge, so that is where ink stops.
        const drawnRight = clipped ? Math.min(glyphRight, hr.right) : glyphRight
        // nearest text to the right on the same line, outside the host
        let neighbourLeft = Infinity
        const walker = document.createTreeWalker(wrap, NodeFilter.SHOW_TEXT)
        while (walker.nextNode()) {
          const node = walker.currentNode
          if (host.contains(node) || host2?.contains(node)) continue
          if (!node.textContent?.trim()) continue
          const range = document.createRange()
          range.selectNodeContents(node)
          for (const r of range.getClientRects()) {
            if (Math.abs(r.top - hr.top) < hr.height * 0.6 && r.left >= hr.right - 0.5 && r.width > 0) {
              neighbourLeft = Math.min(neighbourLeft, r.left)
            }
          }
        }
        if (neighbourLeft === Infinity) return 0
        return drawnRight - neighbourLeft
      }

      // Layout offsets, not rects: the roll animates translateY, so only the
      // untransformed placement says which line a glyph is on.
      const glyphDrop = () => {
        const live = host.shadowRoot!.querySelector<HTMLElement>('.section .char')
        const exit = host.shadowRoot!.querySelector<HTMLElement>('.exits .char')
        if (!live || !exit) return 0
        const offsetTop = (el: HTMLElement | null) => {
          let y = 0
          while (el && el !== host) {
            y += el.offsetTop
            el = el.offsetParent instanceof HTMLElement ? el.offsetParent : null
          }
          return y
        }
        return Math.abs(offsetTop(exit) - offsetTop(live))
      }

      let maxOverlap = -Infinity
      let maxDrop = 0
      let heightMin = Infinity
      let heightMax = -Infinity
      const seed = spec.values[0]
      host.update(seed, false)
      host2?.update(seed, false)
      await raf()
      await raf()
      const baseH = wrap.getBoundingClientRect().height

      for (let i = 1; i < spec.values.length; i++) {
        host.update(spec.values[i], true)
        host2?.update(spec.values[spec.values.length - 1 - i] ?? seed, true)
        const gap = spec.gap ?? 420
        const until = performance.now() + gap
        while (performance.now() < until) {
          await raf()
          const o = neighbourOverlap()
          if (o > maxOverlap) maxOverlap = o
          maxDrop = Math.max(maxDrop, glyphDrop())
          const h = wrap.getBoundingClientRect().height
          heightMin = Math.min(heightMin, h)
          heightMax = Math.max(heightMax, h)
        }
      }
      // settle
      await wait(320 + 320 * 0.3 + 120)
      await raf()
      await raf()

      const finalText = (host.textContent ?? '').replace(/ /g, ' ')
      const want = spec.values[spec.values.length - 1].replace(/ /g, ' ')
      if (finalText !== want) violations.push(`settled text ${JSON.stringify(finalText)} != ${JSON.stringify(want)}`)

      const rendered = [...host.shadowRoot!.querySelectorAll('.section .char')].map((c: any) => c.textContent).join('').replace(/ /g, ' ')
      if (rendered !== want) violations.push(`rendered glyphs ${JSON.stringify(rendered)} != ${JSON.stringify(want)}`)

      const leftover = host.shadowRoot!.querySelectorAll('.exits .char').length
      if (leftover) violations.push(`${leftover} exiting glyph(s) left after settle`)

      const anims = host.shadowRoot!.getAnimations().length + host.getAnimations().length
      if (anims) violations.push(`${anims} animation(s) still running after settle`)

      const opaque = [...host.shadowRoot!.querySelectorAll('.section .char')].every((c: any) => parseFloat(getComputedStyle(c).opacity) > 0.99)
      if (!opaque) violations.push('a live glyph is not fully opaque after settle')

      // Only what the library writes: the case's own hostStyle is expected to stay.
      const probe = document.createElement('i')
      probe.style.cssText = spec.hostStyle ?? ''
      for (const prop of ['width', 'marginRight', 'paddingRight', 'display'] as const) {
        if (host.style[prop] !== probe.style[prop]) violations.push(`host style.${prop} not restored: ${JSON.stringify(host.style[prop])}`)
      }
      if (host.hasAttribute('data-shrink-clip')) violations.push('data-shrink-clip left on')

      if (maxOverlap > 0.5) violations.push(`exiting glyphs drew ${maxOverlap.toFixed(1)}px over the neighbour`)
      if (maxDrop > 0.5) violations.push(`exiting glyphs sat ${maxDrop.toFixed(1)}px off the live glyphs' line`)
      // A flow may legitimately rewrap; a rotated box's bounding rect changes with its width.
      const heightStable = !/scritto-flow/.test(spec.frame) && !/rotate/.test(spec.containerStyle ?? '')
      if (heightStable && heightMax - heightMin > 0.5) violations.push(`line height moved ${(heightMax - heightMin).toFixed(1)}px during transitions`)
      if (heightStable && Math.abs(wrap.getBoundingClientRect().height - baseH) > 0.5) violations.push('container height differs after settle')

      window.removeEventListener('error', onErr)
      for (const e of errors) violations.push(`error: ${e}`)
      const rect = wrap.getBoundingClientRect()
      const box = { x: rect.left, y: rect.top, width: Math.max(1, rect.width), height: Math.max(1, rect.height) }
      wrap.remove()
      return { violations, box, maxOverlap: Number.isFinite(maxOverlap) ? maxOverlap : 0 }
    },
  }
}

const main = async () => {
  const browser = await chromium.launch()
  const page: Page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 })
  const consoleErrors: string[] = []
  page.on('pageerror', (e) => consoleErrors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  await page.goto(`${BASE}/playground.html`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.evaluate(install)

  let failed = 0
  for (const c of CASES) {
    const before = consoleErrors.length
    const result = await page.evaluate((spec) => window.__stress.run(spec), c)
    const errs = consoleErrors.slice(before)
    const problems = [...result.violations, ...errs.map((e) => `console: ${e}`)]
    const ok = problems.length === 0
    if (!ok) failed++
    console.log(`· ${c.name.padEnd(30)} ${ok ? 'ok' : 'FAIL'}${ok ? '' : '\n    ' + problems.join('\n    ')}`)
  }
  await browser.close()
  console.log(failed ? `\n${failed} case(s) failed` : `\nall ${CASES.length} stress cases hold`)
  process.exit(failed ? 1 : 0)
}

await main()
