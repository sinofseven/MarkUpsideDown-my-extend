import type { Env } from "../types.js";
import { WORKER_VERSION } from "../config.js";
import { jsonResponse, hasSecrets, hasCache, hasBatch, hasPublish, hasSearch } from "../utils.js";

export function handleHealth(env: Env): Response {
  return jsonResponse({
    status: "ok",
    version: WORKER_VERSION,
    capabilities: {
      fetch: true,
      convert: true,
      render: hasSecrets(env),
      json: hasSecrets(env),
      crawl: hasSecrets(env),
      cache: hasCache(env),
      batch: hasBatch(env),
      publish: hasPublish(env),
      search: hasSearch(env),
    },
  });
}
