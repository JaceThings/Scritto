import live from './scritto-live'

const redisUrl = process.env.REDIS_URL
if (!redisUrl) throw new Error('REDIS_URL is required')

const env = {
  redis: new Bun.RedisClient(redisUrl),
  REDIS_PREFIX: process.env.REDIS_PREFIX ?? 'scritto:',
  IP_SALT: process.env.IP_SALT,
  SITE_ORIGINS: process.env.SITE_ORIGINS,
  TRUSTED_HOPS: process.env.TRUSTED_HOPS,
  DEBUG_TOKEN: process.env.DEBUG_TOKEN,
}

const server = Bun.serve({
  port: Number(process.env.PORT) || 8080,
  fetch: (req, server) =>
    live.fetch(req, env, {
      upgrade: (req, options) => server.upgrade(req, options),
      waitUntil: (task) => void task.catch((error) => console.error(error)),
    }),
  websocket: live.websocket,
})

console.log(`scritto-live listening on :${server.port}`)
