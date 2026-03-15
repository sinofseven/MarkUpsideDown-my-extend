interface Env {
  AI: Ai;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN: string;
}

const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
]);

const SUPPORTED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/html",
  "text/csv",
  "application/xml",
  "text/xml",
  ...IMAGE_TYPES,
]);

const RENDER_CACHE_TTL = 3600; // 1 hour

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return handleHealth(env);
    }

    if (request.method === "GET" && url.pathname === "/render") {
      return handleRender(url, env, ctx);
    }

    if (request.method === "POST" && url.pathname === "/convert") {
      return handleConvert(request, env);
    }

    return jsonResponse({ error: "GET /health, POST /convert, or GET /render?url=" }, 404);
  },
} satisfies ExportedHandler<Env>;

function handleHealth(env: Env): Response {
  return jsonResponse({
    status: "ok",
    capabilities: {
      convert: true,
      render: Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN),
    },
  });
}

async function handleConvert(request: Request, env: Env): Promise<Response> {
  const contentType = request.headers.get("content-type") || "";
  const mimeType = contentType.split(";")[0].trim();

  if (!SUPPORTED_TYPES.has(mimeType)) {
    return jsonResponse({ error: `Unsupported format: ${mimeType}`, supported: [...SUPPORTED_TYPES] }, 415);
  }

  try {
    const isImage = IMAGE_TYPES.has(mimeType);
    const body = await request.arrayBuffer();
    const originalSize = body.byteLength;
    const blob = new Blob([body], { type: mimeType });
    const result = await env.AI.toMarkdown([blob]);
    const markdown = result.map((r: { data: string }) => r.data).join("\n\n");
    return jsonResponse({ markdown, is_image: isImage, original_size: originalSize });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}

async function handleRender(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const targetUrl = url.searchParams.get("url");
  if (!targetUrl) {
    return jsonResponse({ error: "Missing ?url= parameter" }, 400);
  }

  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
    return jsonResponse({ error: "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN secrets are required for rendering" }, 500);
  }

  const skipCache = url.searchParams.get("nocache") === "1";
  const cacheKey = new Request(`${url.origin}/render?url=${encodeURIComponent(targetUrl)}`);
  const cache = caches.default;

  if (!skipCache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("x-cache", "HIT");
      return new Response(cached.body, { status: cached.status, headers });
    }
  }

  try {
    const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/browser-rendering`;
    const authHeaders = {
      "Authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    };
    const browserOptions = {
      url: targetUrl,
      rejectResourceTypes: ["image", "media", "font", "stylesheet"],
      gotoOptions: { waitUntil: "networkidle0" },
    };

    // Step 1: Get rendered HTML via /content endpoint
    const contentResponse = await fetch(`${baseUrl}/content`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(browserOptions),
    });

    if (!contentResponse.ok) {
      const errorBody = await contentResponse.text();
      return jsonResponse({ error: `Browser Rendering API error (${contentResponse.status}): ${errorBody}` }, contentResponse.status);
    }

    const contentData = await contentResponse.json<{ success: boolean; result: string; errors?: unknown[] }>();
    if (!contentData.success) {
      return jsonResponse({ error: "Browser Rendering content API returned failure", details: contentData.errors }, 500);
    }

    // Step 2: Clean HTML — strip nav, header, footer, aside, etc.
    const cleanedHtml = await stripBoilerplate(contentData.result);

    // Step 3: Convert cleaned HTML to markdown via /markdown endpoint
    const apiResponse = await fetch(`${baseUrl}/markdown`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ html: cleanedHtml }),
    });

    if (!apiResponse.ok) {
      const errorBody = await apiResponse.text();
      return jsonResponse({ error: `Browser Rendering API error (${apiResponse.status}): ${errorBody}` }, apiResponse.status);
    }

    const data = await apiResponse.json<{ success: boolean; result: string; errors?: unknown[] }>();
    if (!data.success) {
      return jsonResponse({ error: "Browser Rendering API returned failure", details: data.errors }, 500);
    }

    const response = jsonResponse({ markdown: data.result }, 200, { "x-cache": "MISS" });

    ctx.waitUntil(
      cache.put(
        cacheKey,
        new Response(JSON.stringify({ markdown: data.result }), {
          headers: { ...corsHeaders(), "content-type": "application/json", "cache-control": `public, max-age=${RENDER_CACHE_TTL}` },
        })
      )
    );

    return response;
  } catch (e) {
    return jsonResponse({ error: `Render failed: ${e instanceof Error ? e.message : "Unknown error"}` }, 500);
  }
}

async function stripBoilerplate(html: string): Promise<string> {
  const remove = { element(el: Element) { el.remove(); } };
  const rewriter = new HTMLRewriter()
    // Structural boilerplate
    .on("nav", remove)
    .on("header", remove)
    .on("footer", remove)
    .on("aside", remove)
    .on("script", remove)
    .on("style", remove)
    .on("noscript", remove)
    // ARIA roles
    .on("[role='navigation']", remove)
    .on("[role='banner']", remove)
    .on("[role='contentinfo']", remove)
    .on("[role='complementary']", remove)
    .on("[aria-hidden='true']", remove)
    // Cookie consent / privacy banners
    .on("[class*='cookie']", remove)
    .on("[class*='consent']", remove)
    .on("[id*='cookie']", remove)
    .on("[id*='consent']", remove)
    .on("[class*='gdpr']", remove)
    // Ad containers
    .on("[class*='adsbygoogle']", remove)
    .on("[class*='ad-container']", remove)
    .on("[class*='ad-wrapper']", remove)
    .on("[id*='google_ads']", remove)
    .on("ins.adsbygoogle", remove)
    // Social sharing widgets
    .on("[class*='share-buttons']", remove)
    .on("[class*='social-share']", remove)
    .on("[class*='sharing-buttons']", remove);
  return rewriter.transform(new Response(html)).text();
}

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "content-type": "application/json", ...extraHeaders },
  });
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}
