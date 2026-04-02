import type { Env, ConvertMessage } from "../types.js";
import { BATCH_TTL, BATCH_SEND_MAX, EXT_TO_MIME } from "../config.js";
import { jsonResponse, kvPut } from "../utils.js";

function base64ToBlob(b64: string, name: string): Blob {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const mime = EXT_TO_MIME[ext] ?? "application/octet-stream";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function updateBatchFileStatus(
  env: Env,
  statusKey: string,
  status: string,
  error?: string,
): Promise<void> {
  if (!env.CACHE) return;
  const value = JSON.stringify({ status, ...(error ? { error } : {}) });
  await env.CACHE.put(statusKey, value, { expirationTtl: BATCH_TTL });
}

export async function handleBatchSubmit(request: Request, env: Env): Promise<Response> {
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

  const jobMeta = { total: body.files.length, files: body.files.map((f) => f.name) };
  await env.CACHE.put(`batch:${batchId}`, JSON.stringify(jobMeta), { expirationTtl: BATCH_TTL });

  await Promise.all(
    body.files.flatMap((f, i) => [
      env.CACHE!.put(`batch:${batchId}:data:${i}`, f.content, { expirationTtl: BATCH_TTL, metadata: { name: f.name } }),
      env.CACHE!.put(`batch:${batchId}:status:${i}`, JSON.stringify({ status: "queued" }), { expirationTtl: BATCH_TTL }),
    ]),
  );

  const messages: { body: ConvertMessage }[] = body.files.map((f, i) => ({
    body: { batchId, index: i, name: f.name },
  }));

  for (let i = 0; i < messages.length; i += BATCH_SEND_MAX) {
    await env.CONVERT_QUEUE.sendBatch(messages.slice(i, i + BATCH_SEND_MAX));
  }

  return jsonResponse({ batch_id: batchId, total: body.files.length, status: "queued" });
}

export async function handleBatchStatus(batchId: string, env: Env): Promise<Response> {
  if (!env.CACHE) {
    return jsonResponse({ error: "KV binding required" }, 500);
  }

  const raw = await env.CACHE.get(`batch:${batchId}`);
  if (!raw) {
    return jsonResponse({ error: "Batch not found" }, 404);
  }

  const jobMeta: { total: number; files: string[] } = JSON.parse(raw);

  const statusPromises = jobMeta.files.map((_, i) => env.CACHE!.get(`batch:${batchId}:status:${i}`));
  const statuses = await Promise.all(statusPromises);

  let completed = 0;
  let failed = 0;
  const files = jobMeta.files.map((name, i) => {
    const s = statuses[i] ? JSON.parse(statuses[i]!) : { status: "queued" };
    if (s.status === "done") completed++;
    if (s.status === "failed") failed++;
    return { index: i, name, status: s.status as string, error: s.error as string | undefined };
  });

  return jsonResponse({ batch_id: batchId, total: jobMeta.total, completed, failed, files });
}

export async function handleBatchFile(batchId: string, index: number, env: Env): Promise<Response> {
  if (!env.CACHE) {
    return jsonResponse({ error: "KV binding required" }, 500);
  }

  const markdown = await env.CACHE.get(`batch:${batchId}:${index}`);
  if (markdown === null) {
    return jsonResponse({ error: "Result not found" }, 404);
  }

  return jsonResponse({ markdown });
}

/** Queue consumer: process batch conversion messages. */
export async function processBatchQueue(batch: MessageBatch<ConvertMessage>, env: Env): Promise<void> {
  for (const msg of batch.messages) {
    const { batchId, index, name } = msg.body;
    try {
      const dataKey = `batch:${batchId}:data:${index}`;
      const content = await env.CACHE!.get(dataKey);
      if (!content) {
        await updateBatchFileStatus(env, `batch:${batchId}:status:${index}`, "failed", "File data expired or missing");
        msg.ack();
        continue;
      }
      const blob = base64ToBlob(content, name);
      const result = await env.AI.toMarkdown([{ name, blob }]);
      const markdown = result
        .filter((r) => r.format === "markdown")
        .map((r) => r.data)
        .join("\n\n");
      await Promise.all([
        kvPut(env, `batch:${batchId}:${index}`, markdown, BATCH_TTL, { name }),
        updateBatchFileStatus(env, `batch:${batchId}:status:${index}`, "done"),
      ]);
      await env.CACHE!.delete(dataKey);
      msg.ack();
    } catch (e) {
      await updateBatchFileStatus(env, `batch:${batchId}:status:${index}`, "failed", e instanceof Error ? e.message : String(e));
      msg.retry();
    }
  }
}
