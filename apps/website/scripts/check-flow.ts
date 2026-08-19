// Guards the <scritto-flow> re-wrap: the ghost handoff and the clip's edge mask.
// Run with `bun run check:flow` against a dev server (FLOW_URL to point elsewhere).
import { chromium, type Page } from 'playwright'

const BASE = (process.env.FLOW_URL ?? 'http://localhost:5175').replace(/\/$/, '')
const OUT = process.env.FLOW_SHOTS ?? '/tmp/scritto-flow-check'

/** Line positions are quantised, so anything further off the grid than this is flying. */
const GRID_TOL = 2.5
/** A pinned ghost is written at an exact px offset, so pairing needs no slack beyond rounding. */
const PIN_TOL = 1.5
const SETTLE_MS = 3000

/** Both directions: words dropping to the next line, and climbing back up. */
const GROW_SHRINK: [from: string, to: string][] = [
  ['1', '1,234,567'],
  ['1,234,567', '1'],
  ['12', '987,654,321'],
  ['987,654,321', '12'],
]

type Violation = { flow: string; rule: string; detail: string }
type Report = { violations: Violation[]; notes: string[] }

const install = () => {
  type Grid = { base: number; lineH: number; lines: number }
  type Ghost = { top: number; left: number; pinTop: number; pinLeft: number; from: number; to: number }
  type Shot = {
    words: number
    hidden: { top: number; left: number }[]
    offGridWords: { top: number; text: string }[]
    ghosts: Ghost[]
    anims: number
    lines: number
    fadeIntoContent: number
    fadePx: number
    fadedStarts: { text: string; left: number }[]
  }

  const flowsIn = () => [...document.querySelectorAll<HTMLElement>('scritto-flow')]

  const clipOf = (flow: HTMLElement) => flow.querySelector<HTMLElement>(':scope > [data-wrap-clip]')

  // First opaque stop of the edge fade: inside the flow for a content-box mask,
  // on its left edge or past it for a gutter mask.
  const fadePxOf = (mask: string) => {
    const match = mask.match(/rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)\s+([\d.]+)px/)
    return match ? Number(match[1]) : 0
  }

  const wordsIn = (flow: HTMLElement) =>
    [...flow.querySelectorAll<HTMLElement>('[data-word]')].filter((word) => !word.closest('[data-wrap-clip]'))

  const ghostsIn = (flow: HTMLElement) => {
    const clip = clipOf(flow)
    return clip ? [...clip.querySelectorAll<HTMLElement>('[data-wrap-ghost]')] : []
  }

  // Only what the flow owns, so a stray animation is attributable.
  const animsOf = (flow: HTMLElement) =>
    flow.getAnimations({ subtree: true }).filter((anim) => {
      if (anim.id === 'scritto-width') return true
      const target = anim.effect && 'target' in anim.effect ? anim.effect.target : null
      return target instanceof HTMLElement && (target.hasAttribute('data-word') || target.hasAttribute('data-wrap-ghost'))
    })

  const opacityRange = (el: HTMLElement) => {
    for (const anim of el.getAnimations()) {
      const effect = anim.effect
      if (!(effect instanceof KeyframeEffect)) continue
      const frames = effect.getKeyframes().filter((frame) => frame.opacity != null)
      if (frames.length > 1) return [Number(frames[0].opacity), Number(frames[frames.length - 1].opacity)]
    }
    return [NaN, NaN]
  }

  const gridOf = (flow: HTMLElement): Grid | null => {
    const clip = clipOf(flow)
    if (!clip) return null
    const origin = clip.getBoundingClientRect().top
    const tops = [...new Set(wordsIn(flow).map((word) => Math.round(word.getBoundingClientRect().top - origin)))].sort(
      (a, b) => a - b,
    )
    if (!tops.length) return null
    // Averaging the gaps assumes every line is occupied, which a stanza break
    // breaks. Take the closest pair as the step, then fit it to the whole span
    // so each top's rounding averages out instead of accumulating.
    const gaps = tops.slice(1).map((top, i) => top - tops[i]).filter((gap) => gap > 2.5)
    const span = tops[tops.length - 1] - tops[0]
    const steps = gaps.length ? Math.round(span / Math.min(...gaps)) : 0
    return { base: tops[0], lineH: steps ? span / steps : 0, lines: tops.length }
  }

  const offGrid = (top: number, grid: Grid) => {
    if (!grid.lineH) return false
    const steps = (top - grid.base) / grid.lineH
    return Math.abs(steps - Math.round(steps)) * grid.lineH > 2.5
  }

  const shoot = (flow: HTMLElement, grid: Grid): Shot => {
    const clip = clipOf(flow)!
    const box = clip.getBoundingClientRect()
    const flowBox = flow.getBoundingClientRect()
    const mask = getComputedStyle(clip).maskImage || getComputedStyle(clip).webkitMaskImage
    const fadePx = fadePxOf(mask)
    const fadeIntoContent = Math.max(0, box.left + fadePx - flowBox.left)
    const words = wordsIn(flow)
    const standing = words.filter((word) => word.style.visibility !== 'hidden')
    const fadedStarts = standing
      .filter((word) => {
        const rect = word.getBoundingClientRect()
        return rect.left - flowBox.left < 2 && fadeIntoContent > 2
      })
      .map((word) => ({
        text: word.textContent ?? '',
        left: word.getBoundingClientRect().left - flowBox.left,
      }))
    return {
      words: words.length,
      hidden: words
        .filter((word) => word.style.visibility === 'hidden')
        .map((word) => {
          const rect = word.getBoundingClientRect()
          return { top: rect.top - box.top, left: rect.left - box.left }
        }),
      offGridWords: words
        .filter((word) => offGrid(word.getBoundingClientRect().top - box.top, grid))
        .slice(0, 6)
        .map((word) => ({
          top: Math.round(word.getBoundingClientRect().top - box.top),
          text: word.textContent ?? '',
        })),
      ghosts: ghostsIn(flow).map((ghost) => {
        const rect = ghost.getBoundingClientRect()
        const [from, to] = opacityRange(ghost)
        return {
          top: rect.top - box.top,
          left: rect.left - box.left,
          pinTop: parseFloat(ghost.style.top) || 0,
          pinLeft: parseFloat(ghost.style.left) || 0,
          from,
          to,
        }
      }),
      anims: animsOf(flow).length,
      lines: grid.lines,
      fadeIntoContent,
      fadePx,
      fadedStarts,
    }
  }

  const hostOf = (flow: HTMLElement) => flow.querySelector<Host>('scritto-text')

  const drive = (flow: HTMLElement, value: string) => {
    const host = hostOf(flow)
    if (!host) return false
    host.setOptions({ respectMotionPreference: false })
    host.update(value, true)
    return true
  }

  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

  const lineTops = (flow: HTMLElement) => {
    const origin = flow.getBoundingClientRect().top
    return wordsIn(flow).map((word) => Math.round(word.getBoundingClientRect().top - origin))
  }

  // `scritto-text` renders instantly off screen, so this has to test what it
  // tests — the box against every clipping ancestor, not just the viewport.
  const clipOfEl = (el: HTMLElement) => {
    let top = 0
    let left = 0
    let bottom = window.innerHeight
    let right = window.innerWidth
    for (let node = el.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.overflow === 'visible' && style.overflowX === 'visible' && style.overflowY === 'visible') continue
      const rect = node.getBoundingClientRect()
      top = Math.max(top, rect.top)
      left = Math.max(left, rect.left)
      bottom = Math.min(bottom, rect.bottom)
      right = Math.min(right, rect.right)
    }
    return { top, left, bottom, right }
  }

  const onscreen = (el: HTMLElement) => {
    const clip = clipOfEl(el)
    if (clip.bottom <= clip.top || clip.right <= clip.left) return false
    const rect = el.getBoundingClientRect()
    return rect.bottom > clip.top && rect.top < clip.bottom && rect.right > clip.left && rect.left < clip.right
  }

  // Whatever actually scrolls the flow, which may be a stage rather than the page.
  const scrollerOf = (el: HTMLElement) => {
    for (let node = el.parentElement; node; node = node.parentElement) {
      if (/auto|scroll|hidden/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1) {
        return node
      }
    }
    return null
  }

  const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

  const hostsIn = (flow: HTMLElement) => [...flow.querySelectorAll<HTMLElement>('scritto-text')]

  // Neither `getAnimations({ subtree: true })` nor a light-DOM query reaches
  // into a shadow root, so a still-growing host would count as idle.
  const rollAnims = (flow: HTMLElement) =>
    hostsIn(flow).reduce((total, host) => total + (host.shadowRoot?.getAnimations().length ?? 0), 0)

  // Host width belongs here: it keeps growing after the roll ends, when the
  // value collapses from spans to a text node, while the line count has not
  // moved — so watching the words alone reads as settled mid-growth.
  const geometryOf = (flow: HTMLElement) =>
    `${lineTops(flow).join(',')}|${hostsIn(flow)
      .map((host) => Math.round(host.getBoundingClientRect().width))
      .join(',')}`

  // Rest is the geometry holding still, not an empty animation list: the flow
  // is briefly idle between a value landing and its animations existing.
  // Teardown runs off a timer, so each turn yields a macrotask.
  const rest = async (flow: HTMLElement, limit = 300) => {
    let geometry = ''
    let quiet = 0
    for (let i = 0; i < limit; i++) {
      await frame()
      await macrotask()
      const busy =
        flow.getAnimations({ subtree: true }).length ||
        rollAnims(flow) ||
        ghostsIn(flow).length ||
        wordsIn(flow).some((word) => word.style.visibility === 'hidden' || word.style.transform)
      const next = geometryOf(flow)
      quiet = !busy && next === geometry ? quiet + 1 : 0
      geometry = next
      if (quiet >= 5) return true
    }
    return false
  }

  Object.assign(window, {
    __FLOW__: {
      count: () => flowsIn().length,
      masks: () =>
        flowsIn().map((flow, i) => {
          const clip = clipOf(flow)
          const mask = clip ? getComputedStyle(clip).maskImage || getComputedStyle(clip).webkitMaskImage : ''
          const fadePx = fadePxOf(mask)
          const flowBox = flow.getBoundingClientRect()
          const clipBox = clip?.getBoundingClientRect()
          return {
            id: flow.id || `flow[${i}]`,
            clip: !!clip,
            mask,
            overflow: clip ? getComputedStyle(clip).overflow : '',
            fadePx,
            fadeIntoContent: clipBox ? Math.max(0, clipBox.left + fadePx - flowBox.left) : 0,
            overhangLeft: clipBox ? flowBox.left - clipBox.left : 0,
            overhangRight: clipBox ? clipBox.right - flowBox.right : 0,
          }
        }),
      settled: (selector: string) => {
        const flow = document.querySelector<HTMLElement>(selector)
        if (!flow) return null
        const grid = gridOf(flow)
        if (!grid) return null
        const words = wordsIn(flow)
        const clip = clipOf(flow)
        return {
          ghosts: ghostsIn(flow).length,
          clipChildren: clip?.childElementCount ?? 0,
          hidden: words.filter(
            (word) => word.style.visibility === 'hidden' || getComputedStyle(word).visibility === 'hidden',
          ).length,
          transformed: words.filter((word) => word.style.transform).length,
          anims: animsOf(flow).length,
          grid,
          offGridWords: shoot(flow, grid).offGridWords,
        }
      },
      // Samples every frame, so assertions see the transition and not its ends.
      record: async (selector: string, from: string, to: string, frames: number, recentre: boolean) => {
        const flow = document.querySelector<HTMLElement>(selector)
        if (!flow) return { error: `no flow at ${selector}` }
        const host = hostOf(flow)
        if (!host) return { error: `no scritto-text inside ${selector}` }
        // Every change, not only once out of view: growing the paragraph makes
        // the browser re-anchor the scroll, and that drift accumulates until
        // the host renders off screen. Scroll-specific cases opt out.
        if (recentre) {
          flow.scrollIntoView({ block: 'center' })
          await frame()
        }
        // Unanimated, so the measured change is the one the case is about.
        host.setOptions({ respectMotionPreference: false })
        host.update(from, false)
        const seedRested = await rest(flow)
        const grid = gridOf(flow)
        if (!grid) return { error: `no clip or no words in ${selector}` }
        const rectAt = flow.getBoundingClientRect()
        const tops = lineTops(flow)
        const before = {
          text: host.textContent ?? '',
          lines: grid.lines,
          scrollY: Math.round(window.scrollY),
          top: Math.round(rectAt.top),
          bottom: Math.round(rectAt.bottom),
          viewportH: window.innerHeight,
          hostOnscreen: onscreen(host),
        }
        if (!drive(flow, to)) return { error: `no scritto-text inside ${selector}` }
        // Past the end rather than the first quiet frame, which can land before
        // the animations exist.
        const shots: Shot[] = []
        let sawActivity = false
        for (let i = 0; i < frames; i++) {
          await frame()
          const shot = shoot(flow, grid)
          shots.push(shot)
          if (shot.ghosts.length || shot.hidden.length || shot.anims) sawActivity = true
          if (sawActivity && !animsOf(flow).length && !ghostsIn(flow).length) break
        }
        // Measured at rest, not inferred from ghosts, so a stale scenario and a
        // broken handoff report differently.
        const rested = await rest(flow)
        const settledTops = lineTops(flow)
        const movedLines = tops.filter((top, i) => settledTops[i] !== undefined && Math.abs(settledTops[i] - top) > 2).length
        const after = { text: host.textContent ?? '', lines: gridOf(flow)?.lines ?? 0 }
        return {
          grid,
          shots,
          before,
          after,
          movedLines,
          peakAnims: Math.max(0, ...shots.map((shot) => shot.anims)),
          seedTops: [...new Set(tops)].sort((a, b) => a - b),
          settledTops: [...new Set(settledTops)].sort((a, b) => a - b),
          hostW: Math.round(host.getBoundingClientRect().width),
          seedRested,
          rested,
        }
      },
      // Scrolling on purpose: only on-screen words are measured, so each
      // generation's slice differs, which is what strands a word hidden outside
      // the next one if teardown is keyed to the slice.
      hammer: async (selector: string, values: string[], gap: number, scroll = 0) => {
        const flow = document.querySelector<HTMLElement>(selector)
        if (!flow) return { error: `no flow at ${selector}` }
        const rect = flow.getBoundingClientRect()
        if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
          flow.scrollIntoView({ block: 'center' })
          await frame()
        }
        const scroller = scrollerOf(flow)
        for (const value of values) {
          drive(flow, value)
          if (scroll) {
            if (scroller) scroller.scrollTop += scroll
            else window.scrollBy(0, scroll)
          }
          const until = performance.now() + gap
          while (performance.now() < until) await frame()
        }
        return { ok: true }
      },
    },
  })
}

declare global {
  interface Window {
    __FLOW__: FlowApi
  }
}

/** What a `<scritto-text>` exposes to the harness, in the page's own context. */
type Host = HTMLElement & {
  value: string
  update(value: string, animate?: boolean): void
  setOptions(options: { respectMotionPreference: boolean }): void
}

type FlowApi = {
  count(): number
  masks(): {
    id: string
    clip: boolean
    mask: string
    overflow: string
    fadePx: number
    fadeIntoContent: number
    overhangLeft: number
    overhangRight: number
  }[]
  settled(selector: string): {
    ghosts: number
    clipChildren: number
    hidden: number
    transformed: number
    anims: number
    grid: { base: number; lineH: number; lines: number }
    offGridWords: { top: number; text: string }[]
  } | null
  record(
    selector: string,
    from: string,
    to: string,
    frames: number,
    recentre: boolean,
  ): Promise<{
    error?: string
    grid?: { base: number; lineH: number; lines: number }
    shots?: {
      words: number
      hidden: { top: number; left: number }[]
      offGridWords: { top: number; text: string }[]
      ghosts: { top: number; left: number; pinTop: number; pinLeft: number; from: number; to: number }[]
      anims: number
      lines: number
      fadeIntoContent: number
      fadePx: number
      fadedStarts: { text: string; left: number }[]
    }[]
    before?: {
      text: string
      lines: number
      scrollY: number
      top: number
      bottom: number
      viewportH: number
      hostOnscreen: boolean
    }
    after?: { text: string; lines: number }
    movedLines?: number
    peakAnims?: number
    seedTops?: number[]
    settledTops?: number[]
    hostW?: number
    seedRested?: boolean
    rested?: boolean
  }>
  hammer(selector: string, values: string[], gap: number, scroll?: number): Promise<{ error?: string; ok?: boolean }>
}

const api = (page: Page) => {
  // Vite reloads on every core edit, destroying the context an evaluate runs
  // in. Wait for it to land and retry; the init script re-runs with it.
  const run = async <A, T>(body: (arg: A) => Promise<T> | T, arg: A): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await page.evaluate(body, arg)
      } catch (error) {
        if (attempt >= 2 || !/Execution context was destroyed|frame was detached/.test(String(error))) throw error
        await page.waitForLoadState('load')
        await page.waitForTimeout(900)
      }
    }
  }

  return {
    count: () => run(() => window.__FLOW__.count(), undefined),
    masks: () => run(() => window.__FLOW__.masks(), undefined),
    settled: (selector: string) => run((sel: string) => window.__FLOW__.settled(sel), selector),
    record: (selector: string, from: string, to: string, frames = 90, recentre = true) =>
      run((args) => window.__FLOW__.record(args.selector, args.from, args.to, args.frames, args.recentre), {
        selector,
        from,
        to,
        frames,
        recentre,
      }),
    hammer: (selector: string, values: string[], gap = 70, scroll = 0) =>
      run((args) => window.__FLOW__.hammer(args.selector, args.values, args.gap, args.scroll), {
        selector,
        values,
        gap,
        scroll,
      }),
  }
}

const round = (n: number) => Math.round(n * 10) / 10

const checkMasks = (
  masks: {
    id: string
    clip: boolean
    mask: string
    overflow: string
    fadePx: number
    fadeIntoContent: number
    overhangLeft: number
    overhangRight: number
  }[],
  out: Report,
) => {
  for (const entry of masks) {
    if (!entry.clip) {
      out.violations.push({ flow: entry.id, rule: 'clip-overlay', detail: 'no [data-wrap-clip] child on the flow' })
      continue
    }
    const horizontal = /linear-gradient\(\s*(90deg|to right)/.test(entry.mask)
    const fades = /transparent|rgba\(0, 0, 0, 0\)/.test(entry.mask)
    if (!horizontal || !fades) {
      out.violations.push({
        flow: entry.id,
        rule: 'clip-mask',
        detail: `clip mask-image must be a horizontal gradient fading at both edges, got ${entry.mask || '<none>'}`,
      })
    }
    if (!/hidden|clip/.test(entry.overflow)) {
      out.violations.push({
        flow: entry.id,
        rule: 'clip-overflow',
        detail: `clip must hide overflow so ghosts stop at the paragraph edge, got overflow:${entry.overflow}`,
      })
    }
    // The fade must sit in the gutters. A clip that matches the flow box
    // (old inset:0) puts the ramp on the first glyph of every wrapped line.
    if (entry.overhangLeft < 8 || entry.overhangRight < 8 || entry.fadeIntoContent > 2) {
      out.violations.push({
        flow: entry.id,
        rule: 'clip-gutter',
        detail: `mask fade starts ${round(entry.fadeIntoContent)}px inside the flow content box (clip overhang ${round(entry.overhangLeft)}/${round(entry.overhangRight)}px, fade ${round(entry.fadePx)}px) — the ramp must live in the gutters, not on the text`,
      })
    }
  }
}

const checkTransition = async (
  page: Page,
  label: string,
  selector: string,
  from: string,
  to: string,
  out: Report,
  expectWrap = false,
  recentre = true,
  frames = 90,
) => {
  const result = await api(page).record(selector, from, to, frames, recentre)
  if (result.error || !result.shots || !result.grid) {
    out.violations.push({ flow: label, rule: 'drive', detail: result.error ?? 'no samples' })
    return
  }
  // A verdict measured on a page that never stopped moving is not worth reading,
  // so say that instead of letting it turn into a claim about the handoff.
  if (result.seedRested === false || result.rested === false) {
    out.violations.push({
      flow: label,
      rule: 'not-at-rest',
      detail: `the paragraph never stopped moving (before the change: ${result.seedRested}, after: ${result.rested}) — every other assertion for this case would be measured mid-flight`,
    })
    return
  }
  const { grid, shots } = result
  let sawGhosts = false
  let peakHidden = 0
  let sampleIndex = 0

  for (const shot of shots) {
    sampleIndex++
    if (shot.ghosts.length) sawGhosts = true
    peakHidden = Math.max(peakHidden, shot.hidden.length)

    // A re-wrap moves about one word per line. Everything at once means the two
    // measurements disagreed about the origin, so name that first.
    const ceiling = Math.max(4, shot.lines * 3)
    if (shot.hidden.length > ceiling) {
      out.violations.push({
        flow: label,
        rule: 'mass-ghost',
        detail: `frame ${sampleIndex}: ${shot.hidden.length} of ${shot.words} words ghosted across ${shot.lines} lines (ceiling ${ceiling}) — a re-wrap should move about one word per line`,
      })
      break
    }

    if (shot.offGridWords.length) {
      const worst = shot.offGridWords[0]
      out.violations.push({
        flow: label,
        rule: 'line-grid-words',
        detail: `frame ${sampleIndex}: ${shot.offGridWords.length} word(s) off the line grid (base ${round(grid.base)}, lineH ${round(grid.lineH)}); e.g. "${worst.text}" at top ${worst.top} — words must never travel vertically`,
      })
      break
    }

    const stray = shot.ghosts.filter((ghost) => {
      const steps = (ghost.top - grid.base) / (grid.lineH || 1)
      return grid.lineH ? Math.abs(steps - Math.round(steps)) * grid.lineH > GRID_TOL : false
    })
    if (stray.length) {
      out.violations.push({
        flow: label,
        rule: 'line-grid-ghosts',
        detail: `frame ${sampleIndex}: ${stray.length} ghost(s) off the line grid (base ${round(grid.base)}, lineH ${round(grid.lineH)}); e.g. top ${round(stray[0].top)} — ghosts must stay on the line they left or joined`,
      })
      break
    }

    if (shot.ghosts.length !== shot.hidden.length * 2) {
      out.violations.push({
        flow: label,
        rule: 'ghost-pairs',
        detail: `frame ${sampleIndex}: ${shot.hidden.length} hidden word(s) but ${shot.ghosts.length} ghost(s); each word that changes line needs exactly one leaving and one entering ghost`,
      })
      break
    }

    const rising = shot.ghosts.filter((ghost) => ghost.to > ghost.from)
    const falling = shot.ghosts.filter((ghost) => ghost.to < ghost.from)
    if (rising.length !== shot.hidden.length || falling.length !== shot.hidden.length) {
      out.violations.push({
        flow: label,
        rule: 'ghost-fade',
        detail: `frame ${sampleIndex}: ${rising.length} ghost(s) fading in and ${falling.length} fading out for ${shot.hidden.length} hidden word(s); the pair must animate opacity in opposite directions`,
      })
      break
    }

    const unpaired = shot.hidden.filter(
      (word) =>
        rising.filter(
          (ghost) => Math.abs(ghost.pinTop - word.top) < PIN_TOL && Math.abs(ghost.pinLeft - word.left) < PIN_TOL,
        ).length !== 1,
    )
    if (unpaired.length) {
      out.violations.push({
        flow: label,
        rule: 'ghost-anchor',
        detail: `frame ${sampleIndex}: ${unpaired.length} hidden word(s) have no single entering ghost pinned at their new box; first at top ${round(unpaired[0].top)} left ${round(unpaired[0].left)}, ghost pins ${rising.map((g) => `${round(g.pinLeft)},${round(g.pinTop)}`).join(' ')}`,
      })
      break
    }

    if (shot.fadeIntoContent > 2) {
      out.violations.push({
        flow: label,
        rule: 'clip-gutter',
        detail: `frame ${sampleIndex}: mask fade starts ${round(shot.fadeIntoContent)}px inside the flow content box — a content-box-wide mask fades the first glyph of every wrapped line`,
      })
      break
    }

    if (shot.fadedStarts.length) {
      const worst = shot.fadedStarts[0]
      out.violations.push({
        flow: label,
        rule: 'line-start-fade',
        detail: `frame ${sampleIndex}: standing line-start glyph "${worst.text}" is under the clip fade at x ${round(worst.left)} — line starts must stay fully opaque`,
      })
      break
    }

    const fadedPins = shot.ghosts.filter((ghost) => ghost.pinLeft < shot.fadePx - 2)
    if (fadedPins.length) {
      out.violations.push({
        flow: label,
        rule: 'line-start-fade',
        detail: `frame ${sampleIndex}: ${fadedPins.length} ghost(s) pinned inside the fade (pinLeft ${round(fadedPins[0].pinLeft)} < fade ${round(shot.fadePx)}) — wrap ghosts must rest in the opaque middle, not on the ramp`,
      })
      break
    }
  }

    const ghostShots = shots.filter((shot) => shot.ghosts.length)
    // A wrap lasting a frame or two is the clip being dropped on first finish.
    if (expectWrap && (sawGhosts || (result.movedLines ?? 0) > 0) && ghostShots.length < 6) {
      out.violations.push({
        flow: label,
        rule: 'instant-settle',
        detail: `wrap fade lasted ${ghostShots.length} frame(s) across ${shots.length} sample(s) going ${from} → ${to} — ghosts must stay for the transition, not get dropped the moment anything finishes`,
      })
      return
    }

    if (sawGhosts || peakHidden) return

  // Two reasons, opposite fixes: the re-wrap never moved a word (stale values),
  // or it did and the handoff was missing (a regression, or rendered off screen).
  const { before, after, movedLines = 0, peakAnims = 0 } = result
  const where = before
    ? `flow top ${before.top} bottom ${before.bottom} in a ${before.viewportH}px viewport at scrollY ${before.scrollY}, host onscreen ${before.hostOnscreen}`
    : 'no context captured'
  const rendered = `text ${JSON.stringify(before?.text ?? '')}→${JSON.stringify(after?.text ?? '')}, lines ${before?.lines ?? 0}→${after?.lines ?? 0}`

  if (movedLines > 0) {
    out.violations.push({
      flow: label,
      rule: 'missed-handoff',
      detail: `${movedLines} word(s) did change line going ${from} → ${to}, but no ghost and no hidden word was ever sampled across ${shots.length} frames (${rendered}, peak ${peakAnims} animation(s), ${where}) — the re-wrap happened with no handoff`,
    })
    return
  }

  const detail = `no word changed line going ${from} → ${to}, so the ghost handoff never ran — this case exists to exercise it (${rendered}, line tops ${JSON.stringify(result.seedTops)}→${JSON.stringify(result.settledTops)}, host ${result.hostW}px wide, ${where})`
  if (expectWrap) out.violations.push({ flow: label, rule: 'no-wrap', detail })
  else out.notes.push(`${label}: ${detail}`)
}

const checkSettled = async (page: Page, label: string, selector: string, out: Report) => {
  const deadline = Date.now() + SETTLE_MS
  let last = await api(page).settled(selector)
  while (Date.now() < deadline) {
    if (
      last &&
      !last.ghosts &&
      !last.clipChildren &&
      !last.hidden &&
      !last.transformed &&
      !last.anims &&
      !last.offGridWords.length
    ) {
      return
    }
    await page.waitForTimeout(120)
    last = await api(page).settled(selector)
  }
  if (!last) {
    out.violations.push({ flow: label, rule: 'settle', detail: `flow ${selector} vanished` })
    return
  }
  out.violations.push({
    flow: label,
    rule: 'settle',
    detail: `still not clean ${SETTLE_MS}ms after the last change: ${last.ghosts} leftover ghost(s), ${last.clipChildren} clip child(ren), ${last.hidden} word(s) stuck at visibility:hidden, ${last.transformed} stray inline transform(s), ${last.anims} running animation(s), ${last.offGridWords.length} word(s) off the line grid`,
  })
}

const reachable = await fetch(BASE, { signal: AbortSignal.timeout(4000) }).then(
  (res) => res.ok,
  () => false,
)
if (!reachable) {
  console.error(`no dev server at ${BASE} — start it with \`bun run play\` (or set FLOW_URL) and run this again`)
  process.exit(1)
}

const browser = await chromium.launch({ channel: 'chrome', headless: process.env.FLOW_HEADED !== '1' })
const context = await browser.newContext({ viewport: { width: 900, height: 780 }, deviceScaleFactor: 2 })
await context.addInitScript(install)
const page = await context.newPage()
page.on('pageerror', (error) => console.error(`[page error] ${error.message}`))

const report: Report = { violations: [], notes: [] }
const failed: string[] = []

// A core edit reloads the page mid-goto; that is the dev server, not a failure.
const visit = async (path: string) => {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: 'load' })
      break
    } catch (error) {
      if (attempt >= 3 || !/interrupted by another navigation/.test(String(error))) throw error
      await page.waitForTimeout(500)
    }
  }
  // Wrap points depend on the webfont, so which values re-wrap would be timing.
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page.waitForTimeout(900)
}

const scenario = async (name: string, run: () => Promise<void>) => {
  const before = report.violations.length
  process.stdout.write(`· ${name}\n`)
  try {
    await run()
  } catch (error) {
    report.violations.push({ flow: name, rule: 'threw', detail: String(error) })
  }
  const added = report.violations.slice(before)
  if (added.length) failed.push(name)
  for (const item of added) console.log(`  FAIL [${item.rule}] ${item.flow}: ${item.detail}`)
  if (!added.length) console.log('  ok')
}

// 1. Every flow on the marketing pages carries the overlay and its edge mask.
for (const path of ['/', '/playground', '/look.html']) {
  await scenario(`${path} clip + mask`, async () => {
    await visit(path)
    const count = await api(page).count()
    if (!count) {
      report.violations.push({ flow: path, rule: 'no-flows', detail: 'page has no <scritto-flow>' })
      return
    }
    checkMasks(await api(page).masks(), report)
  })
}

// 2. The wrapped playground card, both directions, then hammered. Only
//    `#flow-wrap`: `#flow-sentence` is one line and cannot send a word round a
//    corner, so it appears in the hammer scenario instead.
await scenario('playground wrapped card grows and shrinks', async () => {
  await visit('/playground')
  for (const [from, to] of GROW_SHRINK) {
    await checkTransition(page, `#flow-wrap ${from}→${to}`, '#flow-wrap', from, to, report, true)
    await checkSettled(page, `#flow-wrap ${from}→${to}`, '#flow-wrap', report)
  }
})

await scenario('playground wrapped card keeps its height', async () => {
  await visit('/playground')
  const measure = async (value: string) => {
    await page.evaluate((next) => {
      const host = document.querySelector<Host>('#flow-b')
      if (!host) return
      host.setOptions({ respectMotionPreference: false })
      host.update(next, false)
    }, value)
    await page.waitForTimeout(200)
    return page.evaluate(() => {
      const flow = document.querySelector<HTMLElement>('#flow-wrap')
      const figure = flow?.closest<HTMLElement>('.figure') ?? null
      const footer = document.querySelector('footer')
      return {
        figureH: figure ? Math.round(figure.getBoundingClientRect().height * 10) / 10 : 0,
        footerY: footer ? Math.round(footer.getBoundingClientRect().top * 10) / 10 : 0,
      }
    })
  }
  const tall = await measure('1,234,567')
  const short = await measure('12')
  const tallAgain = await measure('1,234,567')
  if (!tall.figureH || !short.figureH) {
    report.violations.push({ flow: '#flow-wrap', rule: 'card-height', detail: 'could not measure the wrap card' })
    return
  }
  if (Math.abs(tall.figureH - short.figureH) > 1 || Math.abs(tall.figureH - tallAgain.figureH) > 1) {
    report.violations.push({
      flow: '#flow-wrap',
      rule: 'card-height',
      detail: `card height changed across wrap states: 1,234,567=${tall.figureH} 12=${short.figureH} 1,234,567=${tallAgain.figureH}`,
    })
  }
  if (Math.abs(tall.footerY - short.footerY) > 1) {
    report.violations.push({
      flow: '#flow-wrap',
      rule: 'card-height',
      detail: `footer jumped ${short.footerY - tall.footerY}px when the wrap went 4 lines → 3 (Y ${tall.footerY} → ${short.footerY})`,
    })
  }
})

await scenario('playground hammered', async () => {
  await visit('/playground')
  const values = ['1', '1,234,567', '12', '999,999', '1,204', '88', '7,654,321', '3', '456,789', '21', '1,000,000', '9']
  for (const selector of ['#flow-wrap', '#flow-sentence']) {
    const result = await api(page).hammer(selector, values, 70)
    if (result.error) {
      report.violations.push({ flow: selector, rule: 'hammer', detail: result.error })
      continue
    }
    await checkSettled(page, `${selector} hammered ×${values.length}`, selector, report)
  }
})

// 3. A long paragraph inside a clipped, scrollable stage: the case where only a
//    slice of the words is measured.
await scenario('look.html clipped paragraph', async () => {
  await visit('/look.html')
  const selector = '#paragraph scritto-flow'
  if (!(await page.locator(selector).count())) {
    report.notes.push('look.html has no #paragraph flow — skipped the clipped-slice case')
    return
  }
  for (const [from, to] of GROW_SHRINK) {
    await checkTransition(page, `look #paragraph ${from}→${to}`, selector, from, to, report, true)
    await checkSettled(page, `look #paragraph ${from}→${to}`, selector, report)
  }
  await page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('#paragraph > div')
    if (stage) stage.scrollTop = Math.round(stage.scrollHeight / 2)
  })
  await page.waitForTimeout(150)
  // This case is about the stage's scroll offset, so it must not be re-centred.
  await checkTransition(page, 'look #paragraph scrolled 1→1,234,567', selector, '1', '1,234,567', report, true, false)
  await checkSettled(page, 'look #paragraph scrolled', selector, report)
})

// 4. Changes landing on top of each other while the paragraph scrolls, so each
//    generation measures a different slice and a word hidden by one can fall
//    outside the next.
await scenario('hammered while scrolling', async () => {
  await visit('/look.html')
  const values = ['1', '1,234,567', '12', '999,999', '1,204', '88', '7,654,321', '3', '456,789', '21', '1,000,000', '9']
  for (const selector of ['#paragraph scritto-flow', '#lines scritto-flow:last-of-type']) {
    if (!(await page.locator(selector).count())) {
      report.notes.push(`look.html has no ${selector} — skipped its scrolling hammer`)
      continue
    }
    for (const step of [24, -24]) {
      const result = await api(page).hammer(selector, values, 60, step)
      if (result.error) {
        report.violations.push({ flow: selector, rule: 'hammer', detail: result.error })
        continue
      }
      await checkSettled(page, `${selector} hammered ×${values.length} scrolling ${step}px`, selector, report)
    }
  }
})

// 5. Paragraph parked at the bottom of the viewport: growing it lengthens the
//    document and can clamp the scroll under the measurement.
await scenario('paragraph at the bottom of the page', async () => {
  await visit('/look.html')
  const selector = '#lines scritto-flow:last-of-type'
  if (!(await page.locator(selector).count())) {
    report.notes.push('look.html has no #lines flows — skipped the bottom-of-page case')
    return
  }
  const park = () =>
    page.evaluate((sel) => {
      const flow = document.querySelector<HTMLElement>(sel)
      if (!flow) return
      const top = flow.getBoundingClientRect().top + window.scrollY
      window.scrollTo(0, Math.max(0, top - window.innerHeight + flow.offsetHeight + 8))
    }, selector)
  for (const [from, to] of GROW_SHRINK.slice(0, 2)) {
    // Re-park every time: the previous change altered the document height, so the
    // paragraph is no longer where this case needs it.
    await park()
    await page.waitForTimeout(200)
    await checkTransition(page, `bottom flow ${from}→${to}`, selector, from, to, report, true, false)
    await checkSettled(page, `bottom flow ${from}→${to}`, selector, report)
  }
  await page.screenshot({ path: `${OUT}-bottom.png` })
})

// 6. The homepage live sentence: several hosts sharing one flow, updated on timers.
await scenario('homepage live sentence', async () => {
  await visit('/')
  const selector = 'scritto-flow'
  await checkTransition(page, 'home sentence 1→1,234,567', selector, '1', '1,234,567', report)
  await checkSettled(page, 'home sentence', selector, report)
})

// 7. A value hammered across widths must not leave the box dressed for a
// transition, and must not push its paragraph onto another line while it runs.
// The width transition survives across updates now, so its teardown is only ever
// reached by the animation finishing.
await scenario('hammered across widths leaves no layout behind', async () => {
  await visit('/playground')
  await page.evaluate(() => {
    const prose = document.createElement('p')
    prose.id = 'width-probe'
    prose.style.cssText = 'width:214px;font:400 16px system-ui;line-height:1.4;margin:0'
    prose.innerHTML = 'Total <scritto-text id="width-probe-host">9</scritto-text> items sold'
    document.body.prepend(prose)
  })
  await page.waitForTimeout(300)

  const readState = () =>
    page.evaluate(() => {
      const host = document.querySelector('#width-probe-host')
      const prose = document.querySelector('#width-probe')
      if (!(host instanceof HTMLElement) || !(prose instanceof HTMLElement)) return null
      const css = getComputedStyle(host)
      const range = document.createRange()
      range.selectNodeContents(prose)
      return {
        display: css.display,
        marginEnd: css.marginInlineEnd,
        clip: host.getAttribute('data-shrink-clip'),
        inlineWidth: host.style.width,
        lines: range.getClientRects().length,
      }
    })

  const before = await readState()
  const peakLines = await page.evaluate(async () => {
    const host = document.querySelector('#width-probe-host')
    const prose = document.querySelector('#width-probe')
    if (!(host instanceof HTMLElement) || !(prose instanceof HTMLElement)) return 0
    // SAFETY: the element is <scritto-text>, upgraded by the time the page has
    // loaded, so it carries the component's own setOptions and update.
    const roll = host as HTMLElement & {
      setOptions: (o: { respectMotionPreference: boolean; transition: { duration: number } }) => void
      update: (v: string, animate: boolean) => void
    }
    roll.setOptions({ respectMotionPreference: false, transition: { duration: 590 } })
    const values = ['9', '99', '999', '9,999', '99,999', '999,999', '9,999', '999', '99']
    let peak = 0
    for (let i = 0; i < 45; i++) {
      roll.update(values[i % values.length], true)
      await new Promise((resolve) => setTimeout(resolve, 25))
      const range = document.createRange()
      range.selectNodeContents(prose)
      peak = Math.max(peak, range.getClientRects().length)
    }
    return peak
  })
  await page.waitForTimeout(2500)
  const after = await readState()

  if (!before || !after) {
    report.violations.push({ flow: 'width probe', rule: 'drive', detail: 'probe did not mount' })
    return
  }
  if (peakLines > before.lines) {
    report.violations.push({
      flow: 'width probe',
      rule: 'wrap',
      detail: `hammering took the paragraph from ${before.lines} line boxes to ${peakLines}`,
    })
  }
  for (const [rule, was, now] of [
    ['display', before.display, after.display],
    ['margin-inline-end', before.marginEnd, after.marginEnd],
    ['shrink-clip', String(before.clip), String(after.clip)],
    ['inline width', before.inlineWidth, after.inlineWidth],
    ['line boxes', String(before.lines), String(after.lines)],
  ] as const) {
    if (was !== now) {
      report.violations.push({ flow: 'width probe', rule: 'teardown', detail: `${rule} left at ${now}, was ${was}` })
    }
  }
})

await page.screenshot({ path: `${OUT}-home.png` })
await browser.close()

for (const note of report.notes) console.log(`note: ${note}`)

if (report.violations.length) {
  console.error(`\n${report.violations.length} flow invariant violation(s) across: ${failed.join(', ')}`)
  process.exit(1)
}
console.log('\nflow invariants hold')
