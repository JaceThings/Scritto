import { defineRailway, github, preserve, project, redis, service } from "railway/iac";

export default defineRailway(() => {
  const scrittoWeb = service("scritto-web", {
    source: github("JaceThings/Scritto", { checkSuites: false }),
    build: "bun run build && bun run --filter website build",
    deploy: { restartPolicyMaxRetries: 3 },
    replicas: { "us-west2": 1 },
    domains: ["scrit.to"],
    env: { RAILPACK_SPA_OUTPUT_DIR: preserve() },
  });

  const cache = redis("Redis");

  // The live counters: apps/live, a Bun server the site talks to at live.scrit.to.
  const scrittoLive = service("scritto-live", {
    source: github("JaceThings/Scritto", { rootDirectory: "apps/live", checkSuites: false }),
    deploy: { restartPolicyMaxRetries: 3 },
    replicas: { "us-west2": 1 },
    domains: ["live.scrit.to"],
    env: { REDIS_URL: cache.env.REDIS_URL, IP_SALT: preserve() },
  });

  return project("scritto", {
    resources: [scrittoWeb, cache, scrittoLive],
  });
});
