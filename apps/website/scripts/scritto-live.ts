type Redis = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ...args: (string | number)[]): Promise<string | null>
  incr(key: string): Promise<number>
  send(command: string, args: string[]): Promise<unknown>
}

type Env = {
  redis: Redis
  REDIS_PREFIX: string
  IP_SALT?: string
  // Origins allowed to open a socket and move the counters. Unset means any
  // non-local browser origin, so an unconfigured deploy still works.
  SITE_ORIGINS?: string
  // Proxies appending to X-Forwarded-For, counted from the right. Only used
  // without cf-connecting-ip; /debug/headers tells you what to set.
  TRUSTED_HOPS?: string
  DEBUG_TOKEN?: string
}

type Ctx = {
  upgrade(req: Request): boolean
  waitUntil(task: Promise<unknown>): void
}

type Stats = {
  views: number
  uniques: number
  you: number
  here: number
  clicks: number
  npm: number
}

type HelloBody = {
  vid?: string
  sid?: string
}

type ClickBody = HelloBody & {
  run?: unknown
  seq?: unknown
}

const sockets = new Set<WebSocket>()
const NPM_PKGS = [
  '@scritto/core',
  '@scritto/react',
  '@scritto/vue',
  '@scritto/svelte',
  '@scritto/solid',
]
const PRESENCE_MS = 45_000
const VIEW_GATE_S = 15
const NPM_TTL_MS = 10 * 60 * 1000
const NPM_RETRY_MS = 60 * 1000

// Clicks arrive as a running per-page-load total, which is client-supplied and
// forgeable, hence a per-IP budget: 40 in 5s outruns any human (8-10/s in
// bursts) while refusing a script. Over budget is declined, not dropped.
const CLICK_WINDOW_S = 5
const CLICK_BUDGET = 40
const CLICK_MAX_PER_WRITE = 60
// A run lives only while it has unbanked pokes, so seconds in practice. Expiry
// mid-run would bank the whole total twice, so this sits far beyond any
// plausible write-retry window.
const CLICK_RUN_TTL_S = 30 * 24 * 3600
const CLICK_GATE_S = 2

// A browser's own id can outlive a year away; an IP is a hint and gets
// reassigned, so it is held for a month rather than forever.
const VID_TTL_S = 365 * 24 * 3600
const IP_TTL_S = 30 * 24 * 3600

// One POST fans out to every open socket, so an unbounded set is an amplifier.
const SOCKET_MAX = 500

const key = (env: Env, name: string) => `${env.REDIS_PREFIX}v2:${name}`

// 2h is Chromium's ceiling for the preflight cache (Firefox allows 24h), so
// anything larger is silently clamped rather than honoured.
const CORS_MAX_AGE_S = 7200

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-max-age': String(CORS_MAX_AGE_S),
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
  })

// Every budget, identity and gate key hangs off this, so it must not be
// caller-controlled. Cloudflare *appends* the client IP to an X-Forwarded-For
// that arrived with the request, so its leftmost entry is whatever the caller
// wrote — a forged header used to buy a fresh budget and identity. Only
// cf-connecting-ip is written by our own edge; XFF is a fallback for a direct
// hit, counted from the right where the nearest trusted proxy appends.
const IP_HEADERS = ['cf-connecting-ip', 'x-forwarded-for', 'x-real-ip', 'true-client-ip']

const clientIp = (req: Request, env: Env) => {
  const cf = req.headers.get('cf-connecting-ip')
  if (cf) return cf.trim()
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    const hops = Math.max(1, Number(env.TRUSTED_HOPS) || 1)
    const parts = forwarded.split(',').map((part) => part.trim()).filter(Boolean)
    const trusted = parts[parts.length - hops]
    if (trusted) return trusted
  }
  return req.headers.get('x-real-ip')?.trim() ?? '0'
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'])

const siteOrigins = (env: Env) =>
  (env.SITE_ORIGINS ?? '').split(',').map((part) => part.trim()).filter(Boolean)

const originHost = (origin: string | null) => {
  if (!origin) return null
  try {
    return new URL(origin).hostname
  } catch {
    return null
  }
}

// A localhost origin may connect, it just may not move the public numbers.
const mayConnect = (req: Request, env: Env) => {
  const origin = req.headers.get('origin')
  const host = originHost(origin)
  if (!host) return false
  if (LOCAL_HOSTS.has(host)) return true
  const allowed = siteOrigins(env)
  return allowed.length === 0 || allowed.includes(origin!)
}

// HMR reloads measured ~2.7 views a minute with nobody visiting. Forging this
// only leaves your own visit out; no request can lower a counter.
const counts = (req: Request, env: Env) => {
  const origin = req.headers.get('origin')
  const host = originHost(origin)
  if (!host || LOCAL_HOSTS.has(host)) return false
  const allowed = siteOrigins(env)
  return allowed.length === 0 || allowed.includes(origin!)
}

const digest = async (value: string) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

const readInt = async (env: Env, name: string) => {
  const raw = await env.redis.get(key(env, name))
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

const zadd = (env: Env, name: string, score: number, member: string) =>
  env.redis.send('ZADD', [key(env, name), String(score), member])

const zremrange = (env: Env, name: string, max: number) =>
  env.redis.send('ZREMRANGEBYSCORE', [key(env, name), '-inf', String(max)])

const zcard = async (env: Env, name: string) => {
  const n = await env.redis.send('ZCARD', [key(env, name)])
  return Number(n) || 0
}

// Bun's client pipelines only within a tick, so awaiting each command in turn
// pays a round trip each. Only a read that must observe the writes waits.
const touchPresence = async (env: Env, sid: string) => {
  const now = Date.now()
  await Promise.all([zadd(env, 'here', now, sid), zremrange(env, 'here', now - PRESENCE_MS)])
  return zcard(env, 'here')
}

const counters = async (env: Env) => {
  const [views, uniques, clicks, npm] = await Promise.all([
    readInt(env, 'views'),
    readInt(env, 'uniques'),
    readInt(env, 'clicks'),
    readInt(env, 'npm'),
  ])
  return { views, uniques, clicks, npm }
}

const snapshot = async (env: Env, you: number, here: number): Promise<Stats> => ({
  ...(await counters(env)),
  you,
  here,
})

const broadcast = (stats: Stats) => {
  const payload = JSON.stringify(stats)
  for (const socket of sockets) {
    try {
      socket.send(payload)
    } catch {
      sockets.delete(socket)
    }
  }
}

const refreshNpm = async (env: Env) => {
  const stamped = Number(await env.redis.get(key(env, 'npmAt'))) || 0
  if (Date.now() - stamped < NPM_TTL_MS) return
  // Claimed before the work so concurrent requests do not all fetch, but only
  // for the retry window, so a failed refresh comes back in a minute.
  await env.redis.set(key(env, 'npmAt'), String(Date.now() - NPM_TTL_MS + NPM_RETRY_MS))
  let total = 0
  let answered = true
  for (const pkg of NPM_PKGS) {
    try {
      const res = await fetch(`https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(pkg)}`)
      // An unknown package is a real zero; any other failure is not an answer,
      // and storing it would clobber a good total.
      if (res.status === 404) continue
      if (!res.ok) {
        answered = false
        continue
      }
      const body = (await res.json()) as { downloads?: number }
      total += Number(body.downloads) || 0
    } catch {
      answered = false
    }
  }
  if (!answered) return
  await env.redis.set(key(env, 'npm'), String(total))
  await env.redis.set(key(env, 'npmAt'), String(Date.now()))
}

// Read-then-increment let two tabs opening together take the same ordinal.
// Assigning inside the script settles it in one round trip.
const IDENTIFY_LUA = `
local you = redis.call('GET', KEYS[1])
if not you then you = redis.call('GET', KEYS[2]) end
if not you then you = redis.call('INCR', KEYS[3]) end
redis.call('SET', KEYS[1], you, 'EX', ARGV[1])
redis.call('SET', KEYS[2], you, 'EX', ARGV[2])
return tonumber(you)
`

const identify = async (env: Env, vid: string, ipHash: string) => {
  const you = await env.redis.send('EVAL', [
    IDENTIFY_LUA,
    '3',
    key(env, `vid:${vid}`),
    key(env, `ip:${ipHash}`),
    key(env, 'uniques'),
    String(VID_TTL_S),
    String(IP_TTL_S),
  ])
  return Number(you) || 0
}

const gatedIncr = async (env: Env, gate: string, counter: string, ttl: number) => {
  const gateKey = key(env, gate)
  const n = Number(await env.redis.send('INCR', [gateKey]))
  if (n !== 1) return false
  await Promise.all([
    env.redis.send('EXPIRE', [gateKey, String(ttl)]),
    env.redis.incr(key(env, counter)),
  ])
  return true
}

const readBody = async (req: Request): Promise<HelloBody> => {
  try {
    return (await req.json()) as HelloBody
  } catch {
    return {}
  }
}

const hello = async (req: Request, env: Env, ctx: Ctx) => {
  const body = await readBody(req)
  const vid = body.vid && /^[a-z0-9-]{8,64}$/i.test(body.vid) ? body.vid : crypto.randomUUID()
  const sid = body.sid && /^[a-z0-9-]{8,64}$/i.test(body.sid) ? body.sid : crypto.randomUUID()
  const ipHash = await digest(`${env.IP_SALT ?? 'scritto'}:${clientIp(req, env)}`)
  const [you, here] = await Promise.all([
    identify(env, vid, ipHash),
    touchPresence(env, sid),
    counts(req, env) ? gatedIncr(env, `vgate:${ipHash}`, 'views', VIEW_GATE_S) : false,
  ])
  ctx.waitUntil(refreshNpm(env))
  const stats = await snapshot(env, you, here)
  broadcast({ ...stats, you: 0 })
  return json({ ...stats, vid, sid })
}

const beat = async (req: Request, env: Env) => {
  const body = await readBody(req)
  if (!body.sid) return json({ error: 'sid required' }, 400)
  const here = await touchPresence(env, body.sid)
  const stats = await snapshot(env, 0, here)
  broadcast(stats)
  return json(stats)
}

// Reading the run total, charging the budget and advancing the counters is one
// step: as separate round trips two writes for the same run both credit the
// same difference, and the client races itself by design when a poke and a
// pagehide beacon land together. Over-budget writes still charge, so a flood
// cannot outlast the window by pacing itself, and the run advances only by what
// was granted — the rest stays unbanked for the client's next write.
const BANK_LUA = `
local banked = tonumber(redis.call('GET', KEYS[1]) or '0')
local want = tonumber(ARGV[1]) - banked
local cap = tonumber(ARGV[2])
if want > cap then want = cap end
if want <= 0 then
  if banked > 0 then redis.call('EXPIRE', KEYS[1], ARGV[5]) end
  return banked
end
local used = redis.call('INCRBY', KEYS[3], want)
if used == want then redis.call('EXPIRE', KEYS[3], ARGV[4]) end
local granted = tonumber(ARGV[3]) - (used - want)
if granted > want then granted = want end
if granted < 0 then granted = 0 end
if granted > 0 then redis.call('INCRBY', KEYS[2], granted) end
local total = banked + granted
if total > 0 then redis.call('SET', KEYS[1], total, 'EX', ARGV[5]) end
return total
`

const bank = async (env: Env, ipHash: string, run: string, seq: number) => {
  const total = await env.redis.send('EVAL', [
    BANK_LUA,
    '3',
    key(env, `run:${run}`),
    key(env, 'clicks'),
    key(env, `cgate:${ipHash}`),
    String(seq),
    String(CLICK_MAX_PER_WRITE),
    String(CLICK_BUDGET),
    String(CLICK_WINDOW_S),
    String(CLICK_RUN_TTL_S),
  ])
  return Number(total) || 0
}

const click = async (req: Request, env: Env) => {
  const body = (await readBody(req)) as ClickBody
  const run = typeof body.run === 'string' && /^[a-z0-9-]{8,64}$/i.test(body.run) ? body.run : null
  const seq = typeof body.seq === 'number' && Number.isSafeInteger(body.seq) && body.seq >= 0 ? body.seq : null
  const ipHash = await digest(`${env.IP_SALT ?? 'scritto'}:${clientIp(req, env)}`)
  const [acked, here] = await Promise.all([
    run && seq !== null
      ? bank(env, ipHash, run, seq)
      // A bundle cached before this endpoint counted still posts a bare poke.
      : gatedIncr(env, `legacygate:${ipHash}`, 'clicks', CLICK_GATE_S).then(() => 0),
    typeof body.sid === 'string' ? touchPresence(env, body.sid) : zcard(env, 'here'),
  ])
  const stats = await snapshot(env, 0, here)
  broadcast(stats)
  return json({ ...stats, acked })
}

const stats = async (env: Env) => {
  await zremrange(env, 'here', Date.now() - PRESENCE_MS)
  const [here, totals] = await Promise.all([zcard(env, 'here'), counters(env)])
  return json({ ...totals, you: 0, here })
}

// Which header carries the real client IP depends on what Cloudflare and
// Railway each do to the request, so this reports what actually arrived.
// Needs DEBUG_TOKEN, and reports IP-bearing headers only.
const headerEcho = (req: Request, env: Env, url: URL) => {
  if (!env.DEBUG_TOKEN || url.searchParams.get('token') !== env.DEBUG_TOKEN) {
    return json({ error: 'not found' }, 404)
  }
  const seen: Record<string, string> = {}
  for (const name of [...IP_HEADERS, 'forwarded', 'origin']) {
    const value = req.headers.get(name)
    if (value) seen[name] = value
  }
  return json({ resolved: clientIp(req, env), hops: Number(env.TRUSTED_HOPS) || 1, seen })
}

export default {
  async fetch(req: Request, env: Env, ctx: Ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    const url = new URL(req.url)
    if (url.pathname === '/debug/headers' && req.method === 'GET') return headerEcho(req, env, url)
    if (url.pathname === '/live' && req.headers.get('upgrade') === 'websocket') {
      if (!mayConnect(req, env)) return json({ error: 'origin not allowed' }, 403)
      if (sockets.size >= SOCKET_MAX) return json({ error: 'too many listeners' }, 503)
      if (ctx.upgrade(req)) return
    }
    if (url.pathname === '/hello' && req.method === 'POST') return hello(req, env, ctx)
    if (url.pathname === '/beat' && req.method === 'POST') return beat(req, env)
    if (url.pathname === '/click' && req.method === 'POST') return click(req, env)
    if (url.pathname === '/stats' && req.method === 'GET') return stats(env)
    if (url.pathname === '/' && req.method === 'GET') return json({ ok: true, service: 'scritto-live' })
    return json({ error: 'not found' }, 404)
  },
  websocket: {
    open(ws: WebSocket) {
      sockets.add(ws)
    },
    close(ws: WebSocket) {
      sockets.delete(ws)
    },
  },
}
