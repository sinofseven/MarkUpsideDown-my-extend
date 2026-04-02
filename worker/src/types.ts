export interface Env {
  AI: Ai;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN: string;
  CACHE?: KVNamespace;
  CONVERT_QUEUE?: Queue;
  PUBLISH_BUCKET?: R2Bucket;
  VECTORS?: VectorizeIndex;
}

export interface ConvertMessage {
  batchId: string;
  index: number;
  name: string;
}
