/** What a Redis command answers with, over RESP. */
type RedisReply = string | number | null | RedisReply[]

type Redis = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ...args: (string | number)[]): Promise<string | null>
  incr(key: string): Promise<number>
  send(command: string, args: string[]): Promise<RedisReply>
  publish(channel: string, message: string): Promise<number>
  duplicate(): Promise<Redis>
  subscribe(channel: string, listener: (message: string, channel: string) => void): Promise<number>
  close(): void
  onclose: ((error: Error | null) => void) | null
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
  upgrade(req: Request, options?: { data: SocketData }): boolean
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

type Totals = Pick<Stats, 'views' | 'uniques' | 'clicks' | 'npm'>

/** A request body, already validated: every field is either usable or absent. */
type Body = {
  vid: string | null
  sid: string | null
  run: string | null
  seq: number | null
}

/** Anything this server answers with. */
type JsonBody = { [key: string]: string | number | boolean | null | JsonBody }

type Runtime = {
  env: Env
  instance: string
  sockets: Set<WebSocket>
  sidSockets: Map<string, Set<WebSocket>>
  totals: Totals
  here: number
  ready: Promise<void>
  presence: Promise<void>
  subscriber: Redis | null
  subscribing: boolean
  subscriberRetry: ReturnType<typeof setTimeout> | null
}

type SocketData = {
  runtime: Runtime
  sid: string
  ipHash: string
}

type LiveSocket = WebSocket & { data?: SocketData }

const ID_PATTERN = /^[a-z0-9-]{8,64}$/i

const fieldOf = (raw: unknown, key: string) =>
  typeof raw === 'object' && raw !== null ? Object.getOwnPropertyDescriptor(raw, key)?.value : undefined

const idAt = (raw: unknown, key: string) => {
  const value = fieldOf(raw, key)
  return typeof value === 'string' && ID_PATTERN.test(value) ? value : null
}

const countAt = (raw: unknown, key: string) => {
  const value = fieldOf(raw, key)
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

const statsAt = (raw: unknown): Stats | null => {
  const valueAt = (name: keyof Stats) => {
    const value = fieldOf(raw, name)
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
  }
  const views = valueAt('views')
  const uniques = valueAt('uniques')
  const you = valueAt('you')
  const here = valueAt('here')
  const clicks = valueAt('clicks')
  const npm = valueAt('npm')
  if (views === null || uniques === null || you === null || here === null || clicks === null || npm === null) {
    return null
  }
  return { views, uniques, you, here, clicks, npm }
}

const runtimes = new WeakMap<Env, Runtime>()
const NPM_PKGS = [
  '@scritto/core',
  '@scritto/react',
  '@scritto/vue',
  '@scritto/svelte',
  '@scritto/solid',
]
const PRESENCE_MS = 45_000
const PRESENCE_REFRESH_MS = 15_000
const COUNTER_REFRESH_MS = 30_000
const PUBSUB_RETRY_MS = 1000
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

const json = (data: JsonBody, status = 200) =>
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

const mergeTotals = (runtime: Runtime, totals: Partial<Totals>) => {
  runtime.totals = {
    views: Math.max(runtime.totals.views, totals.views ?? 0),
    uniques: Math.max(runtime.totals.uniques, totals.uniques ?? 0),
    clicks: Math.max(runtime.totals.clicks, totals.clicks ?? 0),
    npm: totals.npm ?? runtime.totals.npm,
  }
}

const snapshot = (runtime: Runtime, you = 0, here = runtime.here): Stats => ({
  ...runtime.totals,
  you,
  here,
})

const sameTotals = (left: Totals, right: Totals) =>
  left.views === right.views && left.uniques === right.uniques && left.clicks === right.clicks && left.npm === right.npm

const closeSocket = (ws: WebSocket) => {
  const data = (ws as LiveSocket).data
  // The registry is the record of an open socket, so a second close is a no-op.
  if (!data || !data.runtime.sockets.delete(ws)) return
  const peers = data.runtime.sidSockets.get(data.sid)
  if (!peers) return
  peers.delete(ws)
  if (peers.size) return
  data.runtime.sidSockets.delete(data.sid)
  data.runtime.presence = data.runtime.presence.then(async () => {
    await data.runtime.ready
    const here = await setSocketPresence(data.runtime, data.sid, false)
    data.runtime.here = here
    broadcast(data.runtime, snapshot(data.runtime))
  }).catch(() => {})
}

const fanOut = (runtime: Runtime, payload: string) => {
  for (const socket of runtime.sockets) {
    try {
      socket.send(payload)
    } catch {
      closeSocket(socket)
    }
  }
}

const receiveBroadcast = (runtime: Runtime, message: string) => {
  try {
    const raw = JSON.parse(message)
    if (fieldOf(raw, 'source') === runtime.instance) return
    const stats = statsAt(fieldOf(raw, 'stats'))
    if (!stats) return
    mergeTotals(runtime, stats)
    runtime.here = stats.here
    fanOut(runtime, JSON.stringify({ ...stats, you: 0 }))
  } catch {
    // ignore messages not written by this service
  }
}

const retrySubscriber = (runtime: Runtime) => {
  if (runtime.subscriberRetry) return
  runtime.subscriberRetry = setTimeout(() => {
    runtime.subscriberRetry = null
    void startSubscriber(runtime)
  }, PUBSUB_RETRY_MS)
}

const startSubscriber = async (runtime: Runtime) => {
  if (runtime.subscriber || runtime.subscribing) return
  runtime.subscribing = true
  try {
    // A subscribed connection cannot serve the counter and presence commands.
    const subscriber = await runtime.env.redis.duplicate()
    runtime.subscriber = subscriber
    subscriber.onclose = () => {
      if (runtime.subscriber !== subscriber) return
      runtime.subscriber = null
      runtime.subscribing = false
      retrySubscriber(runtime)
    }
    await subscriber.subscribe(key(runtime.env, 'live'), (message) => receiveBroadcast(runtime, message))
    runtime.subscribing = false
  } catch {
    runtime.subscriber?.close()
    runtime.subscriber = null
    runtime.subscribing = false
    retrySubscriber(runtime)
  }
}

const broadcast = (runtime: Runtime, stats: Stats) => {
  const publicStats = { ...stats, you: 0 }
  fanOut(runtime, JSON.stringify(publicStats))
  const message = JSON.stringify({ source: runtime.instance, stats: publicStats })
  runtime.env.redis.publish(key(runtime.env, 'live'), message).catch(() => retrySubscriber(runtime))
}

const initializeRuntime = async (runtime: Runtime) => {
  const now = Date.now()
  const [totals] = await Promise.all([
    counters(runtime.env),
    zremrange(runtime.env, 'here', now - PRESENCE_MS),
  ])
  mergeTotals(runtime, totals)
  runtime.here = await zcard(runtime.env, 'here')
}

const refreshCounters = async (runtime: Runtime) => {
  await runtime.ready
  const previous = runtime.totals
  const fresh = await counters(runtime.env)
  runtime.totals = fresh
  if (!sameTotals(previous, fresh)) broadcast(runtime, snapshot(runtime))
}

const getRuntime = (env: Env) => {
  const existing = runtimes.get(env)
  if (existing) return existing
  const runtime: Runtime = {
    env,
    instance: crypto.randomUUID(),
    sockets: new Set(),
    sidSockets: new Map(),
    totals: { views: 0, uniques: 0, clicks: 0, npm: 0 },
    here: 0,
    ready: Promise.resolve(),
    presence: Promise.resolve(),
    subscriber: null,
    subscribing: false,
    subscriberRetry: null,
  }
  runtime.ready = initializeRuntime(runtime)
  runtimes.set(env, runtime)
  void startSubscriber(runtime)
  setInterval(() => void refreshCounters(runtime).catch(() => {}), COUNTER_REFRESH_MS)
  setInterval(() => void refreshSocketPresence(runtime).catch(() => {}), PRESENCE_REFRESH_MS)
  return runtime
}

const refreshNpm = async (runtime: Runtime) => {
  const env = runtime.env
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
      total += countAt(await res.json(), 'downloads') ?? 0
    } catch {
      answered = false
    }
  }
  if (!answered) return
  await env.redis.set(key(env, 'npm'), String(total))
  await env.redis.set(key(env, 'npmAt'), String(Date.now()))
  if (runtime.totals.npm === total) return
  mergeTotals(runtime, { npm: total })
  broadcast(runtime, snapshot(runtime))
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
  if (n !== 1) return null
  const [, total] = await Promise.all([
    env.redis.send('EXPIRE', [gateKey, String(ttl)]),
    env.redis.incr(key(env, counter)),
  ] as const)
  return total
}

const readBody = async (req: Request): Promise<Body> => {
  const raw = await req.json().catch(() => null)
  return { vid: idAt(raw, 'vid'), sid: idAt(raw, 'sid'), run: idAt(raw, 'run'), seq: countAt(raw, 'seq') }
}

const hello = async (req: Request, env: Env, ctx: Ctx) => {
  const runtime = getRuntime(env)
  await runtime.ready
  const body = await readBody(req)
  const vid = body.vid ?? crypto.randomUUID()
  const sid = body.sid ?? crypto.randomUUID()
  const ipHash = await digest(`${env.IP_SALT ?? 'scritto'}:${clientIp(req, env)}`)
  const [you, here, view] = await Promise.all([
    identify(env, vid, ipHash),
    touchPresence(env, sid),
    counts(req, env) ? gatedIncr(env, `vgate:${ipHash}`, 'views', VIEW_GATE_S) : null,
  ])
  runtime.here = here
  mergeTotals(runtime, { views: view ?? runtime.totals.views, uniques: you })
  ctx.waitUntil(refreshNpm(runtime))
  const stats = snapshot(runtime, you, here)
  broadcast(runtime, stats)
  return json({ ...stats, vid, sid })
}

const beat = async (req: Request, env: Env) => {
  const runtime = getRuntime(env)
  await runtime.ready
  const body = await readBody(req)
  if (!body.sid) return json({ error: 'sid required' }, 400)
  const here = await touchPresence(env, body.sid)
  runtime.here = here
  const current = snapshot(runtime, 0, here)
  broadcast(runtime, current)
  return json(current)
}

// Reading the run total, charging the budget and advancing the counters is one
// step: as separate round trips two writes for the same run both credit the
// same difference, and the client races itself by design when a poke and a
// pagehide beacon land together. Over-budget writes still charge, so a flood
// cannot outlast the window by pacing itself, and the run advances only by what
// was granted — the rest stays unbanked for the client's next write.
const BANK_LUA = `
local banked = tonumber(redis.call('GET', KEYS[1]) or '0')
local clicks = tonumber(redis.call('GET', KEYS[2]) or '0')
local want = tonumber(ARGV[1]) - banked
local cap = tonumber(ARGV[2])
if want > cap then want = cap end
if want <= 0 then
  if banked > 0 then redis.call('EXPIRE', KEYS[1], ARGV[5]) end
  return { banked, clicks }
end
local used = redis.call('INCRBY', KEYS[3], want)
if used == want then redis.call('EXPIRE', KEYS[3], ARGV[4]) end
local granted = tonumber(ARGV[3]) - (used - want)
if granted > want then granted = want end
if granted < 0 then granted = 0 end
if granted > 0 then clicks = redis.call('INCRBY', KEYS[2], granted) end
local total = banked + granted
if total > 0 then redis.call('SET', KEYS[1], total, 'EX', ARGV[5]) end
return { total, clicks }
`

type Banked = { acked: number; clicks: number }

const bank = async (env: Env, ipHash: string, run: string, seq: number): Promise<Banked> => {
  const result = await env.redis.send('EVAL', [
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
  if (!Array.isArray(result)) return { acked: 0, clicks: 0 }
  return { acked: Number(result[0]) || 0, clicks: Number(result[1]) || 0 }
}

const click = async (req: Request, env: Env) => {
  const runtime = getRuntime(env)
  await runtime.ready
  const { run, seq, sid } = await readBody(req)
  const ipHash = await digest(`${env.IP_SALT ?? 'scritto'}:${clientIp(req, env)}`)
  const banking: Promise<Banked> = run && seq !== null
    ? bank(env, ipHash, run, seq)
    // A bundle cached before this endpoint counted still posts a bare poke.
    : gatedIncr(env, `legacygate:${ipHash}`, 'clicks', CLICK_GATE_S)
        .then((clicks) => ({ acked: 0, clicks: clicks ?? runtime.totals.clicks }))
  const [result, here] = await Promise.all([
    banking,
    sid ? touchPresence(env, sid) : zcard(env, 'here'),
  ])
  mergeTotals(runtime, { clicks: result.clicks })
  runtime.here = here
  const current = snapshot(runtime, 0, here)
  broadcast(runtime, current)
  return json({ ...current, acked: result.acked })
}

const stats = async (env: Env) => {
  const runtime = getRuntime(env)
  await runtime.ready
  await zremrange(env, 'here', Date.now() - PRESENCE_MS)
  runtime.here = await zcard(env, 'here')
  return json(snapshot(runtime))
}

// A process ref keeps a second tab, or a tab on another replica, from being
// removed when the first socket closes. Scores still expire after a dead
// process because no close handler can be promised in that case.
const SOCKET_PRESENCE_LUA = `
local now = tonumber(ARGV[2])
local cutoff = tonumber(ARGV[3])
if ARGV[1] == '1' then
  redis.call('ZADD', KEYS[2], now, ARGV[5])
  redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', cutoff)
  redis.call('PEXPIRE', KEYS[2], ARGV[6])
  redis.call('ZADD', KEYS[1], now, ARGV[4])
else
  redis.call('ZREM', KEYS[2], ARGV[5])
  redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', cutoff)
  if redis.call('ZCARD', KEYS[2]) == 0 then
    redis.call('DEL', KEYS[2])
    redis.call('ZREM', KEYS[1], ARGV[4])
  end
end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', cutoff)
return redis.call('ZCARD', KEYS[1])
`

const setSocketPresence = async (runtime: Runtime, sid: string, present: boolean) => {
  const now = Date.now()
  const here = await runtime.env.redis.send('EVAL', [
    SOCKET_PRESENCE_LUA,
    '2',
    key(runtime.env, 'here'),
    key(runtime.env, `hereRefs:${sid}`),
    present ? '1' : '0',
    String(now),
    String(now - PRESENCE_MS),
    sid,
    runtime.instance,
    String(PRESENCE_MS * 2),
  ])
  return Number(here) || 0
}

const REFRESH_PRESENCE_LUA = `
local now = tonumber(ARGV[1])
local cutoff = tonumber(ARGV[2])
for i = 2, #KEYS do
  redis.call('ZADD', KEYS[i], now, ARGV[3])
  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', cutoff)
  redis.call('PEXPIRE', KEYS[i], ARGV[4])
  redis.call('ZADD', KEYS[1], now, ARGV[i + 3])
end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', cutoff)
return redis.call('ZCARD', KEYS[1])
`

const refreshSocketPresence = async (runtime: Runtime) => {
  await runtime.ready
  const sids = [...runtime.sidSockets.keys()]
  const now = Date.now()
  const here = await runtime.env.redis.send('EVAL', [
    REFRESH_PRESENCE_LUA,
    String(sids.length + 1),
    key(runtime.env, 'here'),
    ...sids.map((sid) => key(runtime.env, `hereRefs:${sid}`)),
    String(now),
    String(now - PRESENCE_MS),
    runtime.instance,
    String(PRESENCE_MS * 2),
    ...sids,
  ])
  const count = Number(here) || 0
  if (count === runtime.here) return
  runtime.here = count
  broadcast(runtime, snapshot(runtime))
}

const openSocket = (ws: WebSocket) => {
  const data = (ws as LiveSocket).data
  if (!data) {
    ws.close(1008, 'missing identity')
    return
  }
  data.runtime.sockets.add(ws)
  const peers = data.runtime.sidSockets.get(data.sid) ?? new Set<WebSocket>()
  const first = peers.size === 0
  peers.add(ws)
  data.runtime.sidSockets.set(data.sid, peers)
  if (!first) return
  data.runtime.presence = data.runtime.presence.then(async () => {
    await data.runtime.ready
    const here = await setSocketPresence(data.runtime, data.sid, true)
    data.runtime.here = here
    broadcast(data.runtime, snapshot(data.runtime))
  }).catch(() => {})
}

const socketMessage = async (ws: WebSocket, message: string | ArrayBuffer | Uint8Array) => {
  const data = (ws as LiveSocket).data
  if (!data) return
  const text = typeof message === 'string'
    ? message
    : new TextDecoder().decode(message instanceof ArrayBuffer ? new Uint8Array(message) : message)
  if (text.length > 512) {
    ws.close(1009, 'message too large')
    return
  }
  const parsed = (() => {
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  })()
  const run = idAt(parsed, 'run')
  const seq = countAt(parsed, 'seq')
  if (!run || seq === null) return
  await data.runtime.ready
  const result = await bank(data.runtime.env, data.ipHash, run, seq)
  mergeTotals(data.runtime, { clicks: result.clicks })
  const current = snapshot(data.runtime)
  broadcast(data.runtime, current)
  try {
    ws.send(JSON.stringify({ ...current, acked: result.acked }))
  } catch {
    closeSocket(ws)
  }
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
      const runtime = getRuntime(env)
      if (runtime.sockets.size >= SOCKET_MAX) return json({ error: 'too many listeners' }, 503)
      const identity = { sid: url.searchParams.get('sid'), vid: url.searchParams.get('vid') }
      const sid = idAt(identity, 'sid')
      // The vid is validated but not carried: nothing past the handshake reads
      // it, and only /hello mints an ordinal from one.
      if (!sid || !idAt(identity, 'vid')) return json({ error: 'identity required' }, 400)
      const ipHash = await digest(`${env.IP_SALT ?? 'scritto'}:${clientIp(req, env)}`)
      const data = { runtime, sid, ipHash }
      // Identity (sid, vid, client IP) is pinned on the socket at upgrade so a
      // later handshake cannot inherit another connection's budget key.
      if (ctx.upgrade(req, { data })) return
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
      openSocket(ws)
    },
    close(ws: WebSocket) {
      closeSocket(ws)
    },
    message(ws: WebSocket, message: string | ArrayBuffer | Uint8Array) {
      void socketMessage(ws, message).catch(() => {})
    },
  },
}
