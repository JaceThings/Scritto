// Guards the one promise a rolling text component makes: a glyph that did not
// change is not redrawn. Every surviving glyph must be the same element
// afterwards, never handed an opacity or filter animation, with exactly as many
// leaving and arriving as differ; kept runs must hold their position at every
// anchoring; and two rapid arms prove a later tick does not cancel an earlier
// roll. Run with `bun run check:churn` against a dev server (or CHURN_URL).
import { chromium, type Page } from 'playwright'

const BASE = (process.env.CHURN_URL ?? 'http://localhost:5175').replace(/\/$/, '')

/** Long enough to read the roll, short enough to keep the table quick. */
const DURATION = 400
const SETTLE_MS = DURATION + 350

/**
 * One row per transition: `kept` is the surviving glyphs in row order (prefix
 * then run, NBSP written as a space), and the counts are the pair's true edit
 * distance — except where a lone shared glyph is refused as noise.
 */
const CASES: { from: string; to: string; kept: string; exits: number; enters: number; why: string }[] = [
  // The reported case: only the digit and the plural 's' change.
  { from: '1 second', to: '2 seconds', kept: ' second', exits: 1, enters: 2, why: 'plural arrives' },
  { from: '2 seconds', to: '3 seconds', kept: ' seconds', exits: 1, enters: 1, why: 'digit only' },
  { from: '0 seconds', to: '1 second', kept: ' second', exits: 2, enters: 1, why: 'plural leaves' },
  { from: '9 seconds', to: '10 seconds', kept: ' seconds', exits: 1, enters: 2, why: 'digit grows' },
  { from: '10 seconds', to: '9 seconds', kept: ' seconds', exits: 2, enters: 1, why: 'digit shrinks' },
  {
    from: '1 minute 1 second',
    to: '1 minute 2 seconds',
    kept: '1 minute  second',
    exits: 1,
    enters: 2,
    why: 'kept prefix and kept run at once',
  },
  {
    from: '1 minute 2 seconds',
    to: '1 minute 1 second',
    kept: '1 minute  second',
    exits: 2,
    enters: 1,
    why: 'kept prefix, plural leaves',
  },
  { from: '59 seconds', to: '1 minute 0 seconds', kept: ' seconds', exits: 2, enters: 10, why: 'unit arrives' },
  // Comma groups: a group arriving must not disturb the digits it pushes along.
  { from: '11', to: '1,001', kept: '11', exits: 0, enters: 3, why: 'group arrives' },
  { from: '10,000', to: '1,000,000', kept: '10,000', exits: 0, enters: 3, why: 'group arrives' },
  { from: '12,345', to: '1,012,345', kept: '12,345', exits: 0, enters: 3, why: 'group arrives' },
  { from: '336,983', to: '33,453', kept: '333', exits: 4, enters: 3, why: 'group leaves' },
  { from: 'Hello \u{1F44B}', to: 'Hey \u{1F44B}', kept: 'He \u{1F44B}', exits: 3, enters: 1, why: 'grapheme stays whole' },
  // Nothing shared: the row is rebuilt, and no run may be invented.
  { from: '1st', to: '2nd', kept: '', exits: 3, enters: 3, why: 'nothing in common' },
  // Reusing the shared 'e' would fly a lone glyph across, so 5/4 beats 4/3.
  { from: 'seven', to: 'nine', kept: '', exits: 5, enters: 4, why: 'shared glyph is noise' },
]

const POSITION_TOLERANCE = 0.1
type Align = 'start' | 'end' | 'center'

// `align` anchors the host's box as it resizes: an end-aligned readout keeps
// its '0.2' where it stands, so that run must be neither rerolled nor nudged.
const POSITION_CASES: {
  from: string
  to: string
  kept: string
  direction: 'ltr' | 'rtl'
  align?: Align
  moves: boolean
}[] = [
  { from: '33 seconds', to: '34 seconds', kept: '3 seconds', direction: 'ltr', moves: false },
  { from: '2 seconds', to: '3 seconds', kept: ' seconds', direction: 'ltr', moves: false },
  { from: '$2.50', to: '$3.50', kept: '$.50', direction: 'ltr', moves: false },
  { from: '1,234,567', to: '1,234,568', kept: '1,234,56', direction: 'ltr', moves: false },
  { from: '9 seconds', to: '10 seconds', kept: ' seconds', direction: 'ltr', moves: true },
  { from: '33 seconds', to: '34 seconds', kept: '3 seconds', direction: 'rtl', moves: false },
  { from: '1 second', to: '2 seconds', kept: ' second', direction: 'rtl', align: 'end', moves: true },
  { from: '1 second', to: '2 seconds', kept: ' second', direction: 'rtl', moves: false },
  { from: 'Default – 0.20', to: '0.21', kept: '0.2', direction: 'ltr', align: 'end', moves: false },
  { from: '0.21', to: 'Bouncy – 0.20', kept: '0.2', direction: 'ltr', align: 'end', moves: false },
  { from: '$2.50', to: '$3.50', kept: '$.50', direction: 'ltr', align: 'end', moves: false },
  { from: '1,234,567', to: '1,234,568', kept: '1,234,56', direction: 'ltr', align: 'end', moves: false },
  { from: '9 seconds', to: '10 seconds', kept: ' seconds', direction: 'ltr', align: 'end', moves: false },
  { from: '10 seconds', to: '9 seconds', kept: ' seconds', direction: 'ltr', align: 'end', moves: false },
  { from: '33 seconds', to: '34 seconds', kept: '3 seconds', direction: 'ltr', align: 'center', moves: false },
  { from: '104', to: '24', kept: '4', direction: 'ltr', align: 'center', moves: true },
  { from: '9 seconds', to: '10 seconds', kept: ' seconds', direction: 'ltr', align: 'center', moves: true },
  { from: 'Default – 0.20', to: '0.21', kept: '0.2', direction: 'rtl', align: 'end', moves: false },
]

type Violation = { at: string; rule: string; detail: string }

type Sample = {
  kept: string
  kills: number
  births: number
  row: string
  rowSettled: string
  animatedKept: string[]
  fadedKept: string[]
  sectionProps: string[]
  enterOpacity: number
  inked: number
}

type PositionSample = {
  kept: string
  peak: number
  net: number
  frames: number
  intermediate: boolean
}

type StackSample = {
  row: string
  twoExiting: boolean
  twoRolling: boolean
  fourEntered: boolean
  fourRolling: boolean
  leftover: number
}

const install = () => {
  type Host = HTMLElement & {
    value: string
    update: (value: string, animate?: boolean) => void
    setOptions: (options: Record<string, unknown>) => void
  }
  const positionTolerance = 0.1

  const flat = (text: string) => text.replace(/\u200b/g, '').replace(/\u00a0/g, ' ')
  const sleep = (ms: number) => {
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, ms)
    return promise
  }

  let host: Host | null = null
  let frame: HTMLElement | null = null

  // Outside every <scritto-flow>, whose wrapping would move the row for
  // unrelated reasons. Direction is read on connect, so RTL needs a fresh host.
  const stage = (direction: 'ltr' | 'rtl' = 'ltr', align: 'start' | 'end' | 'center' = 'start') => {
    if (host?.dir === direction && frame?.style.textAlign === align) return host
    frame?.remove()
    frame = document.createElement('div')
    frame.dir = direction
    frame.style.cssText =
      'position:fixed;top:24px;left:24px;width:700px;z-index:2147483647;font:600 44px ui-sans-serif,system-ui;font-variant-numeric:tabular-nums;letter-spacing:-0.25px;color:#111;background:#fff'
    frame.style.textAlign = align
    const el = document.createElement('scritto-text') as Host
    el.dir = direction
    frame.append(el)
    document.body.append(frame)
    host = el
    return el
  }

  const glyphs = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('.section .char')]

  const churn = async (from: string, to: string, duration: number) => {
    const el = stage()
    el.setOptions({ respectMotionPreference: false, bounce: false, transition: { duration } })
    el.update(from, false)
    await sleep(80)

    const shadow = el.shadowRoot
    if (!shadow) throw new Error('host has no shadow root')
    const before = new Map<Element, number>()
    for (const [index, char] of glyphs(shadow).entries()) before.set(char, index)
    const wasText = new Map<Element, string>()
    for (const char of before.keys()) wasText.set(char, flat(char.textContent ?? ''))

    el.update(to, true)
    await sleep(0) // the commit rides a microtask, so a macrotask is past it

    const kept: HTMLElement[] = []
    const fresh: HTMLElement[] = []
    for (const char of glyphs(shadow)) (before.has(char) ? kept : fresh).push(char)

    // getKeyframes() mixes timing bookkeeping in with the properties.
    const BOOKKEEPING: Record<string, true> = { offset: true, computedOffset: true, easing: true, composite: true }
    const animatedProps = (el: Element) => {
      const props = new Set<string>()
      for (const anim of el.getAnimations()) {
        for (const frame of anim.effect instanceof KeyframeEffect ? anim.effect.getKeyframes() : []) {
          for (const prop of Object.keys(frame)) if (!BOOKKEEPING[prop]) props.add(prop)
        }
      }
      return props
    }

    // A surviving glyph may be carried by its section's slide, and by nothing
    // else: an animation of its own opacity or filter IS the redraw.
    const animatedKept: string[] = []
    for (const char of kept) {
      const props = animatedProps(char)
      if (props.size) animatedKept.push(`${wasText.get(char)}:${[...props].join('+')}`)
    }

    const sectionProps = new Set<string>()
    for (const section of shadow.querySelectorAll('.section')) {
      for (const prop of animatedProps(section)) sectionProps.add(prop)
    }

    // Belt and braces: a mask, a clip or a stray class could dim a kept glyph
    // without any animation on it at all, so watch what it actually paints.
    const faded = new Set<string>()
    let enterOpacity = 1
    let inked = 0
    for (const at of [0, 0.15, 0.35, 0.6, 0.85]) {
      if (at) await sleep(duration * 0.2)
      for (const char of kept) {
        const style = getComputedStyle(char)
        if (parseFloat(style.opacity) < 0.995 || style.filter !== 'none') {
          faded.add(`${wasText.get(char)}@${at}:o=${style.opacity}:${style.filter}`)
        }
      }
      // A space has nothing to fade, so it never counts as an arrival that
      // should have been animated.
      for (const char of fresh) {
        if (flat(char.textContent ?? '') === ' ') continue
        inked++
        enterOpacity = Math.min(enterOpacity, parseFloat(getComputedStyle(char).opacity))
      }
    }

    const row = () => flat([...shadow.querySelectorAll('.section')].map((s) => s.textContent ?? '').join(''))
    const rowAfter = row()
    await sleep(duration + 250)

    return {
      kept: kept.map((char) => flat(char.textContent ?? '')).join(''),
      kills: [...before.keys()].length - kept.length,
      births: fresh.length,
      row: rowAfter,
      rowSettled: row(),
      animatedKept,
      fadedKept: [...faded],
      sectionProps: [...sectionProps],
      enterOpacity: inked ? enterOpacity : 1,
      inked,
    }
  }

  const position = async (
    from: string,
    to: string,
    duration: number,
    direction: 'ltr' | 'rtl',
    align: 'start' | 'end' | 'center',
  ) => {
    const el = stage(direction, align)
    el.setOptions({ respectMotionPreference: false, bounce: false, transition: { duration } })
    el.update(from, false)
    await sleep(80)

    const shadow = el.shadowRoot
    if (!shadow) throw new Error('host has no shadow root')
    const before = new Map<HTMLElement, number>()
    for (const char of glyphs(shadow)) before.set(char, char.getBoundingClientRect().left)

    el.update(to, true)
    const samples: number[] = []
    let kept: HTMLElement[] = []
    let frames = 0
    const started = performance.now()
    await new Promise<void>((resolve) => {
      const sample = () => {
        if (!kept.length) kept = glyphs(shadow).filter((char) => before.has(char))
        let framePeak = 0
        for (const char of kept) {
          framePeak = Math.max(framePeak, Math.abs(char.getBoundingClientRect().left - before.get(char)!))
        }
        samples.push(framePeak)
        frames++
        if (performance.now() - started >= duration + 100) resolve()
        else requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })

    let net = 0
    for (const char of kept) {
      net = Math.max(net, Math.abs(char.getBoundingClientRect().left - before.get(char)!))
    }
    let peak = 0
    let intermediate = false
    for (const sample of samples) {
      peak = Math.max(peak, sample)
      if (sample > positionTolerance && sample < net - positionTolerance) intermediate = true
    }
    return {
      kept: kept.map((char) => flat(char.textContent ?? '')).join(''),
      peak,
      net,
      frames,
      intermediate,
    }
  }

  // A click-tween feeds a new snapped string every frame. Cancelling glyph
  // rolls on the next tick drops the 2 before the 4 arrives, so the tens
  // digit pops. The same element that was the 2 in 0.23 must still be
  // fading when 4 is on screen; after the roll settles, no exit is left.
  const stack = async (duration: number) => {
    const el = stage()
    el.setOptions({ respectMotionPreference: false, bounce: false, transition: { duration } })
    el.update('0.23', false)
    await sleep(80)

    const shadow = el.shadowRoot
    if (!shadow) throw new Error('host has no shadow root')
    const originalTwo = glyphs(shadow).find((char) => char.textContent === '2')
    if (!originalTwo) throw new Error('starting value had no 2')

    for (let n = 24; n <= 40; n++) {
      el.update((n / 100).toFixed(2), true)
      await sleep(0)
    }

    const rolling = (node: Element) =>
      node.getAnimations().some((anim) => anim.playState === 'running' || anim.playState === 'pending')
    const four = glyphs(shadow).find((char) => char.textContent === '4')

    const snapshot = {
      row: flat([...shadow.querySelectorAll('.section')].map((section) => section.textContent ?? '').join('')),
      twoExiting: Boolean(originalTwo.closest('[inert]')),
      twoRolling: rolling(originalTwo),
      fourEntered: Boolean(four),
      fourRolling: Boolean(four && rolling(four)),
    }

    await sleep(duration + 250)
    return { ...snapshot, leftover: shadow.querySelectorAll('[inert] .char').length }
  }

  Object.assign(window, { __churn: churn, __position: position, __stack: stack })
}

const run = (page: Page, from: string, to: string): Promise<Sample> =>
  page.evaluate(
    ({ from, to, duration }) => {
      const probe = window as unknown as { __churn: (a: string, b: string, d: number) => Promise<Sample> }
      return probe.__churn(from, to, duration)
    },
    { from, to, duration: DURATION },
  )

const runPosition = (
  page: Page,
  from: string,
  to: string,
  direction: 'ltr' | 'rtl',
  align: Align,
): Promise<PositionSample> =>
  page.evaluate(
    ({ from, to, duration, direction, align }) => {
      const probe = window as unknown as {
        __position: (a: string, b: string, d: number, dir: 'ltr' | 'rtl', align: Align) => Promise<PositionSample>
      }
      return probe.__position(from, to, duration, direction, align)
    },
    { from, to, duration: DURATION, direction, align },
  )

const runStack = (page: Page): Promise<StackSample> =>
  page.evaluate((duration) => {
    const probe = window as unknown as { __stack: (d: number) => Promise<StackSample> }
    return probe.__stack(duration)
  }, DURATION)

const reachable = await fetch(BASE, { signal: AbortSignal.timeout(4000) }).then(
  (res) => res.ok,
  () => false,
)
if (!reachable) {
  console.error(`no dev server at ${BASE} — start it with \`bun run play\` (or set CHURN_URL) and run this again`)
  process.exit(1)
}

const browser = await chromium.launch({ channel: 'chrome', headless: process.env.CHURN_HEADED !== '1' })
const context = await browser.newContext({ viewport: { width: 900, height: 600 }, reducedMotion: 'no-preference' })
await context.addInitScript(install)
const page = await context.newPage()
page.on('pageerror', (error) => console.error(`[page error] ${error.message}`))

// The dev server reloads the page from under us whenever core is edited, which
// aborts an in-flight goto. Retry rather than report that as a broken invariant.
for (let attempt = 0; ; attempt++) {
  try {
    await page.goto(`${BASE}/playground`, { waitUntil: 'load' })
    break
  } catch (error) {
    if (attempt >= 3 || !/interrupted by another navigation/.test(String(error))) throw error
    await page.waitForTimeout(500)
  }
}
await page.evaluate(() => document.fonts.ready.then(() => undefined))

const violations: Violation[] = []
for (const item of CASES) {
  const at = `${item.from} → ${item.to}`
  const fail = (rule: string, detail: string) => violations.push({ at, rule, detail })
  process.stdout.write(`· ${at.padEnd(44)} `)
  const before = violations.length
  try {
    const got = await run(page, item.from, item.to)
    if (got.kept !== item.kept) fail('kept glyphs', `expected ${JSON.stringify(item.kept)}, kept ${JSON.stringify(got.kept)} (${item.why})`)
    if (got.kills !== item.exits) fail('exit count', `expected ${item.exits} glyph(s) to leave, ${got.kills} left`)
    if (got.births !== item.enters) fail('enter count', `expected ${item.enters} glyph(s) to arrive, ${got.births} arrived`)
    if (got.animatedKept.length) fail('kept glyph animated', got.animatedKept.join(', '))
    if (got.fadedKept.length) fail('kept glyph dimmed', got.fadedKept.join(', '))
    for (const prop of got.sectionProps) {
      if (prop !== 'transform') fail('section animated', `sections may only slide, saw ${prop}`)
    }
    if (got.row !== item.to || got.rowSettled !== item.to) {
      fail('row', `rendered ${JSON.stringify(got.row)} then ${JSON.stringify(got.rowSettled)}`)
    }
    if (got.inked && got.enterOpacity > 0.9) fail('arriving glyph', `never faded in (min opacity ${got.enterOpacity})`)
  } catch (error) {
    fail('threw', String(error))
  }
  const added = violations.slice(before)
  console.log(added.length ? 'FAIL' : 'ok')
  for (const item of added) console.log(`    ${item.rule}: ${item.detail}`)
  await page.waitForTimeout(SETTLE_MS - DURATION)
}

for (const item of POSITION_CASES) {
  const at = `${item.from} → ${item.to} (${item.direction}${item.align && item.align !== 'start' ? `, ${item.align}` : ''})`
  const fail = (rule: string, detail: string) => violations.push({ at, rule, detail })
  process.stdout.write(`· ${at.padEnd(44)} `)
  const before = violations.length
  try {
    const got = await runPosition(page, item.from, item.to, item.direction, item.align ?? 'start')
    if (got.kept !== item.kept) {
      fail('position subject', `expected ${JSON.stringify(item.kept)}, sampled ${JSON.stringify(got.kept)}`)
    }
    if (got.frames < 2) fail('position samples', `only ${got.frames} animation frame(s) were sampled`)
    if (item.moves) {
      if (got.net < 1) fail('kept run did not move', `net ${got.net.toFixed(3)}px across ${got.frames} frames`)
      if (!got.intermediate) fail('kept run teleported', `no sampled frame lay between start and ${got.net.toFixed(3)}px`)
    } else if (got.peak > POSITION_TOLERANCE) {
      fail(
        'kept run wobbled',
        `${JSON.stringify(got.kept)} deviated ${got.peak.toFixed(3)}px; limit ${POSITION_TOLERANCE}px across ${got.frames} frames`,
      )
    }
  } catch (error) {
    fail('threw', String(error))
  }
  const added = violations.slice(before)
  console.log(added.length ? 'FAIL' : 'ok')
  for (const item of added) console.log(`    ${item.rule}: ${item.detail}`)
  await page.waitForTimeout(SETTLE_MS - DURATION)
}

{
  const at = '0.23 → 0.40 (rapid)'
  const fail = (rule: string, detail: string) => violations.push({ at, rule, detail })
  process.stdout.write(`· ${at.padEnd(44)} `)
  const before = violations.length
  try {
    const got = await runStack(page)
    if (got.row !== '0.40') fail('row', `rendered ${JSON.stringify(got.row)}`)
    if (!got.fourEntered) fail('arriving glyph', '4 never entered')
    if (!got.fourRolling) fail('arriving glyph', '4 entered without a roll')
    if (!got.twoExiting) fail('stacked exit', 'the 2 from 0.23 was gone when 4 arrived')
    if (!got.twoRolling) fail('stacked exit', 'the 2 from 0.23 was not still rolling when 4 arrived')
    if (got.leftover) fail('exit cleanup', `${got.leftover} exiting glyph(s) still in the tree after settle`)
  } catch (error) {
    fail('threw', String(error))
  }
  const added = violations.slice(before)
  console.log(added.length ? 'FAIL' : 'ok')
  for (const item of added) console.log(`    ${item.rule}: ${item.detail}`)
}

{
  // One 600 ms cycle can miss a leftover fill:both on a pooled glyph. Hammer
  // Words→Numbers→Words so flushes overlap; after each return, Creative's eight
  // live letters must all compute to a non-zero opacity.
  const CYCLES = 12
  const words = page.locator('#mode .pill').nth(0)
  const numbers = page.locator('#mode .pill').nth(1)
  const stage = page.locator('#roll .stage')
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#roll')!).opacity === '1')

  for (let i = 1; i <= CYCLES; i++) {
    const at = `Words→Numbers→Words ×${i}`
    const fail = (rule: string, detail: string) => violations.push({ at, rule, detail })
    process.stdout.write(`· ${at.padEnd(44)} `)
    const before = violations.length
    try {
      if (i % 2 === 1) await stage.click()
      await numbers.click()
      await page.waitForFunction(() => document.querySelector('#roll-demo')?.getAttribute('aria-label') === '24')
      await words.click()
      // aria-label flips at the swap midpoint, while the host is still gone.
      // The leftover fill:both flush only shows after the fade-in settles.
      await page.waitForFunction(() => {
        const host = document.querySelector('#roll-demo')
        return host?.getAttribute('aria-label') === 'Creative' && getComputedStyle(host).opacity === '1'
      })
      const got = await page.evaluate(() => {
        const host = document.querySelector('#roll-demo')
        const live = [...(host?.shadowRoot?.querySelectorAll(':not([inert]) .char') ?? [])].map((el) => {
          const style = getComputedStyle(el)
          const box = el.getBoundingClientRect()
          return {
            t: el.textContent ?? '',
            o: parseFloat(style.opacity),
            w: box.width,
            h: box.height,
          }
        })
        return {
          aria: host?.getAttribute('aria-label') ?? null,
          hostOpacity: host ? parseFloat(getComputedStyle(host).opacity) : 0,
          live,
        }
      })
      const letters = got.live.map((g) => g.t).join('')
      if (got.aria !== 'Creative') fail('aria', `label is ${JSON.stringify(got.aria)}`)
      if (got.hostOpacity !== 1) fail('handoff', `host opacity ${got.hostOpacity} after settle`)
      if (got.live.length !== 8) fail('live count', `${got.live.length} glyphs, want 8 (${letters})`)
      if (letters !== 'Creative') fail('live text', JSON.stringify(letters))
      const lead = got.live[0]
      if (!lead || lead.t !== 'C' || lead.o === 0 || lead.w <= 0 || lead.h <= 0) {
        fail('leading C', `first live glyph is ${JSON.stringify(lead)}`)
      }
      const gone = got.live.filter((g) => g.o === 0).map((g) => g.t || '·')
      if (gone.length) fail('stale flush', `live glyphs at opacity 0: ${gone.join('')}`)
    } catch (error) {
      fail('threw', String(error))
    }
    const added = violations.slice(before)
    console.log(added.length ? 'FAIL' : 'ok')
    for (const item of added) console.log(`    ${item.rule}: ${item.detail}`)
  }
}

await browser.close()

if (violations.length) {
  console.error(`\n${violations.length} churn or position violation(s)`)
  process.exit(1)
}
console.log(
  `\nno churn: ${CASES.length} transitions redraw only what changed; ${POSITION_CASES.length} kept-run position checks passed; rapid 0.23→0.40 keeps the 2 rolling; 12 overlapping Words→Numbers→Words cycles keep Creative's 8 glyphs visible`,
)
