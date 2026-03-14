# Architecture

## Overview

```
AI Agent (Claude Desktop, etc.)
    ↕ stdio (JSON-RPC)
MCP Server (mcp-server/)
    ↕ HTTP
    ↓
┌─────────────────────────────────────────────────────┐
│                  MarkUpsideDown                      │
│                                                      │
│  ┌──────────────┐  ┌─────────────────────────────┐  │
│  │   Editor      │  │   Preview                    │  │
│  │  (CodeMirror) │  │  (marked.js + Mermaid)       │  │
│  │  + Table Edit │  │                              │  │
│  └──────┬───────┘  └─────────────────────────────┘  │
│         │ invoke()                                    │
│  ┌──────┴──────────────────────────────────────┐    │
│  │      Tauri Backend (Rust)                    │    │
│  │  - fetch_url_as_markdown (Markdown for Agents)│    │
│  │  - fetch_rendered_url_as_markdown (→ Worker)  │    │
│  │  - convert_file_to_markdown (→ Worker)        │    │
│  │  - sync_editor_state (MCP bridge)             │    │
│  │  - github_fetch_issue/pr                      │    │
│  │                                               │    │
│  │  MCP Bridge (axum, localhost:31415)            │    │
│  └──────┬──────────────────────────────────────┘    │
└─────────┼───────────────────────────────────────────┘
          │ HTTP
          ▼
┌───────────────────────────────────┐
│  Cloudflare Worker                 │
│  GET  /health   → capability check │
│  POST /convert  → AI.toMarkdown() │
│  GET  /render   → Browser Rendering /markdown API │
└───────────────────────────────────┘
```

## Components

### Desktop App (`src-tauri/` + `ui/`)

| Layer | Tech | Location |
|-------|------|----------|
| Desktop shell | Tauri v2 (WebKit on macOS) | `src-tauri/` |
| Editor | CodeMirror 6 (Markdown + nested code blocks) | `ui/src/main.js` |
| Settings | Worker setup, first-run, feature status | `ui/src/settings.js` |
| Table editor | Spreadsheet-like grid with keyboard navigation | `ui/src/table-editor.js` |
| Preview | marked.js + Mermaid (Markdown → HTML + diagrams) | `ui/src/main.js` |
| Theme | Custom dark theme (Catppuccin-inspired) | `ui/src/theme.js` |
| Backend commands | Rust (Tauri IPC) | `src-tauri/src/commands.rs` |
| MCP bridge | Rust (axum HTTP server) | `src-tauri/src/bridge.rs` |

### Cloudflare Worker (`worker/`)

A lightweight Cloudflare Worker with three endpoints:

| Endpoint | Purpose | Cloudflare Service |
|----------|---------|-------------------|
| `GET /health` | Capability check | — |
| `POST /convert` | Document → Markdown | Workers AI `AI.toMarkdown()` |
| `GET /render?url=` | JS-rendered page → Markdown | Browser Rendering `/markdown` REST API |

**Document import flow:**

1. User drops a file or clicks Import
2. Frontend calls Tauri command `convert_file_to_markdown`
3. Rust backend reads the file and sends it to the Worker via HTTP POST
4. Worker calls `AI.toMarkdown()` and returns the Markdown
5. Frontend inserts the Markdown into the editor

**Rendered fetch flow:**

1. User enters a URL with "Render JS" enabled
2. Frontend calls Tauri command `fetch_rendered_url_as_markdown`
3. Rust backend calls Worker `GET /render?url=...`
4. Worker calls Browser Rendering `/markdown` REST API (with cache, 1h TTL)
5. Frontend replaces editor content with the Markdown

### MCP Server (`mcp-server/`)

A stdio-based MCP server that enables AI agents to interact with the editor.

| Component | Role |
|-----------|------|
| `index.ts` | MCP tool definitions (9 tools) |
| `bridge.ts` | HTTP client to Tauri bridge |

**Communication:** The MCP server reads the bridge port from `~/.markupsidedown-bridge-port` and sends HTTP requests to the Tauri backend's axum server.

See [mcp-server.md](mcp-server.md) for the full tool list and setup guide.

## Tauri IPC Commands

| Command | Description |
|---------|-------------|
| `sync_editor_state` | Sync editor state to Rust (for MCP bridge) |
| `test_worker_url` | Test Worker connection and report capabilities |
| `fetch_url_as_markdown` | Fetch a URL with `Accept: text/markdown` header |
| `fetch_rendered_url_as_markdown` | Fetch a JS-rendered page via Worker `/render` |
| `convert_file_to_markdown` | Send a file to the Worker `/convert` |
| `detect_file_is_image` | Check if a file is an image (for cost warning) |
| `github_fetch_issue` | Fetch a GitHub issue body via `gh` CLI |
| `github_fetch_pr` | Fetch a GitHub PR body via `gh` CLI |
| `github_list_repos` | List GitHub repos via `gh` CLI |

## MCP Bridge Endpoints

The Tauri backend runs an axum HTTP server on `localhost:31415` (fallback: 31416–31420).

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/editor/content` | GET | Get current editor content |
| `/editor/content` | POST | Set editor content |
| `/editor/insert` | POST | Insert text at position |
| `/editor/state` | GET | Get editor state (file path, Worker URL, cursor) |
| `/editor/open-file` | POST | Open a file in the editor |
| `/editor/save-file` | POST | Save editor content to file |
| `/editor/export-pdf` | POST | Trigger PDF export |

## Data Flow Summary

| Action | Path |
|--------|------|
| File open/save | Tauri FS plugin (sandboxed) |
| URL fetch (standard) | reqwest → target URL (with `Accept: text/markdown`) |
| URL fetch (rendered) | reqwest → Worker → Browser Rendering REST API |
| Document import | reqwest → Worker → Workers AI `AI.toMarkdown()` |
| GitHub | `gh` CLI subprocess |
| MCP agent access | MCP Server → HTTP → Tauri bridge → Tauri events → Frontend |
| Settings (Worker URL) | Browser localStorage |
| Bridge port discovery | `~/.markupsidedown-bridge-port` file |
