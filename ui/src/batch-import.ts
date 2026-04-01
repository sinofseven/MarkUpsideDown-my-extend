// Batch file import via Worker's /batch endpoint (Queue-based parallel conversion).

import { getWorkerUrl } from "./settings.ts";
import { normalizeMarkdown } from "./normalize.ts";
import { basename } from "./path-utils.ts";

const { readFile, writeTextFile } = window.__TAURI__.fs;

interface BatchFile {
  name: string;
  content: string; // base64
}

interface BatchSubmitResponse {
  batch_id: string;
  total: number;
  status: string;
}

interface BatchStatusResponse {
  batch_id: string;
  total: number;
  completed: number;
  failed: number;
  files: { index: number; name: string; status: string; error?: string }[];
}

interface BatchFileResponse {
  markdown: string;
}

export interface BatchProgress {
  batchId: string;
  total: number;
  completed: number;
  failed: number;
  files: { name: string; status: string; error?: string }[];
}

async function workerFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const workerUrl = getWorkerUrl();
  if (!workerUrl) throw new Error("Worker URL not configured");
  const resp = await fetch(`${workerUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Read local files and submit them as a batch conversion job. */
export async function submitBatch(
  filePaths: string[],
): Promise<{ batchId: string; total: number }> {
  const files: BatchFile[] = [];
  for (const fp of filePaths) {
    const data = await readFile(fp);
    const b64 = arrayBufferToBase64(data instanceof ArrayBuffer ? data : data.buffer);
    files.push({ name: basename(fp), content: b64 });
  }

  const resp = await workerFetch<BatchSubmitResponse>("/batch", {
    method: "POST",
    body: JSON.stringify({ files }),
  });

  return { batchId: resp.batch_id, total: resp.total };
}

/** Poll batch status until all files are done or failed. */
export async function pollBatch(
  batchId: string,
  onProgress: (progress: BatchProgress) => void,
  intervalMs = 2000,
): Promise<BatchProgress> {
  for (;;) {
    const status = await workerFetch<BatchStatusResponse>(`/batch/${batchId}`);
    const progress: BatchProgress = {
      batchId,
      total: status.total,
      completed: status.completed,
      failed: status.failed,
      files: status.files,
    };
    onProgress(progress);

    if (status.completed + status.failed >= status.total) return progress;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Retrieve the converted Markdown for a specific file in the batch. */
export async function getBatchResult(batchId: string, index: number): Promise<string> {
  const resp = await workerFetch<BatchFileResponse>(`/batch/${batchId}/${index}`);
  return normalizeMarkdown(resp.markdown);
}

/** Save batch results as .md files into the target directory. */
export async function saveBatchResults(
  batchId: string,
  progress: BatchProgress,
  targetDir: string,
): Promise<string[]> {
  const saved: string[] = [];
  for (const f of progress.files) {
    if (f.status !== "done") continue;
    const md = await getBatchResult(batchId, progress.files.indexOf(f));
    const mdName = f.name.replace(/\.[^.]+$/, ".md");
    const outPath = `${targetDir}/${mdName}`;
    await writeTextFile(outPath, md);
    saved.push(outPath);
  }
  return saved;
}
