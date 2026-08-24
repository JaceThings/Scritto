// Guards the behavioural claims the documentation makes, which are the ones
// that go quietly false. A signature check would not catch any of these: every
// identifier in the docs exists and is spelled correctly, and the docs were
// still wrong about what happens when you pass an unchanged value. Run with
// `bun run check:docs` against a dev server (or DOCS_URL).
import { chromium } from 'playwright'
import type { Scritto } from '@scritto/core'

const BASE = (process.env.DOCS_URL ?? 'http://localhost:5175').replace(/\/$/, '')

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(`${BASE}/playground`, { waitUntil: 'networkidle' })

/** Each claim names the page that makes it, so a failure says where to go. */
const results = await page.evaluate(async () => {
  // SAFETY: /playground renders one <scritto-text>, and the page is loaded to
  // networkidle above, so the element is defined and upgraded by now.
  const el = document.querySelector('scritto-text') as Scritto
  // SAFETY: the constructor attaches an open shadow root, so it is never null.
  const shadow = el.shadowRoot!
  const settle = (ms = 900) => new Promise((r) => setTimeout(r, ms))
  const reset = () => el.setOptions({ trend: 0, transition: { duration: 400 }, bounce: false })

  const phases = async (act: () => void, ms = 900) => {
    const seen: string[] = []
    // SAFETY: scrittochange is dispatched as a CustomEvent carrying { phase }.
    const listen = (e: Event) => seen.push((e as CustomEvent<{ phase: string }>).detail.phase)
    el.addEventListener('scrittochange', listen)
    act()
    await settle(ms)
    el.removeEventListener('scrittochange', listen)
    return seen
  }

  const out: { page: string; says: string; ok: boolean }[] = []

  reset()
  el.value = 'A'
  out.push({
    page: 'API',
    says: 'scrittochange fires before then after on a real change',
    ok: (await phases(() => el.update('B'))).join() === 'before,after',
  })

  el.value = 'same'
  out.push({
    page: 'API, Recipes',
    says: 'an unchanged value fires nothing at all',
    ok: (await phases(() => el.update('same'), 300)).length === 0,
  })

  el.value = '1'
  await settle(60)
  const stillFromSetter = shadow.getAnimations().length === 0
  el.update('2')
  await settle(60)
  const rollsFromUpdate = shadow.getAnimations().length > 0
  await settle()
  out.push({
    page: 'API, Recipes',
    says: 'the value setter does not animate and update() does',
    ok: stillFromSetter && rollsFromUpdate,
  })

  el.value = 'i'
  await settle(60)
  el.update('a much longer value')
  await settle(60)
  const onHost = el.getAnimations().length > 0
  await settle()
  out.push({
    page: 'Recipes',
    says: 'the box animations live on the host, not in the shadow tree',
    ok: onHost,
  })

  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
  el.value = money.format(1204)
  await settle(60)
  const before = [...shadow.querySelectorAll('.char')]
  el.update(money.format(1205))
  await settle()
  const after = [...shadow.querySelectorAll('.char')]
  out.push({
    page: 'Recipes',
    says: 'a formatted number keeps the glyphs that did not change',
    ok: after.filter((c) => before.includes(c)).length >= before.length - 2,
  })

  // An element scrolled out of view renders instantly rather than animating.
  const parked = document.createElement('scritto-text') as Scritto
  parked.style.cssText = 'position:fixed;top:-5000px;left:0'
  document.body.append(parked)
  parked.value = '1'
  await settle(60)
  parked.update('999')
  await settle(120)
  out.push({
    page: 'API',
    says: 'an offscreen element updates without animating',
    ok: parked.shadowRoot!.getAnimations().length === 0 && parked.value === '999',
  })
  parked.remove()

  // edgeFade: auto leaves roomy text alone, always forces the band, never refuses it.
  const fade = async (mode: 'auto' | 'always' | 'never') => {
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center'
    const wide = document.createElement('scritto-text') as Scritto
    wide.style.fontSize = '48px'
    host.append(wide)
    document.body.append(host)
    wide.setOptions({ edgeFade: mode, respectMotionPreference: false, transition: { duration: 700 } })
    wide.value = 'Motion design'
    await settle(80)
    wide.update('Motion')
    const seen = new Set<string>()
    for (let i = 0; i < 25; i++) {
      seen.add(wide.getAttribute('data-shrink-clip') ?? 'none')
      await new Promise((r) => requestAnimationFrame(r))
    }
    host.remove()
    return seen.has('both') || seen.has('start') || seen.has('end')
  }
  const autoFade = await fade('auto')
  const alwaysFade = await fade('always')
  const neverFade = await fade('never')
  out.push({
    page: 'API, README',
    says: 'edgeFade auto leaves roomy text unfaded, always forces it, never refuses it',
    ok: !autoFade && alwaysFade && !neverFade,
  })

  // A value with spaces wraps like the text around it; one without never breaks.
  const column = async (text: string, width: number) => {
    const box = document.createElement('div')
    box.style.cssText = `position:fixed;top:200px;left:0;width:${width}px;font-size:16px`
    const inside = document.createElement('scritto-text') as Scritto
    box.append(inside)
    document.body.append(box)
    inside.value = text
    await settle(80)
    const rect = inside.getBoundingClientRect()
    const lines = inside.getClientRects().length
    const overflow = rect.right - box.getBoundingClientRect().right
    box.remove()
    return { lines, overflow }
  }
  const tooWide = await column('every word of this sentence has to go somewhere', 160)
  const fits = await column('four short words here', 400)
  const unbreakable = await column('123,456,789,012,345', 160)
  out.push({
    page: 'API',
    says: 'a value breaks between its words when the line runs out, never inside one',
    ok: tooWide.lines > 1 && tooWide.overflow < 0.5 && fits.lines === 1 && unbreakable.lines === 1,
  })

  el.setOptions({ trend: 1, transition: { duration: 900 }, bounce: true })
  out.push({
    page: 'API, Recipes',
    says: 'trend, duration and bounce apply as set',
    ok: el.trend === 1 && el.transition?.duration === 900 && el.bounce === true,
  })
  reset()

  return out
})

// Reduced motion needs its own emulated context, so it gets its own page. The
// stage on /playground opts out with respectMotionPreference: false, which is
// why this builds a fresh element rather than reusing the one on the page.
const reduced = await browser.newContext({ reducedMotion: 'reduce' })
const reducedPage = await reduced.newPage()
await reducedPage.goto(`${BASE}/playground`, { waitUntil: 'networkidle' })
const respectsPreference = await reducedPage.evaluate(async () => {
  const el = document.createElement('scritto-text') as Scritto
  el.style.cssText = 'position:fixed;top:100px;left:100px;font-size:48px'
  document.body.append(el)
  el.value = '1'
  await new Promise((r) => setTimeout(r, 60))
  const animated: boolean[] = []
  // SAFETY: scrittochange is dispatched as a CustomEvent carrying { animate }.
  const listen = (e: Event) => animated.push((e as CustomEvent<{ animate: boolean }>).detail.animate)
  el.addEventListener('scrittochange', listen)
  el.update('999')
  await new Promise((r) => setTimeout(r, 150))
  // SAFETY: the constructor attaches an open shadow root, so it is never null.
  const running = el.shadowRoot!.getAnimations().length
  el.remove()
  return running === 0 && animated.every((a) => !a) && el.value === '999'
})
results.push({
  page: 'API, Recipes, README',
  says: 'prefers-reduced-motion updates the value without animating',
  ok: respectsPreference,
})

await browser.close()

for (const r of results) console.log(`${r.ok ? '  ok' : 'FAIL'}  ${r.says}   [${r.page}]`)
const failed = results.filter((r) => !r.ok).length
console.log(failed === 0 ? '\ndocs match behaviour' : `\n${failed} documented claim(s) are wrong`)
process.exit(failed === 0 ? 0 : 1)
