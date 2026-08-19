import { playCopySuccess } from '../lib/sounds'

const COPIED_MS = 1400
const FAILED_MS = 2400

export const bindInstall = (root: ParentNode) => {
  const status = root.querySelector('[data-copy-status]')
  const timers = new Set<number>()
  // Every press owns its own reset, so an earlier timer cannot cut a later one short.
  let confirmed: HTMLButtonElement | null = null
  let press = 0

  const settle = () => {
    confirmed?.removeAttribute('data-copied')
    confirmed = null
    if (status) status.textContent = ''
  }

  const hold = (mine: number, after: number) => {
    timers.add(window.setTimeout(() => press === mine && settle(), after))
  }

  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
    button.addEventListener('click', async () => {
      const command = button.dataset.copy
      if (!command) return
      const pkg = button.dataset.pkg ?? command
      const mine = ++press
      settle()
      try {
        await navigator.clipboard.writeText(command)
        playCopySuccess()
        confirmed = button
        button.setAttribute('data-copied', '')
        if (status) status.textContent = `Copied ${pkg} install command to clipboard`
        hold(mine, COPIED_MS)
      } catch {
        if (status) status.textContent = `Unable to copy ${pkg} install command`
        hold(mine, FAILED_MS)
      }
    })
  }

  return () => {
    for (const timer of timers) window.clearTimeout(timer)
  }
}
