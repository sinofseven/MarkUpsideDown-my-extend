# MarkUpsideDown

Turn any markup into Markdown — websites, PDFs, Office docs, images.

A desktop editor that bridges the web (markup) and AI (Markdown), powered by Cloudflare Workers AI and Browser Rendering.

## Features

### The Core: Markup → Markdown
- **Fetch URL** — Get any website as clean Markdown using Cloudflare Markdown for Agents
- **Fetch URL (Render JS)** — Render JavaScript-heavy pages (SPAs, dynamic sites) and convert to Markdown via Browser Rendering API
- **Document Import** — Convert PDF, DOCX, XLSX, PPTX, CSV, XML, and images to Markdown via Workers AI
- **Drag & Drop** — Drop any supported file onto the editor to import it

### Editor
- **Live Preview** — Split-pane editor with real-time Markdown rendering
- **CodeMirror 6** — Syntax highlighting, line numbers, bracket matching, search & replace
- **Table Editor** — Spreadsheet-like Markdown table editing with keyboard navigation
- **Mermaid Diagrams** — Live rendering of Mermaid diagrams in the preview pane
- **Dark Theme** — Catppuccin-inspired design

### Export
- **Export PDF** — Print/save the preview pane as PDF
- **Copy Rich Text** — Copy rendered HTML to clipboard (Cmd+Shift+C)

### Integration
- **MCP Server** — AI agents (Claude Desktop, etc.) can read/write editor content via Model Context Protocol
- **GitHub** — Read Issues and PRs via `gh` CLI

## Getting Started

### 1. Install the App

**Homebrew (macOS):**

```bash
brew install M-Igashi/tap/markupsidedown
```

**Manual:** Download the `.dmg` from the [latest release](https://github.com/M-Igashi/markupsidedown/releases/latest), open it, and drag **MarkUpsideDown.app** to your Applications folder.

> **Note:** This app is not code-signed. When installing manually, run `xattr -cr /Applications/MarkUpsideDown.app` or right-click the app and select "Open" to bypass Gatekeeper. Homebrew installs handle this automatically.

### 2. Deploy the Cloudflare Worker

The Worker is **required** for the core import and rendering features.

```bash
# Create an API token from the "Edit Cloudflare Workers" template
# (includes Workers Scripts: Edit for deployment),
# then add Workers AI: Read and Browser Rendering: Edit permissions.
export CLOUDFLARE_API_TOKEN="your-token-here"
cd worker && npm install && wrangler deploy
```

For the full-featured Render JS capability, also set these secrets:

```bash
cd worker
wrangler secret put CLOUDFLARE_ACCOUNT_ID
wrangler secret put CLOUDFLARE_API_TOKEN
```

See [docs/worker-deployment.md](docs/worker-deployment.md) for detailed API token creation and pricing.

### 3. Configure in the App

On first launch, MarkUpsideDown opens the **Settings panel** automatically. Paste your Worker URL and click **Test** to verify the connection. The Feature Status section shows which capabilities are ready.

You can reopen Settings at any time from the toolbar.

## Build from Source

### Requirements

- Rust 1.85+
- Node.js 18+
- [gh CLI](https://cli.github.com/) (optional, for GitHub integration)

```bash
cd ui && npm install && cd ..
cargo tauri dev
```

## MCP Server (Optional)

The MCP server lets AI agents interact with the editor.

```bash
cd mcp-server && npm install && npm run build
```

See [docs/mcp-server.md](docs/mcp-server.md) for Claude Desktop configuration and available tools.

## Architecture

```
src-tauri/           # Rust backend (Tauri v2)
├── src/
│   ├── main.rs      # App entry point
│   ├── commands.rs  # IPC commands (URL fetch, file conversion, GitHub)
│   └── bridge.rs    # MCP HTTP bridge (axum server on localhost:31415)
├── Cargo.toml
└── tauri.conf.json

ui/                  # Frontend (Vite + CodeMirror 6)
├── src/
│   ├── main.js      # Editor, preview, toolbar, drag & drop
│   ├── settings.js  # Settings panel, Worker setup, first-run experience
│   ├── table-editor.js  # Spreadsheet-like table editing
│   ├── theme.js     # Dark theme (Catppuccin-inspired)
│   └── styles.css   # Layout and styling
├── index.html
└── package.json

worker/              # Cloudflare Worker
├── src/
│   └── index.ts     # GET /health + POST /convert (AI.toMarkdown) + GET /render (Browser Rendering)
├── wrangler.jsonc
└── package.json

mcp-server/          # MCP Server (Model Context Protocol)
├── src/
│   ├── index.ts     # MCP tool definitions
│   └── bridge.ts    # HTTP client to Tauri bridge
├── tsconfig.json
└── package.json

docs/                # Documentation
├── architecture.md
├── mcp-server.md
└── worker-deployment.md
```

See [docs/architecture.md](docs/architecture.md) for detailed data flow and component documentation.

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE) for details.

For commercial licensing inquiries, please contact the author.
