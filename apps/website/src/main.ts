/// <reference types="vite/client" />
import { initHome } from './pages/home'
import { initPlayground } from './pages/playground'
import { startFocusRing } from './lib/focus-ring'
import { startRouter } from './lib/nav'

if (import.meta.env.DEV) void import('./dev/agentation')

startFocusRing()
startRouter({
  '/': initHome,
  '/playground': initPlayground,
  // Docs is static copy; it still needs a route so the router can mount it.
  '/docs': () => {},
})
