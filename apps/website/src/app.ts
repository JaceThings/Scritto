import './site.css'
import { initHome } from './home'
import { initPlayground } from './playground'
import { startRouter } from './nav'

// One bundle for both pages so a route change can mount the destination without
// a document load — the header and footer stay put while the body swaps.
startRouter({
  '/': initHome,
  '/playground': initPlayground,
})
