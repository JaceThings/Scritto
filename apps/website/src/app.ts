import { initDocs } from './docs'
import { initHome } from './home'
import { initPlayground } from './playground'
import { startFocusRing } from './focus-ring'
import { startRouter } from './nav'

// One bundle for every routed page so a click can mount the destination without
// a document load — the header and footer stay put while the body swaps.
startFocusRing()
startRouter({
  '/': initHome,
  '/playground': initPlayground,
  '/docs': initDocs,
})
