/// <reference types="vite/client" />
import { startFocusRing } from './lib/focus-ring'
import { startSelectionHighlight } from './lib/highlight'
import { startRouter } from './lib/nav'

if (import.meta.env.DEV) void import('./dev/agentation')

startFocusRing()
startSelectionHighlight()
startRouter({
  '/': () => import('./pages/home').then((m) => m.initHome),
  '/playground': () => import('./pages/playground').then((m) => m.initPlayground),
})
