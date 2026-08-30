import { gzipSync, Glob } from 'bun';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const PACKAGES_ROOT = 'packages';

if (!existsSync(PACKAGES_ROOT)) {
  console.error(`[X] Directory "${PACKAGES_ROOT}" not found`);
  process.exit(1);
}

const packages = readdirSync(PACKAGES_ROOT, { withFileTypes: true })
  .filter((dirent) => dirent.isDirectory())
  .map((dirent) => dirent.name);

console.log('Bundle Sizes (Gzipped):');
console.log('-'.repeat(35));

for (const pkg of packages) {
  const pkgDir = join(PACKAGES_ROOT, pkg);
  const distDir = join(pkgDir, 'dist');
  const pkgJsonPath = join(pkgDir, 'package.json');

  if (!existsSync(distDir) || !existsSync(pkgJsonPath)) continue;

  const { name } = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));

  const glob = new Glob('**/*.{js,mjs,css,vue,svelte}');
  let totalSizeBytes = 0;
  for (const file of glob.scanSync(distDir)) {
    if (file.endsWith('.d.ts') || file.endsWith('.map')) continue;

    const content = readFileSync(join(distDir, file));
    totalSizeBytes += gzipSync(content).length;
  }

  if (totalSizeBytes === 0) continue;

  const kb = totalSizeBytes / 1024;
  console.log(`${name.padEnd(22)} ${kb.toFixed(2).padStart(6)}KB`);
}

console.log('-'.repeat(35));
