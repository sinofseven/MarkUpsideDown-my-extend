# MarkUpsideDown

AI-era Markdown editor built with Rust (Tauri v2) and CodeMirror 6.

## Features

- **Live Preview** — Split-pane editor with real-time Markdown rendering
- **CodeMirror 6** — Syntax highlighting, vim keybindings, IME support, code folding
- **Cloudflare Markdown for Agents** — Fetch any URL as clean Markdown using `Accept: text/markdown`
- **GitHub Integration** — Read/write Issues, PRs, and Wikis via `gh` CLI
- **Claude Code Integration** — AI-assisted editing and generation (planned)
- **Dark theme** — Catppuccin-inspired design

## Requirements

- Rust 1.85+
- Node.js 18+
- [gh CLI](https://cli.github.com/) (for GitHub integration)

## Getting Started

```bash
cd ui && npm install && cd ..
cargo tauri dev
```

## Architecture

```
src-tauri/
├── src/
│   ├── main.rs        # Tauri app entry point
│   └── commands.rs    # Backend commands (Cloudflare, GitHub)
├── Cargo.toml
└── tauri.conf.json

ui/
├── src/
│   ├── main.js        # CodeMirror 6 editor + preview + Tauri IPC
│   ├── theme.js       # Dark theme (Catppuccin-inspired)
│   └── styles.css     # Layout and preview styles
├── index.html
└── package.json
```

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE) for details.

For commercial licensing inquiries, please contact the author.
