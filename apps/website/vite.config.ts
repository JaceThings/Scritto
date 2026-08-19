import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

/**
 * What the site ships. `versus.html`, `edges.html`, `resize.html`, `suite.html` and
 * `look.html` are deliberately not here: `bun run play` serves any page in this directory,
 * so they stay a dev server away for the checks that drive them — flow needs
 * look, `bench:suite` needs suite, `check:versus` needs versus — without being
 * built into the deployed site.
 */
const PAGES = ['index', 'playground', 'docs', 'studio']

/**
 * `<!-- @include footer.html i=14 -->` inlines `partials/footer.html`, filling
 * `{{i}}` and `{{i+1}}` from the attributes. The three site pages share one
 * masthead and footer this way rather than three copies.
 */
const partials = (): Plugin => {
  const dir = path('./partials')
  return {
    name: 'html-partials',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) =>
        html.replace(/[ \t]*<!--\s*@include\s+([\w.-]+)([^>]*?)-->/g, (_, file, args) => {
          const vars = Object.fromEntries(
            [...String(args).matchAll(/(\w+)=(\d+)/g)].map(([, key, value]) => [key, Number(value)]),
          )
          return readFileSync(join(dir, file), 'utf8')
            .replace(/\{\{(\w+)(?:\+(\d+))?\}\}/g, (_m, key, add) =>
              String((vars[key] ?? 0) + Number(add ?? 0)),
            )
            .trimEnd()
        }),
    },
    handleHotUpdate({ file, server }) {
      if (file.startsWith(dir)) server.hot.send({ type: 'full-reload' })
    },
  }
}

export default defineConfig({
  plugins: [tailwindcss(), partials()],
  resolve: {
    alias: [
      { find: /^@scritto\/core$/, replacement: path('../../packages/core/src/index.ts') },
      { find: '@scritto/core/ssr.css', replacement: path('../../packages/core/src/ssr.css') },
    ],
  },
  server: {
    port: 5175,
    strictPort: true,
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      input: Object.fromEntries(PAGES.map((page) => [page, path(`./${page}.html`)])),
    },
  },
})
