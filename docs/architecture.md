# Architecture

## Overview

```
┌─────────────────────────────────────────┐
│            MarkUpsideDown               │
│  ┌──────────────┐  ┌────────────────┐   │
│  │   Editor      │  │   Preview      │   │
│  │  (CodeMirror) │  │  (marked.js)   │   │
│  └──────┬───────┘  └────────────────┘   │
│         │ invoke()                       │
│  ┌──────┴───────────────────────────┐   │
│  │      Tauri Backend (Rust)         │   │
│  │  - fetch_url_as_markdown          │   │
│  │  - convert_file_to_markdown       │   │
│  │  - github_fetch_issue/pr          │   │
│  └──────┬───────────────────────────┘   │
└─────────┼───────────────────────────────┘
          │ HTTP
          ▼
┌─────────────────────┐
│  Cloudflare Worker   │
│  AI.toMarkdown()     │
└─────────────────────┘
```

## Components

### Desktop App (`src-tauri/` + `ui/`)

| Layer | Tech | Location |
|-------|------|----------|
| Desktop shell | Tauri v2 (WebKit on macOS) | `src-tauri/` |
| Editor | CodeMirror 6 | `ui/src/main.js` |
| Preview | marked.js | `ui/src/main.js` |
| Theme | Custom dark theme (Catppuccin-inspired) | `ui/src/theme.js` |
| Backend commands | Rust (Tauri IPC) | `src-tauri/src/commands.rs` |

### Conversion Worker (`worker/`)

A lightweight Cloudflare Worker that accepts file uploads via `POST /convert` and returns Markdown using `AI.toMarkdown()`.

**Request flow:**

1. User drops a file or clicks Import
2. Frontend calls Tauri command `convert_file_to_markdown`
3. Rust backend reads the file and sends it to the Worker via HTTP POST
4. Worker calls `AI.toMarkdown()` and returns the Markdown
5. Frontend inserts the Markdown into the editor

## IPC Commands

| Command | Description |
|---------|-------------|
| `fetch_url_as_markdown` | Fetch a URL with `Accept: text/markdown` header |
| `convert_file_to_markdown` | Send a file to the Worker for conversion |
| `detect_file_is_image` | Check if a file is an image (for cost warning) |
| `github_fetch_issue` | Fetch a GitHub issue body via `gh` CLI |
| `github_fetch_pr` | Fetch a GitHub PR body via `gh` CLI |
| `github_list_repos` | List GitHub repos via `gh` CLI |

## Data Flow

- **File open/save**: Tauri FS plugin (sandboxed)
- **URL fetch**: reqwest (Rust HTTP client)
- **Document conversion**: Tauri backend → Cloudflare Worker → Workers AI
- **GitHub**: `gh` CLI subprocess
- **Settings (Worker URL)**: Browser localStorage
