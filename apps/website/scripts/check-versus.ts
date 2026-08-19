// Holds this fork against the upstream it forked, on one page and one timer, at
// the cadences that actually strain a roll. `/versus` runs both engines with the
// same constants pushed into both, so any divergence is the code. This records
// the pair with the frame limiter off — around 100fps, well above a display's
// refresh — and compares what a person would see: how solid the outgoing ink is,
// and how long a departing glyph lives.
//
// Run with `bun run check:versus` against a dev server (or VERSUS_URL).
import { chromium } from 'playwright'

const BASE = (process.env.VERSUS_URL ?? 'http://localhost:5175').replace(/\/$/, '')

/** The cadences worth guarding: the site's own, and two that outrun the roll. */
const CADENCES = [90, 40, 20]

/** How far apart the two engines may drift before it is a real difference. */
const TOLERANCE = {
  /** Solid ink on screen, as a ratio of fork to upstream. Measured 1.05 at worst. */
  ink: 1.15,
  /** A departing glyph's life, in ms. Measured 32ms apart. */
  life: 90,
}

type Exit = { who: string; born: number; life: number }

declare global {
  interface Window {
    versusExits: Exit[]
    versusWatch: [exit: Exit, el: HTMLElement][]
  }
}

const median = (values: number[]) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

const browser = await chromium.launch({ args: ['--disable-frame-rate-limit', '--disable-gpu-vsync'] })
const page = await browser.newPage({
  viewport: { width: 760, height: 260 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
})

await page.addInitScript(() => {
  window.versusExits = []
  window.versusWatch = []
  const real = Element.prototype.animate
  Element.prototype.animate = function animate(
    keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions,
  ) {
    const animation = real.call(this, keyframes, options)
    const root = this.getRootNode()
    // An exit is the only roll that drives opacity to a bare 0; an entrance
    // passes the pair [0, 1]. Only a glyph in a shadow tree has a host to name.
    const leaving = !Array.isArray(keyframes) && keyframes?.opacity === 0
    if (this instanceof HTMLElement && this.classList.contains('char') && leaving && root instanceof ShadowRoot) {
      const exit = { who: root.host.id, born: performance.now(), life: 0 }
      window.versusExits.push(exit)
      window.versusWatch.push([exit, this])
    }
    return animation
  }
  const poll = () => {
    const now = performance.now()
    for (const [exit, el] of window.versusWatch) if (!exit.life && !el.isConnected) exit.life = now - exit.born
    requestAnimationFrame(poll)
  }
  requestAnimationFrame(poll)
})

await page.goto(`${BASE}/versus`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
// Only the two stages on screen, so every captured pixel is one engine or the other.
await page.evaluate(() => {
  const pair = document.querySelector('.versus-pair')
  if (pair) document.body.replaceChildren(pair)
  document.body.style.margin = '0'
  for (const tag of document.querySelectorAll<HTMLElement>('.versus-tag')) tag.style.display = 'none'
})

const failures: string[] = []
console.log('  cadence   solid ink up/fork  ratio   glyph life up/fork    fps')

for (const cadence of CADENCES) {
  await page.evaluate((ms) => {
    const input = document.querySelector<HTMLInputElement>('[data-role="interval"] .slider-range')
    if (!input) return
    input.value = String(ms)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    window.versusExits = []
    window.versusWatch = []
  }, cadence)
  await page.waitForTimeout(2500)

  const cdp = await page.context().newCDPSession(page)
  const shots: string[] = []
  cdp.on('Page.screencastFrame', (frame) => {
    shots.push(frame.data)
    void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {})
  })
  const startedAt = Date.now()
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
  await page.waitForTimeout(3000)
  await cdp.send('Page.stopScreencast')
  const fps = shots.length / ((Date.now() - startedAt) / 1000)

  // Solid ink per half, straight off the recorded frames.
  const solid = await page.evaluate(async (encoded: string[]) => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return [0, 0]
    let left = 0
    let right = 0
    for (const data of encoded) {
      const blob = await (await fetch(`data:image/png;base64,${data}`)).blob()
      const bitmap = await createImageBitmap(blob)
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      ctx.drawImage(bitmap, 0, 0)
      const { data: px, width, height } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
      const seam = Math.round(width * 0.03)
      const background = px[0]
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (px[(y * width + x) * 4] - background <= 90) continue
          if (x < width / 2 - seam) left++
          else if (x > width / 2 + seam) right++
        }
      }
      bitmap.close()
    }
    return [left / encoded.length, right / encoded.length]
  }, shots)

  const exits = await page.evaluate(() => window.versusExits)
  const lifeOf = (who: string) => median(exits.filter((exit) => exit.who === who && exit.life).map((exit) => exit.life))
  const upLife = lifeOf('up')
  const forkLife = lifeOf('fk')
  const ratio = solid[1] / Math.max(solid[0], 1)
  const lifeGap = Math.abs(forkLife - upLife)

  console.log(
    `  ${String(cadence).padStart(5)}ms  ${solid[0].toFixed(0).padStart(8)} ${solid[1].toFixed(0).padStart(8)}  ${ratio.toFixed(3).padStart(6)}   ${upLife.toFixed(0).padStart(6)}ms ${forkLife.toFixed(0).padStart(7)}ms  ${fps.toFixed(0).padStart(5)}`,
  )
  if (ratio > TOLERANCE.ink) failures.push(`${cadence}ms: fork carries ${ratio.toFixed(2)}x upstream's solid ink`)
  if (lifeGap > TOLERANCE.life) {
    failures.push(`${cadence}ms: a departing glyph lives ${lifeGap.toFixed(0)}ms longer than upstream's`)
  }
}

await browser.close()

if (failures.length) {
  console.log(`\nversus drift:\n${failures.map((failure) => `  ${failure}`).join('\n')}`)
  process.exit(1)
}
console.log(`\nversus holds: both engines within ${TOLERANCE.ink}x on solid ink and ${TOLERANCE.life}ms on glyph life`)
