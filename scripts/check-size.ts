import { kb, sizes } from './size'

const README = 'README.md'
// Two decimals is what the table prints, so anything under half a step is rounding.
const SLACK_KB = 0.005

const table = await Bun.file(README).text()
const claimed = new Map(
  [...table.matchAll(/\|\s*`(@scritto\/[a-z]+)`.*?\|\s*([\d.]+) KB\s*\|/g)].map(([, name, size]) => [name, Number(size)]),
)

const rows = sizes().map(({ name, bytes }) => ({ name, measured: kb(bytes), claimed: claimed.get(name) }))
const missing = [...claimed.keys()].filter((name) => !rows.some((row) => row.name === name))
const wrong = rows.filter((row) => row.claimed === undefined || Math.abs(row.claimed - row.measured) > SLACK_KB)

for (const { name, measured, claimed } of rows.sort((a, b) => b.measured - a.measured)) {
  const mark = wrong.some((row) => row.name === name) ? '!!' : 'ok'
  const says = claimed === undefined ? 'no row in the table' : `${claimed.toFixed(2)} KB claimed`
  console.log(`  ${mark}  ${name.padEnd(16)} ${measured.toFixed(2)} KB built, ${says}`)
}
for (const name of missing) console.log(`  !!  ${name.padEnd(16)} in the table, not in packages/`)

if (wrong.length || missing.length) {
  console.error(`\n${README} is out of date. Run \`bun run size\` and copy the numbers into the table.`)
  process.exit(1)
}
console.log(`\n${README} matches the built output`)
