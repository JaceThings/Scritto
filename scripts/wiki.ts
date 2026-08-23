/**
 * Publishes `docs/` to the GitHub wiki. The repo is the source of truth; the
 * wiki is a mirror, so nothing here edits prose — only filenames and the links
 * between them, which have to become wiki page names.
 */
import { $ } from 'bun'
import { readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const WIKI = 'https://github.com/JaceThings/Scritto.wiki.git'
const CLONE = '.wiki'

const PAGES = new Map([
  ['README.md', 'Home'],
  ['how-it-works.md', 'How-the-Roll-Works'],
  ['what-apple-does.md', 'What-SwiftUI-Does'],
  ['cases.md', 'Measured-Cases'],
  ['timing.md', 'Timing'],
  ['flow.md', 'Flow'],
  ['masking.md', 'Edges'],
  ['api.md', 'API'],
  ['testing.md', 'Testing'],
])

const unmapped = readdirSync('docs').filter((file) => file.endsWith('.md') && !PAGES.has(file))
if (unmapped.length > 0) {
  console.error(`[X] No wiki page name for: ${unmapped.join(', ')} — add it to PAGES`)
  process.exit(1)
}

rmSync(CLONE, { recursive: true, force: true })
await $`git clone --quiet ${WIKI} ${CLONE}`
for (const stale of readdirSync(CLONE).filter((file) => file.endsWith('.md'))) {
  rmSync(join(CLONE, stale))
}

for (const [file, page] of PAGES) {
  const body = readFileSync(join('docs', file), 'utf8').replace(
    /\]\(([\w-]+\.md)(#[\w-]+)?\)/g,
    (whole, target: string, anchor = '') => {
      const linked = PAGES.get(target)
      return linked ? `](${linked}${anchor})` : whole
    },
  )
  writeFileSync(join(CLONE, `${page}.md`), body)
}

await $`git -C ${CLONE} add --all`
if ((await $`git -C ${CLONE} status --porcelain`.text()).trim() === '') {
  console.log('Wiki already up to date.')
} else {
  await $`git -C ${CLONE} commit --quiet -m ${'Sync docs from the repo'}`
  await $`git -C ${CLONE} push --quiet`
  console.log(`Published ${PAGES.size} pages to the wiki.`)
}
rmSync(CLONE, { recursive: true, force: true })
