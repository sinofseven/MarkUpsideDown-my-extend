import type { Env } from "../types.js";
import { PUBLISH_LIST_LIMIT } from "../config.js";
import { jsonResponse, CORS_HEADERS } from "../utils.js";

interface PublishRequest {
  key: string;
  content: string;
  filename: string;
  expires_in?: number; // seconds (0 or omitted = permanent)
}

export async function handlePublish(request: Request, env: Env): Promise<Response> {
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

export async function handleServePublished(key: string, env: Env): Promise<Response> {
  if (!env.PUBLISH_BUCKET) {
    return jsonResponse({ error: "R2 bucket not configured" }, 500);
  }

  const obj = await env.PUBLISH_BUCKET.get(key);
  if (!obj) {
    return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
  }

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

export async function handleUnpublish(key: string, env: Env): Promise<Response> {
  if (!env.PUBLISH_BUCKET) {
    return jsonResponse({ error: "R2 bucket not configured" }, 500);
  }

  await env.PUBLISH_BUCKET.delete(key);
  return jsonResponse({ deleted: key });
}

export async function handlePublishedList(env: Env): Promise<Response> {
  if (!env.PUBLISH_BUCKET) {
    return jsonResponse({ error: "R2 bucket not configured" }, 500);
  }

  const listed = await env.PUBLISH_BUCKET.list({ limit: PUBLISH_LIST_LIMIT });
  const files = listed.objects.map((obj) => ({
    key: obj.key,
    size: obj.size,
    uploaded: obj.uploaded.toISOString(),
  }));

  return jsonResponse({ files });
}
