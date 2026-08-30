import { readdir } from "node:fs/promises";
import { $ } from "bun";

for (const dir of await readdir("packages")) {
  const manifest = Bun.file(`packages/${dir}/package.json`);
  if (!(await manifest.exists())) continue;

  const pkg = await manifest.json();
  const published = await fetch(`https://registry.npmjs.org/${pkg.name}/${pkg.version}`);
  if (published.ok) {
    console.log(`skipping ${pkg.name}@${pkg.version}, already on the registry`);
    continue;
  }
  await $`bun publish`.cwd(`packages/${dir}`);
}

await $`bunx changeset tag`;
