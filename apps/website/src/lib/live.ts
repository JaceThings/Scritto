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

type Reply = Stats & { acked: number; hasAck: boolean }

// Error bodies are valid JSON too, and one undefined reaching the arithmetic
// sticks "NaN" on screen.
const parseReply = (raw: unknown): Reply | null => {
  if (typeof raw !== 'object' || raw === null) return null
  const at = (key: string) => {
    const value = Object.getOwnPropertyDescriptor(raw, key)?.value
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }
  const views = at('views')
  const uniques = at('uniques')
  const you = at('you')
  const here = at('here')
  const clicks = at('clicks')
  const npm = at('npm')
  if (views === null || uniques === null || you === null || here === null || clicks === null || npm === null) {
    return null
  }
  const acked = at('acked')
  return { views, uniques, you, here, clicks, npm, acked: acked ?? 0, hasAck: acked !== null }
}

const post = async (
  path: string,
  extra: Record<string, string | number> = {},
  signal?: AbortSignal,
) => {
  const res = await fetch(`${LIVE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
    body: body(extra),
    signal,
  })
  if (!res.ok) throw new Error(`${path} ${res.status}`)
  const reply = parseReply(await res.json())
  if (!reply) throw new Error(`${path} malformed`)
  return reply
}

const CLICK_WRITE_MS = 2000
const SOCKET_ACK_MS = 4000

const SOCKET_BASE_MS = 400
const SOCKET_MAX_MS = 30_000
const SOCKET_HEALTHY_MS = 10_000

export const connectLive = (onStats: (stats: Stats) => void) => {
  let you = 0
  let latest: Stats | null = null

  // A running total, not one write per click: the server banks the difference,
  // so a retry credits nothing twice.
  let run = crypto.randomUUID()
  let seq = 0
  let acked = 0
  let wrote = 0
  let queued = 0
  let frame = 0
  let writeTimeout = 0
  let sending = false
  let inflight = 0
  let transport: 'http' | 'socket' | null = null
  let blockedUntil = 0
  let socket: WebSocket | null = null
  let reconnect = 0
  let retries = 0
  let stopped = false
  const requests = new AbortController()
  const send = (path: string, extra: Record<string, string | number> = {}) =>
    post(path, extra, requests.signal)

  // Clamping to our own count would hide everyone else's while we are ahead.
  let server = 0
  const shown = () => server + Math.max(0, seq - acked)

  const emit = (stats: Stats) => {
    if (stopped) return
    const next = latest
      ? {
          ...stats,
          views: Math.max(latest.views, stats.views),
          uniques: Math.max(latest.uniques, stats.uniques),
        }
      : stats
    latest = next
    onStats(next)
  }

  const apply = (stats: Stats, from: 'hello' | 'write' | 'feed' = 'feed') => {
    if (from === 'hello' && stats.you) you = stats.you
    // A frame overlapping one of our writes may already count what it banks.
    if (from === 'write' || !sending) server = Math.max(server, stats.clicks)
    emit({
      views: stats.views,
      uniques: stats.uniques,
      you,
      here: stats.here,
      clicks: shown(),
      npm: stats.npm,
    })
  }

  const hello = () => send('/hello').then((stats) => apply(stats, 'hello')).catch(() => {})
  hello()

  const beat = window.setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) return
    send('/beat').then((stats) => apply(stats)).catch(() => {})
  }, 15_000)

  const poll = window.setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) return
    fetch(`${LIVE_URL}/stats`, { signal: requests.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`stats ${res.status}`))))
      .then((raw) => {
        const stats = parseReply(raw)
        if (stats) apply(stats)
      })
      .catch(() => {})
  }, 4000)

  const finish = (stats: Reply, total: number) => {
    window.clearTimeout(writeTimeout)
    writeTimeout = 0
    if (stopped) return
    acked = Math.max(acked, stats.hasAck ? stats.acked : total)
    apply(stats, 'write')
    sending = false
    transport = null
    // A refusal is retried at the old HTTP cadence rather than once a frame.
    if (acked < total) blockedUntil = Date.now() + CLICK_WRITE_MS
    // Whatever the per-IP budget declined stays pending for the next write.
    if (acked < seq) {
      schedule()
      return
    }
    // A run only lives while it has unbanked pokes, so expiry strands nothing.
    run = crypto.randomUUID()
    seq = 0
    acked = 0
  }

  const write = async () => {
    queued = 0
    frame = 0
    if (stopped || sending || acked >= seq) return
    sending = true
    const total = seq
    inflight = total
    if (socket?.readyState === WebSocket.OPEN) {
      transport = 'socket'
      try {
        socket.send(JSON.stringify({ run, seq: total }))
        writeTimeout = window.setTimeout(() => socket?.close(), SOCKET_ACK_MS)
      } catch {
        sending = false
        transport = null
        schedule()
      }
      return
    }
    transport = 'http'
    wrote = Date.now()
    try {
      const stats = await send('/click', { run, seq: total })
      finish(stats, total)
    } catch {
      // Leave acked alone; the next write re-sends the same total.
      sending = false
      transport = null
      schedule()
    }
  }

  const schedule = () => {
    if (stopped || queued || frame || sending || acked >= seq) return
    const blocked = blockedUntil - Date.now()
    if (blocked > 0) {
      queued = window.setTimeout(write, blocked)
      return
    }
    if (socket?.readyState === WebSocket.OPEN) {
      frame = window.requestAnimationFrame(() => void write())
      return
    }
    const wait = CLICK_WRITE_MS - (Date.now() - wrote)
    if (wait <= 0) void write()
    else queued = window.setTimeout(write, wait)
  }

  const listen = () => {
    if (stopped) return
    const url = new URL(LIVE_URL.replace(/^http/, 'ws') + '/live')
    url.searchParams.set('sid', id(SID))
    url.searchParams.set('vid', id(VID))
    socket = new WebSocket(url)
    let openedAt = 0
    socket.onmessage = (event) => {
      try {
        const frame = parseReply(JSON.parse(String(event.data)))
        if (!frame) return
        if (frame.hasAck && transport === 'socket') {
          finish(frame, inflight)
          return
        }
        apply(frame)
      } catch {
        // ignore unparseable frames
      }
    }
    socket.onopen = () => {
      openedAt = Date.now()
      window.clearTimeout(queued)
      queued = 0
      schedule()
    }
    socket.onclose = () => {
      socket = null
      const retryWrite = transport === 'socket'
      if (retryWrite) {
        window.clearTimeout(writeTimeout)
        writeTimeout = 0
        sending = false
        transport = null
      }
      // A close we started must not reconnect: the timer would outlive the page.
      if (stopped) return
      if (retryWrite) schedule()
      send('/beat').then((stats) => apply(stats)).catch(() => {})
      // Or a server that accepts and drops is retried at 400ms forever.
      if (openedAt && Date.now() - openedAt >= SOCKET_HEALTHY_MS) retries = 0
      const wait = Math.min(SOCKET_MAX_MS, SOCKET_BASE_MS * 2 ** retries++)
      reconnect = window.setTimeout(listen, wait / 2 + Math.random() * (wait / 2))
    }
  }
  listen()

  const onClick = () => {
    seq += 1
    if (latest) emit({ ...latest, clicks: shown() })
    schedule()
  }
  document.addEventListener('click', onClick)

  const flush = () => {
    if (acked >= seq) return
    // A late beacon carrying sid could restore presence after the socket closes.
    navigator.sendBeacon(
      `${LIVE_URL}/click`,
      new Blob([JSON.stringify({ run, seq })], { type: 'text/plain' }),
    )
  }
  window.addEventListener('pagehide', flush)

  return () => {
    flush()
    stopped = true
    requests.abort()
    window.clearInterval(beat)
    window.clearInterval(poll)
    window.clearTimeout(queued)
    window.cancelAnimationFrame(frame)
    window.clearTimeout(writeTimeout)
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

/** Its own host, so the count alone takes the live colour. */
export const companyCount = (here: number) => (here <= 1 ? '' : String(here - 1))

export const company = (here: number) => {
  if (here <= 1) return "You're the only one here right now."
  if (here === 2) return 'other person is here right now.'
  return 'other people are here right now.'
}
