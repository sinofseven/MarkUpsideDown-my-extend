# Worker Deployment Guide

MarkUpsideDown uses a Cloudflare Worker to convert documents (PDF, Office, images, etc.) to Markdown via [Workers AI `AI.toMarkdown()`](https://developers.cloudflare.com/workers-ai/markdown-conversion/).

Each user deploys their own Worker instance.

## Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- [wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) CLI installed globally

## Deploy

```bash
# Authenticate with Cloudflare
wrangler login

# Install dependencies and deploy
cd worker
npm install
wrangler deploy
```

On success, wrangler outputs your Worker URL:

```
Uploaded markupsidedown-converter
Deployed markupsidedown-converter triggers
  https://markupsidedown-converter.<your-subdomain>.workers.dev
```

## Configure the App

1. Launch MarkUpsideDown
2. Click **Settings** in the toolbar
3. Paste your Worker URL (e.g. `https://markupsidedown-converter.example.workers.dev`)

The URL is saved in localStorage and persists across sessions.

## Cost

| Format | Cost |
|--------|------|
| PDF, DOCX, XLSX, PPTX, HTML, CSV, XML | **Free** (no AI Neurons) |
| Images (JPG, PNG, GIF, WebP, BMP, TIFF) | **AI Neurons** (OCR) |

The app shows a confirmation dialog before processing images.

## Supported Formats

- PDF (`.pdf`)
- Microsoft Word (`.docx`)
- Microsoft Excel (`.xlsx`)
- Microsoft PowerPoint (`.pptx`)
- HTML (`.html`, `.htm`)
- CSV (`.csv`)
- XML (`.xml`)
- Images (`.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.bmp`, `.tiff`, `.tif`)

## Troubleshooting

### Authentication error on deploy

Ensure your API token has **Workers Scripts - Edit** permission, or use `wrangler login` for OAuth.

### CORS errors in the app

The Worker includes permissive CORS headers (`*`). If you need to restrict origins, edit `corsHeaders()` in `worker/src/index.ts`.

### Updating the Worker

```bash
cd worker
wrangler deploy
```

No app-side changes needed — the URL stays the same.
