import '@scritto/core'
import { bindInstall } from '../components/install'
import { bindLiveReadout } from '../components/live-readout'
import { bindCorners } from '../lib/corners'
import { bindJustif } from '../lib/justif'

export const initHome = (root: ParentNode = document) => {
  const corners = bindCorners(root)
  const justified = bindJustif(root)
  const readout = bindLiveReadout(root)
  const install = bindInstall(root)

  return () => {
    corners()
    justified?.destroy()
    readout()
    install()
  }
}
