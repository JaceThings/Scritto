import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      '@scritto/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5175,
    strictPort: true,
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        playground: fileURLToPath(new URL('./playground.html', import.meta.url)),
        bench: fileURLToPath(new URL('./bench.html', import.meta.url)),
        stress: fileURLToPath(new URL('./stress.html', import.meta.url)),
        suite: fileURLToPath(new URL('./suite.html', import.meta.url)),
        look: fileURLToPath(new URL('./look.html', import.meta.url)),
        values: fileURLToPath(new URL('./values.html', import.meta.url)),
      },
    },
  },
})
