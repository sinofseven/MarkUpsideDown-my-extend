interface Env {
  AI: Ai;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN: string;
  CACHE?: KVNamespace;
  CONVERT_QUEUE?: Queue;
  PUBLISH_BUCKET?: R2Bucket;
  VECTORS?: VectorizeIndex;
}

const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/svg+xml",
]);

const SUPPORTED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/html",
  "text/csv",
  "application/xml",
  "text/xml",
  ...IMAGE_TYPES,
]);

const RENDER_CACHE_TTL = 3600; // 1 hour
const FETCH_KV_TTL = 86400; // 24 hours
const RENDER_KV_TTL = 3600; // 1 hour

// Bump this when adding/changing endpoints so the app can detect outdated Workers.
const WORKER_VERSION = 5;

function hasSecrets(env: Env): boolean {
  return Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN);
}

function hasCache(env: Env): boolean {
  return Boolean(env.CACHE);
}

function hasBatch(env: Env): boolean {
  return Boolean(env.CONVERT_QUEUE && env.CACHE);
}

function hasPublish(env: Env): boolean {
  return Boolean(env.PUBLISH_BUCKET);
}

function hasSearch(env: Env): boolean {
  return Boolean(env.VECTORS);
}

/** Wrap a raw JSON Schema into the format expected by Browser Rendering APIs. */
function wrapJsonSchema(schema: unknown): unknown {
  // Already in the correct { type: "json_schema", json_schema: ... } form
  if (typeof schema === "object" && schema !== null && "type" in schema && (schema as Record<string, unknown>).type === "json_schema") {
    return schema;
  }
  return {
    type: "json_schema",
    json_schema: {
      name: "extraction",
      schema,
    },
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return handleHealth(env);
    }

    if (request.method === "POST" && url.pathname === "/fetch") {
      return handleFetch(request, env);
    }

    if (request.method === "GET" && url.pathname === "/render") {
      return handleRender(url, env, ctx);
    }

    if (request.method === "POST" && url.pathname === "/convert") {
      return handleConvert(request, env);
    }

    if (request.method === "POST" && url.pathname === "/json") {
      return handleJson(request, env);
    }

    if (request.method === "POST" && url.pathname === "/crawl") {
      return handleCrawlStart(request, env);
    }

    const crawlMatch = url.pathname.match(/^\/crawl\/([a-zA-Z0-9_-]+)$/);
    if (request.method === "GET" && crawlMatch) {
      return handleCrawlStatus(crawlMatch[1], url, env);
    }

    if (request.method === "POST" && url.pathname === "/batch") {
      return handleBatchSubmit(request, env);
    }

    const batchMatch = url.pathname.match(/^\/batch\/([a-zA-Z0-9_-]+)$/);
    if (request.method === "GET" && batchMatch) {
      return handleBatchStatus(batchMatch[1], env);
    }

    const batchFileMatch = url.pathname.match(/^\/batch\/([a-zA-Z0-9_-]+)\/(\d+)$/);
    if (request.method === "GET" && batchFileMatch) {
      return handleBatchFile(batchFileMatch[1], parseInt(batchFileMatch[2]), env);
    }

    if (request.method === "PUT" && url.pathname === "/publish") {
      return handlePublish(request, env);
    }

    if (request.method === "GET" && url.pathname === "/published") {
      return handlePublishedList(env);
    }

    const publishKeyMatch = url.pathname.match(/^\/p\/(.+)$/);
    if (request.method === "GET" && publishKeyMatch) {
      return handleServePublished(publishKeyMatch[1], env);
    }

    const deletePublishMatch = url.pathname.match(/^\/publish\/(.+)$/);
    if (request.method === "DELETE" && deletePublishMatch) {
      return handleUnpublish(deletePublishMatch[1], env);
    }

    if (request.method === "POST" && url.pathname === "/embed") {
      return handleEmbed(request, env);
    }

    if (request.method === "POST" && url.pathname === "/search") {
      return handleSearch(request, env);
    }

    const embedDeleteMatch = url.pathname.match(/^\/embed\/(.+)$/);
    if (request.method === "DELETE" && embedDeleteMatch) {
      return handleEmbedDelete(embedDeleteMatch[1], env);
    }

    return jsonResponse({ error: "Not found" }, 404);
  },
  async queue(batch: MessageBatch<ConvertMessage>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      const { batchId, index, name, content } = msg.body;
      const statusKey = `batch:${batchId}`;
      try {
        const blob = base64ToBlob(content, name);
        const result = await env.AI.toMarkdown([{ name, blob }]);
        const markdown = result
          .filter((r) => r.format === "markdown")
          .map((r) => r.data)
          .join("\n\n");
        // Store result
        await kvPut(env, `batch:${batchId}:${index}`, markdown, 3600, { name });
        // Update job status
        await updateBatchFileStatus(env, statusKey, index, "done");
        msg.ack();
      } catch (e) {
        await updateBatchFileStatus(env, statusKey, index, "failed", e instanceof Error ? e.message : "Unknown error");
        msg.retry();
      }
    }
  },
} satisfies ExportedHandler<Env>;

function handleHealth(env: Env): Response {
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

// --- KV Cache helpers ---

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function shouldBypassCache(request: Request): boolean {
  return request.headers.get("cache-control") === "no-cache";
}

async function kvGet(env: Env, key: string): Promise<string | null> {
  if (!env.CACHE) return null;
  return env.CACHE.get(key);
}

async function kvPut(env: Env, key: string, value: string, ttl: number, metadata: Record<string, string>): Promise<void> {
  if (!env.CACHE) return;
  await env.CACHE.put(key, value, { expirationTtl: ttl, metadata });
}

// --- Fetch URL → AI.toMarkdown() ---

async function handleFetch(request: Request, env: Env): Promise<Response> {
  let body: { url: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!body.url) {
    return jsonResponse({ error: "Missing 'url' field" }, 400);
  }

  const ssrfError = await validateUrlForSsrf(body.url);
  if (ssrfError) {
    return jsonResponse({ error: ssrfError }, 400);
  }

  // KV cache lookup
  const bypass = shouldBypassCache(request);
  if (!bypass) {
    const cacheKey = `md:fetch:${await sha256(body.url)}`;
    const cached = await kvGet(env, cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      return jsonResponse({ ...parsed, cache: "hit" });
    }
  }

  try {
    const response = await fetch(body.url, {
      headers: { "Accept": "text/markdown, text/html;q=0.9, */*;q=0.8" },
      redirect: "follow",
    });

    if (!response.ok) {
      return jsonResponse({ error: `Fetch failed (${response.status}): ${response.statusText}` }, response.status);
    }

    const contentType = response.headers.get("content-type") || "";

    // If the server returned Markdown directly (Markdown for Agents), pass through
    if (contentType.includes("text/markdown")) {
      const markdown = await response.text();
      const result = { markdown, source: "markdown-for-agents", spa_detected: false };
      // Cache Markdown-for-Agents responses too
      const cacheKey = `md:fetch:${await sha256(body.url)}`;
      await kvPut(env, cacheKey, JSON.stringify(result), FETCH_KV_TTL, { url: body.url, endpoint: "fetch" });
      return jsonResponse({ ...result, cache: "miss" });
    }

    // Otherwise, convert HTML via AI.toMarkdown()
    const html = await response.text();
    const spaDetected = detectSpa(html);
    const markdown = await htmlToMarkdown(html, env);
    const result = { markdown, source: "ai-to-markdown", spa_detected: spaDetected };
    const cacheKey = `md:fetch:${await sha256(body.url)}`;
    await kvPut(env, cacheKey, JSON.stringify(result), FETCH_KV_TTL, { url: body.url, endpoint: "fetch" });
    return jsonResponse({ ...result, cache: "miss" });
  } catch (e) {
    return jsonResponse({ error: `Fetch failed: ${e instanceof Error ? e.message : "Unknown error"}` }, 500);
  }
}

async function htmlToMarkdown(html: string, env: Env): Promise<string> {
  const blob = new Blob([html], { type: "text/html" });
  const result = await env.AI.toMarkdown([{ name: "page.html", blob }]);
  return result
    .filter((r) => r.format === "markdown")
    .map((r) => r.data)
    .join("\n\n");
}

// --- Convert uploaded files → AI.toMarkdown() ---

const MIME_TO_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/html": "html",
  "text/csv": "csv",
  "application/xml": "xml",
  "text/xml": "xml",
};

function mimeToFilename(mimeType: string): string {
  const ext = MIME_TO_EXT[mimeType] ?? mimeType.split("/").pop() ?? "bin";
  return `file.${ext}`;
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
    const fileName = mimeToFilename(mimeType);
    const result = await env.AI.toMarkdown([{ name: fileName, blob }]);
    const markdown = result
      .filter((r) => r.format === "markdown")
      .map((r) => r.data)
      .join("\n\n");
    const warning = isUnconvertedHtml(markdown) ? "Conversion result may contain unconverted HTML" : undefined;
    return jsonResponse({ markdown, is_image: isImage, original_size: originalSize, warning });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}

async function handleRender(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
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

  if (!skipCache) {
    // Layer 1: Edge Cache API (fast)
    const cached = await cache.match(edgeCacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("x-cache", "HIT");
      return new Response(cached.body, { status: cached.status, headers });
    }
    // Layer 2: KV cache (persistent)
    const kvKey = `md:render:${await sha256(targetUrl)}`;
    const kvCached = await kvGet(env, kvKey);
    if (kvCached) {
      const parsed = JSON.parse(kvCached);
      // Re-populate edge cache from KV
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
    // Step 1: Get JS-rendered HTML via Browser Rendering /content endpoint
    const contentResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/browser-rendering/content`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: targetUrl,
          gotoOptions: { waitUntil: "networkidle0" },
          rejectResourceTypes: ["image", "media", "font", "stylesheet"],
        }),
      },
    );

    if (!contentResponse.ok) {
      const errorBody = await contentResponse.text();
      return jsonResponse({ error: `Browser Rendering API error (${contentResponse.status}): ${errorBody}` }, contentResponse.status);
    }

    const contentData = await contentResponse.json<{ success: boolean; result: string; errors?: unknown[] }>();
    if (!contentData.success) {
      return jsonResponse({ error: "Browser Rendering content API returned failure", details: contentData.errors }, 500);
    }

    // Step 2: Convert rendered HTML to Markdown via AI.toMarkdown()
    const markdown = await htmlToMarkdown(contentData.result, env);
    const result = { markdown };

    // Populate both edge cache and KV cache
    const resultJson = JSON.stringify(result);
    ctx.waitUntil(
      Promise.all([
        cache.put(
          edgeCacheKey,
          new Response(resultJson, {
            headers: { ...CORS_HEADERS, "content-type": "application/json", "cache-control": `public, max-age=${RENDER_CACHE_TTL}` },
          }),
        ),
        (async () => {
          const kvKey = `md:render:${await sha256(targetUrl)}`;
          await kvPut(env, kvKey, resultJson, RENDER_KV_TTL, { url: targetUrl, endpoint: "render" });
        })(),
      ]),
    );

    return jsonResponse({ ...result, cache: "miss" });
  } catch (e) {
    return jsonResponse({ error: `Render failed: ${e instanceof Error ? e.message : "Unknown error"}` }, 500);
  }
}

// --- JSON Extraction (Browser Rendering /json API proxy) ---

async function handleJson(request: Request, env: Env): Promise<Response> {
  if (!hasSecrets(env)) {
    return jsonResponse({ error: "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN secrets are required for JSON extraction" }, 500);
  }

  let body: {
    url: string;
    prompt?: string;
    response_format?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!body.url) {
    return jsonResponse({ error: "Missing 'url' field" }, 400);
  }

  if (!body.prompt && !body.response_format) {
    return jsonResponse({ error: "At least one of 'prompt' or 'response_format' is required" }, 400);
  }

  const ssrfError = await validateUrlForSsrf(body.url);
  if (ssrfError) {
    return jsonResponse({ error: ssrfError }, 400);
  }

  const jsonUrl = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/browser-rendering/json`;
  const jsonBody: Record<string, unknown> = {
    url: body.url,
    gotoOptions: { waitUntil: "networkidle0" },
    rejectResourceTypes: ["image", "media", "font"],
  };
  if (body.prompt) jsonBody.prompt = body.prompt;
  if (body.response_format) {
    jsonBody.response_format = wrapJsonSchema(body.response_format);
  }

  try {
    const response = await fetch(jsonUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(jsonBody),
    });

    const data = await response.json<{ success: boolean; result: unknown; errors?: unknown[]; rawAiResponse?: string }>();

    // If the API returned structured result, use it directly
    if (data.success && data.result) {
      return jsonResponse({ data: data.result });
    }

    // Fallback: if rawAiResponse exists, try to parse it as JSON
    if (data.rawAiResponse) {
      try {
        const parsed = JSON.parse(data.rawAiResponse);
        return jsonResponse({ data: parsed });
      } catch {
        // Return the raw text as-is if it's not valid JSON
        return jsonResponse({ data: data.rawAiResponse });
      }
    }

    if (!response.ok) {
      return jsonResponse({ error: `Browser Rendering JSON API error (${response.status})`, details: data.errors }, response.status);
    }

    return jsonResponse({ error: "No data in response", details: data.errors }, 500);
  } catch (e) {
    return jsonResponse({ error: `JSON extraction failed: ${e instanceof Error ? e.message : "Unknown error"}` }, 500);
  }
}

// --- Crawl (Browser Rendering /crawl API proxy) ---

async function handleCrawlStart(request: Request, env: Env): Promise<Response> {
  if (!hasSecrets(env)) {
    return jsonResponse({ error: "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN secrets are required for crawling" }, 500);
  }

  let body: {
    url: string;
    limit?: number;
    depth?: number;
    render?: boolean;
    includePatterns?: string[];
    excludePatterns?: string[];
    formats?: string[];
    response_format?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!body.url) {
    return jsonResponse({ error: "Missing 'url' field" }, 400);
  }

  const ssrfError = await validateUrlForSsrf(body.url);
  if (ssrfError) {
    return jsonResponse({ error: ssrfError }, 400);
  }

  const crawlUrl = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/browser-rendering/crawl`;
  const formats = body.formats ?? ["markdown"];
  const crawlBody: Record<string, unknown> = {
    url: body.url,
    limit: Math.min(body.limit ?? 50, 100000),
    depth: body.depth ?? 3,
    formats,
    render: body.render ?? true,
    rejectResourceTypes: ["image", "media", "font", "stylesheet"],
  };
  if (formats.includes("json")) {
    const jsonOptions: Record<string, unknown> = {};
    if (body.response_format) {
      jsonOptions.response_format = wrapJsonSchema(body.response_format);
    }
    crawlBody.jsonOptions = jsonOptions;
  }

  const options: Record<string, unknown> = {};
  if (body.includePatterns?.length) options.includePatterns = body.includePatterns;
  if (body.excludePatterns?.length) options.excludePatterns = body.excludePatterns;
  if (Object.keys(options).length > 0) crawlBody.options = options;

  try {
    const response = await fetch(crawlUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(crawlBody),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return jsonResponse({ error: `Crawl API error (${response.status}): ${errorBody}` }, response.status);
    }

    const data = await response.json<{ success: boolean; result: string; errors?: unknown[] }>();
    if (!data.success) {
      return jsonResponse({ error: "Crawl API returned failure", details: data.errors }, 500);
    }

    return jsonResponse({ job_id: data.result });
  } catch (e) {
    return jsonResponse({ error: `Crawl failed: ${e instanceof Error ? e.message : "Unknown error"}` }, 500);
  }
}

async function handleCrawlStatus(jobId: string, url: URL, env: Env): Promise<Response> {
  if (!hasSecrets(env)) {
    return jsonResponse({ error: "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN secrets are required" }, 500);
  }

  const limit = url.searchParams.get("limit") || "100";
  const status = url.searchParams.get("status") || "";
  const cursor = url.searchParams.get("cursor") || "";

  let crawlUrl = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/browser-rendering/crawl/${jobId}?limit=${limit}`;
  if (status) crawlUrl += `&status=${status}`;
  if (cursor) crawlUrl += `&cursor=${cursor}`;

  try {
    const response = await fetch(crawlUrl, {
      headers: {
        "Authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return jsonResponse({ error: `Crawl status API error (${response.status}): ${errorBody}` }, response.status);
    }

    const data = await response.json();
    return jsonResponse(data);
  } catch (e) {
    return jsonResponse({ error: `Crawl status failed: ${e instanceof Error ? e.message : "Unknown error"}` }, 500);
  }
}

// --- Batch Conversion (Queue-based) ---

interface ConvertMessage {
  batchId: string;
  index: number;
  name: string;
  content: string; // base64
}

interface BatchJobStatus {
  total: number;
  files: { name: string; status: string; error?: string }[];
}

function base64ToBlob(b64: string, name: string): Blob {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const mimeMap: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    html: "text/html",
    csv: "text/csv",
    xml: "application/xml",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    svg: "image/svg+xml",
  };
  const mime = mimeMap[ext] ?? "application/octet-stream";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function handleBatchSubmit(request: Request, env: Env): Promise<Response> {
  if (!env.CONVERT_QUEUE || !env.CACHE) {
    return jsonResponse({ error: "Batch conversion requires Queue and KV bindings" }, 500);
  }

  let body: { files: { name: string; content: string }[] };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!body.files?.length) {
    return jsonResponse({ error: "Missing 'files' array" }, 400);
  }

  const batchId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const jobStatus: BatchJobStatus = {
    total: body.files.length,
    files: body.files.map((f) => ({ name: f.name, status: "queued" })),
  };

  // Store initial job status in KV
  await env.CACHE.put(`batch:${batchId}`, JSON.stringify(jobStatus), { expirationTtl: 3600 });

  // Enqueue each file
  const messages: { body: ConvertMessage }[] = body.files.map((f, i) => ({
    body: { batchId, index: i, name: f.name, content: f.content },
  }));

  // Queue.sendBatch has a max of 100 messages
  for (let i = 0; i < messages.length; i += 100) {
    await env.CONVERT_QUEUE.sendBatch(messages.slice(i, i + 100));
  }

  return jsonResponse({ batch_id: batchId, total: body.files.length, status: "queued" });
}

async function handleBatchStatus(batchId: string, env: Env): Promise<Response> {
  if (!env.CACHE) {
    return jsonResponse({ error: "KV binding required" }, 500);
  }

  const raw = await env.CACHE.get(`batch:${batchId}`);
  if (!raw) {
    return jsonResponse({ error: "Batch not found" }, 404);
  }

  const job: BatchJobStatus = JSON.parse(raw);
  const completed = job.files.filter((f) => f.status === "done").length;
  const failed = job.files.filter((f) => f.status === "failed").length;

  return jsonResponse({
    batch_id: batchId,
    total: job.total,
    completed,
    failed,
    files: job.files.map((f, i) => ({ index: i, name: f.name, status: f.status, error: f.error })),
  });
}

async function handleBatchFile(batchId: string, index: number, env: Env): Promise<Response> {
  if (!env.CACHE) {
    return jsonResponse({ error: "KV binding required" }, 500);
  }

  const markdown = await env.CACHE.get(`batch:${batchId}:${index}`);
  if (markdown === null) {
    return jsonResponse({ error: "Result not found" }, 404);
  }

  return jsonResponse({ markdown });
}

async function updateBatchFileStatus(
  env: Env,
  statusKey: string,
  index: number,
  status: string,
  error?: string,
): Promise<void> {
  if (!env.CACHE) return;
  const raw = await env.CACHE.get(statusKey);
  if (!raw) return;
  const job: BatchJobStatus = JSON.parse(raw);
  if (index < job.files.length) {
    job.files[index].status = status;
    if (error) job.files[index].error = error;
  }
  await env.CACHE.put(statusKey, JSON.stringify(job), { expirationTtl: 3600 });
}

// --- R2 Publish ---

interface PublishRequest {
  key: string;
  content: string;
  filename: string;
  expires_in?: number; // seconds (0 or omitted = permanent)
}

async function handlePublish(request: Request, env: Env): Promise<Response> {
  if (!env.PUBLISH_BUCKET) {
    return jsonResponse({ error: "R2 bucket not configured" }, 500);
  }

  let body: PublishRequest;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!body.key || !body.content) {
    return jsonResponse({ error: "Missing 'key' and 'content' fields" }, 400);
  }

  const now = new Date();
  const expiresAt = body.expires_in ? new Date(now.getTime() + body.expires_in * 1000).toISOString() : null;

  await env.PUBLISH_BUCKET.put(body.key, body.content, {
    customMetadata: {
      filename: body.filename || "untitled.md",
      publishedAt: now.toISOString(),
      ...(expiresAt ? { expiresAt } : {}),
    },
  });

  const url = new URL(request.url);
  const publicUrl = `${url.origin}/p/${body.key}`;

  return jsonResponse({
    key: body.key,
    url: publicUrl,
    publishedAt: now.toISOString(),
    expiresAt,
  });
}

async function handleServePublished(key: string, env: Env): Promise<Response> {
  if (!env.PUBLISH_BUCKET) {
    return jsonResponse({ error: "R2 bucket not configured" }, 500);
  }

  const obj = await env.PUBLISH_BUCKET.get(key);
  if (!obj) {
    return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
  }

  // Check expiry
  const expiresAt = obj.customMetadata?.expiresAt;
  if (expiresAt && new Date(expiresAt) < new Date()) {
    await env.PUBLISH_BUCKET.delete(key);
    return new Response("Gone — this content has expired", { status: 410, headers: CORS_HEADERS });
  }

  const markdown = await obj.text();
  return new Response(markdown, {
    headers: {
      ...CORS_HEADERS,
      "content-type": "text/markdown; charset=utf-8",
      ...(expiresAt ? { "x-expires-at": expiresAt } : {}),
    },
  });
}

async function handleUnpublish(key: string, env: Env): Promise<Response> {
  if (!env.PUBLISH_BUCKET) {
    return jsonResponse({ error: "R2 bucket not configured" }, 500);
  }

  await env.PUBLISH_BUCKET.delete(key);
  return jsonResponse({ deleted: key });
}

async function handlePublishedList(env: Env): Promise<Response> {
  if (!env.PUBLISH_BUCKET) {
    return jsonResponse({ error: "R2 bucket not configured" }, 500);
  }

  const listed = await env.PUBLISH_BUCKET.list({ limit: 1000 });
  const files = listed.objects.map((obj) => ({
    key: obj.key,
    size: obj.size,
    uploaded: obj.uploaded.toISOString(),
  }));

  return jsonResponse({ files });
}

// --- Semantic Search (Vectorize + Workers AI Embeddings) ---

const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
const MAX_CHUNK_TOKENS = 512; // approximate, split by chars
const MAX_CHUNK_CHARS = MAX_CHUNK_TOKENS * 4; // ~4 chars per token

interface EmbedDocument {
  id: string;
  content: string;
  metadata?: Record<string, string>;
}

/** Split a Markdown document into heading-based chunks. */
function chunkDocument(id: string, content: string): { chunkId: string; text: string }[] {
  const lines = content.split("\n");
  const chunks: { chunkId: string; text: string }[] = [];
  let current = "";
  let headingPrefix = "";
  let chunkIndex = 0;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      // Flush current chunk
      if (current.trim()) {
        chunks.push({ chunkId: `${id}#${chunkIndex}`, text: `${headingPrefix}\n${current}`.trim() });
        chunkIndex++;
      }
      headingPrefix = line;
      current = "";
    } else {
      current += line + "\n";
      // Split if too long
      if (current.length > MAX_CHUNK_CHARS) {
        chunks.push({ chunkId: `${id}#${chunkIndex}`, text: `${headingPrefix}\n${current}`.trim() });
        chunkIndex++;
        current = "";
      }
    }
  }
  // Flush remainder
  if (current.trim()) {
    chunks.push({ chunkId: `${id}#${chunkIndex}`, text: `${headingPrefix}\n${current}`.trim() });
  }

  return chunks.length > 0 ? chunks : [{ chunkId: `${id}#0`, text: content.slice(0, MAX_CHUNK_CHARS) }];
}

async function getEmbeddings(texts: string[], env: Env): Promise<number[][]> {
  const result = await env.AI.run(EMBEDDING_MODEL, { text: texts });
  return (result as { data: number[][] }).data;
}

async function handleEmbed(request: Request, env: Env): Promise<Response> {
  if (!env.VECTORS) {
    return jsonResponse({ error: "Vectorize index not configured" }, 500);
  }

  let body: { documents: EmbedDocument[] };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!body.documents?.length) {
    return jsonResponse({ error: "Missing 'documents' array" }, 400);
  }

  let totalChunks = 0;
  // Process in batches to respect embedding API limits
  for (const doc of body.documents) {
    const chunks = chunkDocument(doc.id, doc.content);
    const texts = chunks.map((c) => c.text);
    const embeddings = await getEmbeddings(texts, env);

    const vectors = chunks.map((c, i) => ({
      id: c.chunkId,
      values: embeddings[i],
      metadata: {
        docId: doc.id,
        ...(doc.metadata ?? {}),
      },
    }));

    // Vectorize upsert max 1000 vectors at a time
    for (let i = 0; i < vectors.length; i += 1000) {
      await env.VECTORS.upsert(vectors.slice(i, i + 1000));
    }
    totalChunks += chunks.length;
  }

  return jsonResponse({ indexed: body.documents.length, chunks: totalChunks });
}

async function handleSearch(request: Request, env: Env): Promise<Response> {
  if (!env.VECTORS) {
    return jsonResponse({ error: "Vectorize index not configured" }, 500);
  }

  let body: { query: string; limit?: number };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!body.query) {
    return jsonResponse({ error: "Missing 'query' field" }, 400);
  }

  const [queryEmbedding] = await getEmbeddings([body.query], env);
  const results = await env.VECTORS.query(queryEmbedding, {
    topK: body.limit ?? 10,
    returnMetadata: "all",
  });

  return jsonResponse({
    results: results.matches.map((m) => ({
      id: m.id,
      score: m.score,
      metadata: m.metadata,
    })),
  });
}

async function handleEmbedDelete(docId: string, env: Env): Promise<Response> {
  if (!env.VECTORS) {
    return jsonResponse({ error: "Vectorize index not configured" }, 500);
  }

  // Delete all chunk vectors for this document.
  // Vectorize doesn't support metadata-based deletion, so we delete by known chunk IDs.
  // The caller should know the chunk count, or we delete a reasonable range.
  const ids: string[] = [];
  for (let i = 0; i < 100; i++) {
    ids.push(`${docId}#${i}`);
  }
  await env.VECTORS.deleteByIds(ids);

  return jsonResponse({ deleted: docId });
}

// --- SSRF Prevention ---

const PRIVATE_IP_RANGES: Array<{ prefix: number[]; bits: number }> = [
  // IPv4 private/reserved
  { prefix: [10], bits: 8 },           // 10.0.0.0/8
  { prefix: [172, 16], bits: 12 },     // 172.16.0.0/12
  { prefix: [192, 168], bits: 16 },    // 192.168.0.0/16
  { prefix: [127], bits: 8 },          // 127.0.0.0/8 (loopback)
  { prefix: [169, 254], bits: 16 },    // 169.254.0.0/16 (link-local)
  { prefix: [0], bits: 8 },            // 0.0.0.0/8
  { prefix: [100, 64], bits: 10 },     // 100.64.0.0/10 (CGNAT)
  { prefix: [192, 0, 0], bits: 24 },   // 192.0.0.0/24
  { prefix: [192, 0, 2], bits: 24 },   // 192.0.2.0/24 (TEST-NET-1)
  { prefix: [198, 51, 100], bits: 24 },// 198.51.100.0/24 (TEST-NET-2)
  { prefix: [203, 0, 113], bits: 24 }, // 203.0.113.0/24 (TEST-NET-3)
  { prefix: [224], bits: 4 },          // 224.0.0.0/4 (multicast)
  { prefix: [240], bits: 4 },          // 240.0.0.0/4 (reserved)
];

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return false;

  for (const range of PRIVATE_IP_RANGES) {
    if (ipMatchesCidr(parts, range.prefix, range.bits)) return true;
  }
  return false;
}

function ipMatchesCidr(ip: number[], prefix: number[], bits: number): boolean {
  const ipNum = (ip[0] << 24) | (ip[1] << 16) | (ip[2] << 8) | ip[3];
  // Pad prefix to 4 octets
  const p = [...prefix, 0, 0, 0, 0].slice(0, 4);
  const prefixNum = (p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3];
  const mask = bits === 0 ? 0 : (~0 << (32 - bits));
  return (ipNum & mask) === (prefixNum & mask);
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true;                    // loopback
  if (lower === "::") return true;                     // unspecified
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 (ULA)
  if (lower.startsWith("fe80")) return true;           // fe80::/10 (link-local)
  // IPv4-mapped IPv6 (::ffff:x.x.x.x)
  const v4Mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped) return isPrivateIpv4(v4Mapped[1]);
  return false;
}

function isPrivateIp(ip: string): boolean {
  return ip.includes(":") ? isPrivateIpv6(ip) : isPrivateIpv4(ip);
}

async function resolveHostname(hostname: string): Promise<string[]> {
  // Use Cloudflare DNS-over-HTTPS to resolve the hostname
  const dohUrl = `https://1.1.1.1/dns-query?name=${encodeURIComponent(hostname)}&type=A`;
  const response = await fetch(dohUrl, {
    headers: { Accept: "application/dns-json" },
  });
  if (!response.ok) return [];
  const data = await response.json<{ Answer?: Array<{ type: number; data: string }> }>();
  if (!data.Answer) return [];
  // type 1 = A record, type 28 = AAAA record
  return data.Answer.filter((a) => a.type === 1 || a.type === 28).map((a) => a.data);
}

async function validateUrlForSsrf(input: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return "Invalid URL";
  }

  // Only allow http/https
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `Blocked: unsupported protocol "${parsed.protocol}"`;
  }

  const hostname = parsed.hostname;

  // Check if hostname is a raw IP
  if (isPrivateIp(hostname)) {
    return "Blocked: URL resolves to a private/reserved IP address";
  }

  // Resolve hostname and check each IP
  const ips = await resolveHostname(hostname);
  for (const ip of ips) {
    if (isPrivateIp(ip)) {
      return "Blocked: URL resolves to a private/reserved IP address";
    }
  }

  return null;
}

// --- SPA Detection ---

function detectSpa(html: string): boolean {
  // Empty SPA mount points
  if (/<div\s+id=["'](root|app|__next|__nuxt)["'][^>]*>\s*<\/div>/i.test(html)) return true;

  // Framework markers
  if (/data-reactroot|ng-version=|data-server-rendered/i.test(html)) return true;

  // Noscript with JS requirement
  const noscript = html.match(/<noscript[^>]*>([\s\S]*?)<\/noscript>/i);
  if (noscript && /javascript|enable|activate/i.test(noscript[1])) return true;

  // Low text content ratio: strip tags, check visible text length
  let stripped = html;
  // Loop to handle nested/malformed tags (e.g. <scr<script>ipt>)
  let prev: string;
  do {
    prev = stripped;
    stripped = stripped.replace(/<script\b[^<]*(?:(?!<\/script[\s>])<[^<]*)*<\/script\b[^>]*>/gi, "");
  } while (stripped !== prev);
  do {
    prev = stripped;
    stripped = stripped.replace(/<style\b[^<]*(?:(?!<\/style[\s>])<[^<]*)*<\/style\b[^>]*>/gi, "");
  } while (stripped !== prev);
  do {
    prev = stripped;
    stripped = stripped.replace(/<[^>]+>/g, "");
  } while (stripped !== prev);
  const textContent = stripped.replace(/\s+/g, " ").trim();
  if (html.length > 5000 && textContent.length < 200) return true;

  return false;
}

// --- Unconverted HTML Detection ---

const HTML_BLOCK_TAGS = /<(?:div|span|section|article|main|table|thead|tbody|tr|td|th|form|input|button|select|textarea|iframe|script|style|link|meta)\b[^>]*>/gi;

function isUnconvertedHtml(text: string): boolean {
  // Short text is unlikely to be unconverted HTML
  if (text.length < 100) return false;

  const tagMatches = text.match(HTML_BLOCK_TAGS);
  if (!tagMatches) return false;

  // Density: HTML tags per 1000 chars
  const density = (tagMatches.length / text.length) * 1000;
  return density > 5;
}

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json", ...extraHeaders },
  });
}

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};
