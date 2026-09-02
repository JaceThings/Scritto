import { gzipSync, Glob } from 'bun'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'

const PACKAGES_ROOT = 'packages'
const SHIPPED = new Glob('**/*.{js,mjs,css,vue,svelte}')

export type Size = { name: string; bytes: number }

export const sizes = (): Size[] => {
  if (!existsSync(PACKAGES_ROOT)) {
    console.error(`[X] Directory "${PACKAGES_ROOT}" not found`)
    process.exit(1)
  }
  return readdirSync(PACKAGES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const dir = join(PACKAGES_ROOT, entry.name)
      const manifest = join(dir, 'package.json')
      const dist = join(dir, 'dist')
      if (!existsSync(dist) || !existsSync(manifest)) return []
      let bytes = 0
      for (const file of SHIPPED.scanSync(dist)) bytes += gzipSync(readFileSync(join(dist, file))).length
      return bytes ? [{ name: JSON.parse(readFileSync(manifest, 'utf-8')).name as string, bytes }] : []
    })
}

export const kb = (bytes: number) => bytes / 1024

if (import.meta.main) {
  console.log('Bundle Sizes (Gzipped):')
  console.log('-'.repeat(35))
  for (const { name, bytes } of sizes()) console.log(`${name.padEnd(22)} ${kb(bytes).toFixed(2).padStart(6)}KB`)
  console.log('-'.repeat(35))
}
