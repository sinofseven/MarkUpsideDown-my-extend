# Worker Deployment Guide

MarkUpsideDown uses a Cloudflare Worker for two features:

1. **Document Import** — Convert PDF, Office, images, etc. to Markdown via [Workers AI `AI.toMarkdown()`](https://developers.cloudflare.com/workers-ai/markdown-conversion/)
2. **Rendered Fetch** — Fetch JavaScript-rendered pages as Markdown via [Browser Rendering `/markdown` REST API](https://developers.cloudflare.com/browser-rendering/rest-api/markdown-endpoint/)

Each user deploys their own Worker instance.

## Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works for document import)
- [wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) CLI installed globally

## API Token Setup

Create a single API token that covers deployment, document import, and rendered fetch:

1. Go to [API Tokens](https://dash.cloudflare.com/profile/api-tokens) → **Create Token**
2. Use the **"Edit Cloudflare Workers"** template → **Use template**
3. Add these additional permissions:
   - `Account` → `Workers AI` → `Read`
   - `Account` → `Browser Rendering` → `Edit`
4. Account Resources: select your account
5. Create the token and save it

The final token should have these permissions:

| Scope | Permission | Purpose |
|-------|-----------|---------|
| Account > Workers Scripts | Edit | `wrangler deploy` |
| Account > Workers AI | Read | `AI.toMarkdown()` (document import) |
| Account > Browser Rendering | Edit | `/render` endpoint |

## Deploy

```bash
export CLOUDFLARE_API_TOKEN="your-token-here"
cd worker && npm install && wrangler deploy
```

## Set Worker Secrets

Get your **Account ID** from [Cloudflare Dashboard](https://dash.cloudflare.com/) → Workers & Pages → right sidebar.

```bash
cd worker
wrangler secret put CLOUDFLARE_ACCOUNT_ID
# Paste your Account ID

wrangler secret put CLOUDFLARE_API_TOKEN
# Paste the same API token created above
```

> **Note**: The secrets are required for the `/render` endpoint (Rendered Fetch). If you only need Document Import, you can skip this step — the `/convert` endpoint uses the AI binding directly and works without secrets.

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

## When to Use Rendered Fetch

| Scenario | Use |
|----------|-----|
| Static pages, blogs, docs | **Standard** fetch (fast, free) |
| SPAs (React, Vue, Angular) | **Render JS** |
| Pages behind JS-based loading | **Render JS** |
| Dynamic dashboards | **Render JS** |

## Pricing

### Browser Rendering

| Plan | Browser Time | Rate Limit | Cost |
|------|-------------|------------|------|
| **Free** | 10 min/day | 6 req/min | Free |
| **Paid** | 10 hrs/month | 600 req/min | $5/month |

The free tier is sufficient for occasional use. See [Browser Rendering Pricing](https://developers.cloudflare.com/browser-rendering/pricing/) for details.

### Document Import

| Format | Cost |
|--------|------|
| PDF, DOCX, XLSX, PPTX, HTML, CSV, XML | **Free** (no AI Neurons) |
| Images (JPG, PNG, GIF, WebP, BMP, TIFF) | **AI Neurons** (OCR) |

The app shows a confirmation dialog before processing images.

## Supported Import Formats

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

Ensure `CLOUDFLARE_API_TOKEN` is set and the token has `Workers Scripts: Edit` permission. See [API Token Setup](#api-token-setup).

### "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN secrets are required" error

Set the secrets as described in [Set Worker Secrets](#set-worker-secrets). This is only required for the "Render JS" feature.

### Browser Rendering API errors

- **403**: Check that your API token has `Browser Rendering - Edit` permission.
- **429**: Rate limit exceeded. Free tier allows 6 requests/minute.
- **Timeout**: Some complex pages may take longer to render. Try again or use standard fetch.

### CORS errors in the app

The Worker includes permissive CORS headers (`*`). If you need to restrict origins, edit `corsHeaders()` in `worker/src/index.ts`.

### Updating the Worker

```bash
cd worker
wrangler deploy
```

No app-side changes needed — the URL stays the same. Secrets persist across deploys.
