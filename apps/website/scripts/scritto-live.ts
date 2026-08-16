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
  // Comma-separated origins allowed to open a socket and to move the public
  // counters. Unset means "any browser origin but a local one", so a deploy that
  // has not been told its own hostname keeps working.
  SITE_ORIGINS?: string
  // Number of proxies that append to X-Forwarded-For between the client and this
  // process, counted from the right. Only consulted when cf-connecting-ip is
  // absent; /debug/headers is how you find out what to set it to.
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

// Clicks arrive as a running per-page-load total, so the count a visitor sees is
// the count that gets banked. That total is client-supplied and forgeable, hence
// a per-IP budget over a window: 40 in 5s outruns any human (a fast clicker
// manages 8-10/s in bursts, not sustained) while refusing a script. Anything
// over budget is declined rather than dropped, so the client re-sends it later.
const CLICK_WINDOW_S = 5
const CLICK_BUDGET = 40
const CLICK_MAX_PER_WRITE = 60
// A run key is only consulted while that run still has pokes the server has not
// banked, and the client starts a fresh run as soon as it is square, so in
// practice these live for seconds. The TTL only has to outlive a run that stays
// unsquare, and if it ever expired mid-run the whole run total would be banked a
// second time — so it is set far beyond any plausible write-retry window rather
// than the hour it takes to idle out of a session.
const CLICK_RUN_TTL_S = 30 * 24 * 3600
const CLICK_GATE_S = 2

// Identity keys used to be written with no TTL at all, which grows the keyspace
// forever. A browser's own id can outlive a year of not visiting; an IP is only a
// hint and gets reassigned, so it is held for a month.
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
// caller-controlled. Cloudflare *appends* the real client IP to an
// X-Forwarded-For that arrived with the request, which makes the leftmost entry
// whatever the caller wrote — one forged header per request used to buy a fresh
// 40-poke budget and a fresh identity. cf-connecting-ip is written by our own
// edge and overwrites anything incoming, so it is the only entry we trust; XFF is
// a fallback for a direct hit that misses the edge, and is read from the right,
// where the nearest trusted proxy appends, never from the left.
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

// Local dev has to keep working, so a localhost origin may connect; it just does
// not get to move the public numbers.
const mayConnect = (req: Request, env: Env) => {
  const origin = req.headers.get('origin')
  const host = originHost(origin)
  if (!host) return false
  if (LOCAL_HOSTS.has(host)) return true
  const allowed = siteOrigins(env)
  return allowed.length === 0 || allowed.includes(origin!)
}

// HMR reloads were measured adding ~2.7 views a minute with nobody visiting, so a
// dev origin reads the stats without counting as one. Forging this header only
// lets a caller leave their own visit out — it cannot suppress anyone else's, and
// there is no request that can lower a counter.
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

// Bun's client only pipelines commands issued in the same tick, so awaiting each
// one in turn pays a full round trip per command. Anything independent goes out
// together; only the read that has to observe the writes waits.
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
  // Claim the refresh before the work so concurrent requests do not all fetch,
  // but claim it only as far as the retry window: a run that learns nothing has
  // to come back in a minute rather than sit on a stale total for the full TTL.
  await env.redis.set(key(env, 'npmAt'), String(Date.now() - NPM_TTL_MS + NPM_RETRY_MS))
  let total = 0
  let answered = true
  for (const pkg of NPM_PKGS) {
    try {
      const res = await fetch(`https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(pkg)}`)
      // A package npm has never heard of is a real zero and counts as an answer;
      // any other failure is not an answer, and storing it as one would clobber a
      // good total with 0 whenever the network or the rate limiter says no.
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

// Read-then-increment let two tabs opening together both read nothing and both
// take an ordinal, so they disagreed about which visitor they are. Assigning
// inside the script settles it in one round trip: whoever runs first mints the
// ordinal, the other reads it back.
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

// Reading the run total, charging the budget and advancing both counters has to
// be one step. As separate round trips, two writes for the same run both read the
// same banked total and both credit the difference — and the client races itself
// by design, because a poke followed by closing the tab sends the debounced write
// and the pagehide beacon at once.
//
// The budget is charged inside the same step so the charge cannot be spent
// without the credit landing, and vice versa. Over-budget writes still charge, so
// a flood cannot outlast the window by pacing itself, and the run total only
// advances by what was actually granted: the rest stays unbanked and the client
// re-sends it on its next write rather than losing it.
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
      // A bundle cached before this endpoint learned to count still posts a bare
      // poke, so keep the old gated single increment as the fallback.
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

// Which header carries the real client IP depends on what Cloudflare and Railway
// each do to the request, which cannot be established from here. This reports
// exactly what arrived so it can be read off a live request; it needs
// DEBUG_TOKEN set to answer at all, and only reports IP-bearing headers.
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
