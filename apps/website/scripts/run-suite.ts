import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const suiteUrl = process.env.SUITE_URL ?? 'http://localhost:5175/suite.html?auto=1'
const OUT = process.env.SUITE_OUT ?? '/tmp/scritto-bench.json'
const EXPECTED = [
  'isolated-100',
  'isolated-400',
  'instant-400',
  'copy-spans-64',
  'copy-divs-64',
  'flow-short-32',
  'flow-wrap-12',
  'flow-lines-24',
  'flow-words-200',
  'flow-words-2000',
  'flow-words-5000',
  'flow-words-20000',
  'grow-shrink',
  'comma-peel',
  'bounce-off',
  'bounce-on',
  'rtl',
  'emoji',
  'text-morph',
  'long-digits',
]

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage()
page.setDefaultTimeout(600_000)
await page.goto(suiteUrl, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => (window as Window & { __BENCH__?: { done?: boolean } }).__BENCH__?.done === true)
const report = await page.evaluate(() => (window as Window & { __BENCH__?: unknown }).__BENCH__)
await browser.close()

writeFileSync(OUT, JSON.stringify(report, null, 2))

const cases = (report as { cases: { id: string; error: string | null }[] }).cases
const only = new URL(suiteUrl).searchParams.get('case')
const expected = only ? [only] : EXPECTED
const ids = new Set(cases.map((item) => item.id))
const missing = expected.filter((id) => !ids.has(id))
if (missing.length) {
  console.error(`missing cases: ${missing.join(', ')}`)
  process.exit(1)
}

for (const item of cases) {
  const mark = item.error ? 'ERR' : 'ok '
  console.log(`${mark} ${item.id}${item.error ? ` · ${item.error}` : ''}`)
}
console.log(`wrote ${OUT}`)
