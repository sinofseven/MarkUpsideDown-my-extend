import type { Env } from "../types.js";
import { RENDER_CACHE_TTL, RENDER_KV_TTL } from "../config.js";
import { jsonResponse, CORS_HEADERS, hasSecrets, sha256, kvGet, kvPut } from "../utils.js";
import { validateUrlForSsrf } from "../ssrf.js";

export async function handleRender(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const targetUrl = url.searchParams.get("url");
  if (!targetUrl) {
    return jsonResponse({ error: "Missing ?url= parameter" }, 400);
  }

  if (!hasSecrets(env)) {
    return jsonResponse({ error: "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN secrets are required for rendering" }, 500);
  }

  const skipCache = url.searchParams.get("nocache") === "1";
  const edgeCacheKey = new Request(`${url.origin}/render?url=${encodeURIComponent(targetUrl)}`);
  const cache = caches.default;

  const kvKey = `md:render:${await sha256(targetUrl)}`;
  if (!skipCache) {
    const cached = await cache.match(edgeCacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("x-cache", "HIT");
      return new Response(cached.body, { status: cached.status, headers });
    }
    const kvCached = await kvGet(env, kvKey);
    if (kvCached) {
      const parsed = JSON.parse(kvCached);
      ctx.waitUntil(
        cache.put(
          edgeCacheKey,
          new Response(kvCached, {
            headers: { ...CORS_HEADERS, "content-type": "application/json", "cache-control": `public, max-age=${RENDER_CACHE_TTL}` },
          }),
        ),
      );
      return jsonResponse({ ...parsed, cache: "hit" });
    }
  }

  const ssrfError = await validateUrlForSsrf(targetUrl);
  if (ssrfError) {
    return jsonResponse({ error: ssrfError }, 400);
  }

  try {
    const markdownResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/browser-rendering/markdown`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: targetUrl,
          gotoOptions: { waitUntil: "networkidle2", timeout: 45000 },
          rejectResourceTypes: ["image", "media", "font", "stylesheet"],
        }),
      },
    );

    if (!markdownResponse.ok) {
      const errorBody = await markdownResponse.text();
      return jsonResponse({ error: `Browser Rendering API error (${markdownResponse.status}): ${errorBody}` }, markdownResponse.status);
    }

    const data = await markdownResponse.json<{ success: boolean; result: string; errors?: unknown[] }>();
    if (!data.success) {
      return jsonResponse({ error: "Browser Rendering markdown API returned failure", details: data.errors }, 500);
    }

    const result = { markdown: data.result };
    const resultJson = JSON.stringify(result);
    ctx.waitUntil(
      Promise.all([
        cache.put(
          edgeCacheKey,
          new Response(resultJson, {
            headers: { ...CORS_HEADERS, "content-type": "application/json", "cache-control": `public, max-age=${RENDER_CACHE_TTL}` },
          }),
        ),
        kvPut(env, kvKey, resultJson, RENDER_KV_TTL, { url: targetUrl, endpoint: "render" }),
      ]),
    );

    return jsonResponse({ ...result, cache: "miss" });
  } catch (e) {
    return jsonResponse({ error: `Render failed: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }
}
