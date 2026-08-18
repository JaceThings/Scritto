/// <reference types="vite/client" />

export type Stats = {
  views: number
  uniques: number
  you: number
  here: number
  clicks: number
  npm: number
}

export const LIVE_URL = import.meta.env.VITE_LIVE_URL ?? 'https://scritto-live.iterati.ng'

const VID = 'scritto_vid'
const SID = 'scritto_sid'

const id = (key: string) => {
  const existing = localStorage.getItem(key)
  if (existing && /^[a-z0-9-]{8,64}$/i.test(existing)) return existing
  const next = crypto.randomUUID()
  localStorage.setItem(key, next)
  return next
}

const body = (extra: Record<string, string | number>) =>
  JSON.stringify({ vid: id(VID), sid: id(SID), ...extra })

const post = async (path: string, extra: Record<string, string | number> = {}) => {
  const res = await fetch(`${LIVE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
    body: body(extra),
  })
  if (!res.ok) throw new Error(`${path} ${res.status}`)
  return (await res.json()) as Stats & { vid?: string; sid?: string; acked?: number }
}

const CLICK_WRITE_MS = 2000

const SOCKET_BASE_MS = 400
const SOCKET_MAX_MS = 30_000
const SOCKET_HEALTHY_MS = 10_000

const COUNTS = ['views', 'uniques', 'you', 'here', 'clicks', 'npm'] as const

// Our error bodies are valid JSON, so a failed request parses into undefined
// counts, and one of those reaching the arithmetic sticks "NaN" on screen.
const sane = (stats: Stats) => COUNTS.every((field) => Number.isFinite(stats[field]))

export const connectLive = (onStats: (stats: Stats) => void) => {
  let you = 0
  let latest: Stats | null = null

  // Pokes go up as a running total per page load, not one write per click: the
  // server banks the difference, so a retried write credits nothing twice.
  let run = crypto.randomUUID()
  let seq = 0
  let acked = 0
  let wrote = 0
  let queued = 0
  let sending = false

  // The server's total plus our unbanked pokes; clamping to our own count would
  // hide everyone else's while we are ahead.
  let server = 0
  const shown = () => server + Math.max(0, seq - acked)

  const emit = (stats: Stats) => {
    latest = stats
    onStats(stats)
  }

  const apply = (stats: Stats, from: 'hello' | 'write' | 'feed' = 'feed') => {
    if (!sane(stats)) return
    if (from === 'hello' && stats.you) you = stats.you
    // A frame that overlapped one of our writes may already count the pokes that
    // write is banking, which against a stale `acked` would count them twice.
    if (from === 'write' || !sending) server = Math.max(server, stats.clicks)
    emit({ ...stats, you, clicks: shown() })
  }

  const hello = () => post('/hello').then((stats) => apply(stats, 'hello')).catch(() => {})
  hello()

  const beat = window.setInterval(() => {
    post('/beat').then((stats) => apply(stats)).catch(() => {})
  }, 15_000)

  const poll = window.setInterval(() => {
    fetch(`${LIVE_URL}/stats`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`stats ${res.status}`))))
      .then((stats: Stats) => apply(stats))
      .catch(() => {})
  }, 4000)

  let socket: WebSocket | null = null
  let reconnect = 0
  let retries = 0
  let stopped = false
  const listen = () => {
    if (stopped) return
    const url = LIVE_URL.replace(/^http/, 'ws') + '/live'
    socket = new WebSocket(url)
    let openedAt = 0
    socket.onmessage = (event) => {
      try {
        apply(JSON.parse(String(event.data)) as Stats)
      } catch {
        // ignore malformed frames
      }
    }
    socket.onopen = () => {
      openedAt = Date.now()
    }
    socket.onclose = () => {
      socket = null
      // A close we started must not reconnect: the timer would outlive the page.
      if (stopped) return
      // Only a connection that lasted counts as healthy, or a server that accepts
      // and drops is retried at 400ms forever. Jitter avoids a lockstep stampede.
      if (openedAt && Date.now() - openedAt >= SOCKET_HEALTHY_MS) retries = 0
      const wait = Math.min(SOCKET_MAX_MS, SOCKET_BASE_MS * 2 ** retries++)
      reconnect = window.setTimeout(listen, wait / 2 + Math.random() * (wait / 2))
    }
  }
  listen()

  const write = async () => {
    queued = 0
    if (sending || acked >= seq) return
    sending = true
    wrote = Date.now()
    const total = seq
    try {
      const stats = await post('/click', { run, seq: total })
      acked = Math.max(acked, stats.acked ?? total)
      apply(stats, 'write')
    } catch {
      // Leave acked alone; the next write re-sends the same total.
    }
    sending = false
    // Whatever the per-IP budget declined stays pending for the next write.
    if (acked < seq) {
      schedule()
      return
    }
    // Square with the server so the next poke opens a fresh run; a run only ever
    // lives while it has unbanked pokes, so its expiry can strand nothing.
    run = crypto.randomUUID()
    seq = 0
    acked = 0
  }

  const schedule = () => {
    if (queued || sending) return
    const wait = CLICK_WRITE_MS - (Date.now() - wrote)
    if (wait <= 0) void write()
    else queued = window.setTimeout(write, wait)
  }

  const onClick = () => {
    seq += 1
    if (latest) emit({ ...latest, clicks: shown() })
    schedule()
  }
  document.addEventListener('click', onClick)

  const flush = () => {
    if (acked >= seq) return
    navigator.sendBeacon(
      `${LIVE_URL}/click`,
      new Blob([body({ run, seq })], { type: 'text/plain' }),
    )
  }
  window.addEventListener('pagehide', flush)

  return () => {
    flush()
    stopped = true
    window.clearInterval(beat)
    window.clearInterval(poll)
    window.clearTimeout(queued)
    window.clearTimeout(reconnect)
    document.removeEventListener('click', onClick)
    window.removeEventListener('pagehide', flush)
    socket?.close()
  }
}

export const nth = (n: number) => {
  if (!Number.isFinite(n)) return ''
  const v = n % 100
  if (v >= 11 && v <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

export const comma = (n: number) => (Number.isFinite(n) ? n.toLocaleString('en-US') : '')

const unit = (n: number, name: string) => `${n} ${name}${n === 1 ? '' : 's'}`

export const sitting = (seconds: number) => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds / 60) % 60
  const parts = [unit(seconds % 60, 'second')]
  if (hours || minutes) parts.unshift(unit(minutes, 'minute'))
  if (hours) parts.unshift(unit(hours, 'hour'))
  return parts.join(' ')
}

export const company = (here: number) => {
  if (here <= 1) return "You're the only one here right now."
  if (here === 2) return 'One other person is here right now.'
  return `${here - 1} other people are here right now.`
}
