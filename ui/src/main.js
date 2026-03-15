import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { defaultKeymap, indentWithTab, history, historyKeymap } from "@codemirror/commands";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
} from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { oneDark } from "./theme.js";
import { editTableAtCursor } from "./table-editor.js";
import { showSettings, ensureWorkerUrl, getWorkerUrl, checkFirstRun } from "./settings.js";
import { marked } from "marked";

let mermaidModule = null;
let mermaidIdCounter = 0;

async function getMermaid() {
  if (mermaidModule) return mermaidModule;
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    themeVariables: {
      primaryColor: "#7aacf0",
      primaryTextColor: "#e0ddd5",
      primaryBorderColor: "#35354a",
      lineColor: "#7a7a8e",
      secondaryColor: "#24243a",
      tertiaryColor: "#1a1a2a",
      background: "#1a1a2a",
      mainBkg: "#24243a",
      nodeBorder: "#7aacf0",
      clusterBkg: "#24243a",
      titleColor: "#e0ddd5",
      edgeLabelBackground: "#24243a",
    },
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  });
  mermaidModule = mermaid;
  return mermaid;
}

const { invoke } = window.__TAURI__.core;
const { open, save, confirm } = window.__TAURI__.dialog;
const { readTextFile, writeTextFile } = window.__TAURI__.fs;

let currentFilePath = null;
let previewTimeout = null;

// --- Scroll Sync ---

let scrollSyncSource = null; // 'editor' | 'preview' | null
let scrollSyncTimer = null;
let editorScrollRAF = 0;
let previewScrollRAF = 0;

function setScrollSyncSource(source) {
  scrollSyncSource = source;
  clearTimeout(scrollSyncTimer);
  scrollSyncTimer = setTimeout(() => { scrollSyncSource = null; }, 150);
}

function annotateSourceLines(previewEl, source) {
  const tokens = marked.lexer(source);
  let offset = 0;
  const lines = [];
  for (const token of tokens) {
    if (!token.raw) continue;
    if (token.type === "space") {
      offset += token.raw.length;
      continue;
    }
    const idx = source.indexOf(token.raw, offset);
    if (idx >= 0) {
      const lineNum = source.substring(0, idx).split("\n").length;
      lines.push(lineNum);
      offset = idx + token.raw.length;
    }
  }

  const page = previewEl.querySelector(".preview-page") || previewEl;
  const children = page.children;
  const len = Math.min(children.length, lines.length);
  for (let i = 0; i < len; i++) {
    children[i].setAttribute("data-source-line", lines[i]);
  }
}

function syncEditorToPreview() {
  if (scrollSyncSource === "preview") return;
  setScrollSyncSource("editor");

  const preview = document.getElementById("preview-pane");
  const lineNum = editor.state.doc.lineAt(editor.viewport.from).number;

  const elements = preview.querySelectorAll("[data-source-line]");
  let target = null;
  for (const el of elements) {
    if (parseInt(el.dataset.sourceLine, 10) <= lineNum) {
      target = el;
    } else {
      break;
    }
  }

  if (target) {
    const previewRect = preview.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const scrollOffset = targetRect.top - previewRect.top + preview.scrollTop;
    preview.scrollTo({ top: scrollOffset, behavior: "smooth" });
  }
}

function syncPreviewToEditor() {
  if (scrollSyncSource === "editor") return;
  setScrollSyncSource("preview");

  const preview = document.getElementById("preview-pane");
  const previewRect = preview.getBoundingClientRect();
  const elements = preview.querySelectorAll("[data-source-line]");

  let targetLine = 1;
  for (const el of elements) {
    const rect = el.getBoundingClientRect();
    if (rect.top <= previewRect.top + 10) {
      targetLine = parseInt(el.dataset.sourceLine, 10);
    } else {
      break;
    }
  }

  const clampedLine = Math.min(targetLine, editor.state.doc.lines);
  const line = editor.state.doc.line(clampedLine);
  editor.dispatch({
    effects: EditorView.scrollIntoView(line.from, { y: "start" }),
  });
}

const IMPORT_EXTENSIONS = [
  "pdf", "docx", "xlsx", "pptx", "html", "htm", "csv", "xml",
  "jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "tif",
];

// --- CodeMirror Editor ---

const updatePreview = EditorView.updateListener.of((update) => {
  if (update.docChanged) {
    clearTimeout(previewTimeout);
    previewTimeout = setTimeout(() => {
      renderPreview(update.state.doc.toString());
      updateStatus(update.state);
    }, 150);
    syncEditorState();
  }
});

const editor = new EditorView({
  state: EditorState.create({
    doc: "# Welcome to MarkUpsideDown\n\nStart typing your Markdown here…\n",
    extensions: [
      lineNumbers(),
      highlightActiveLine(),
      drawSelection(),
      bracketMatching(),
      history(),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      oneDark,
      search(),
      keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
      updatePreview,
      EditorView.lineWrapping,
    ],
  }),
  parent: document.getElementById("editor-pane"),
});

// --- Preview ---

// SVG cache: URL -> sanitized SVG string
const svgCache = new Map();

async function inlineSvgImages(container) {
  const imgs = container.querySelectorAll('img[src$=".svg"]');
  const tasks = Array.from(imgs).map(async (img) => {
    const url = img.src;
    if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) return;

    try {
      let svgText;
      if (svgCache.has(url)) {
        svgText = svgCache.get(url);
      } else {
        svgText = await invoke("fetch_svg", { url });
        svgCache.set(url, svgText);
      }

      const wrapper = document.createElement("span");
      wrapper.className = "inline-svg";
      wrapper.innerHTML = svgText;

      // Preserve alt text as aria-label
      const alt = img.alt;
      const svgEl = wrapper.querySelector("svg");
      if (svgEl && alt) {
        svgEl.setAttribute("aria-label", alt);
        svgEl.setAttribute("role", "img");
      }

      img.replaceWith(wrapper);
    } catch {
      // Leave as <img> on failure — browser may still render it
    }
  });
  await Promise.all(tasks);
}

async function renderPreview(source) {
  const hasMermaid = /```mermaid\b/.test(source);
  const preview = document.getElementById("preview-pane");

  let html;
  if (hasMermaid) {
    // Custom renderer to replace mermaid code blocks with placeholders
    const renderer = new marked.Renderer();
    const originalCode = renderer.code;
    renderer.code = function ({ text, lang }) {
      if (lang === "mermaid") {
        const id = `mermaid-${mermaidIdCounter++}`;
        return `<div class="mermaid-container" data-mermaid-id="${id}" data-mermaid-source="${encodeURIComponent(text)}"></div>`;
      }
      return originalCode.call(this, { text, lang });
    };
    html = marked.parse(source, { renderer });
  } else {
    html = marked.parse(source);
  }

  preview.innerHTML = `<div class="preview-page">${html}</div>`;

  if (hasMermaid) {
    // Render mermaid diagrams
    try {
      const mermaid = await getMermaid();
      const containers = document.querySelectorAll(".mermaid-container");
      for (const el of containers) {
        const src = decodeURIComponent(el.dataset.mermaidSource);
        const id = el.dataset.mermaidId;
        try {
          const { svg } = await mermaid.render(id, src);
          el.innerHTML = svg;
          el.classList.add("mermaid-rendered");
        } catch (err) {
          const pre = document.createElement("pre");
          pre.className = "mermaid-error";
          pre.textContent = err.message || String(err);
          el.replaceChildren(pre);
          // mermaid.render creates a temp element on error; clean up
          document.getElementById(id)?.remove();
        }
      }
    } catch (err) {
      // Mermaid failed to load — leave placeholders as-is
    }
  }

  // Annotate elements with source line numbers for scroll sync
  annotateSourceLines(preview, source);

  // Inline SVG images (runs after initial HTML is set)
  inlineSvgImages(preview).catch(() => {});
}

function updateStatus(state) {
  const lines = state.doc.lines;
  const chars = state.doc.length;
  const pathInfo = currentFilePath ? ` | ${currentFilePath}` : "";
  document.getElementById("status").textContent = `${lines} lines | ${chars} chars${pathInfo}`;
}

// Initial render
renderPreview(editor.state.doc.toString()).catch(() => {});
updateStatus(editor.state);

// --- Toolbar Actions ---

document.getElementById("btn-open").addEventListener("click", async () => {
  const path = await open({
    filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdx"] }],
  });
  if (path) {
    const content = await readTextFile(path);
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: content },
    });
    currentFilePath = path;
    svgCache.clear();
    renderPreview(content);
    updateStatus(editor.state);
  }
});

document.getElementById("btn-save").addEventListener("click", async () => {
  const content = editor.state.doc.toString();
  if (currentFilePath) {
    await writeTextFile(currentFilePath, content);
  } else {
    const path = await save({
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (path) {
      await writeTextFile(path, content);
      currentFilePath = path;
      updateStatus(editor.state);
    }
  }
});

// --- URL Bar (Fetch URL) ---

const urlBar = document.getElementById("url-bar");
const urlInput = document.getElementById("url-input");

async function fetchFromUrlBar() {
  const url = urlInput.value.trim();
  if (!url) return;

  const workerUrl = await ensureWorkerUrl();
  if (!workerUrl) return;

  const statusEl = document.getElementById("status");
  urlBar.classList.add("loading");
  urlInput.disabled = true;
  statusEl.textContent = "Rendering page (this may take a moment)…";

  try {
    const markdown = await invoke("fetch_rendered_url_as_markdown", { url, workerUrl });
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: markdown },
    });
    svgCache.clear();
    renderPreview(markdown);
    statusEl.textContent = "Fetched: " + url;
  } catch (e) {
    statusEl.textContent = `Render error: ${e}`;
  } finally {
    urlBar.classList.remove("loading");
    urlInput.disabled = false;
  }
}

document.getElementById("btn-fetch").addEventListener("click", fetchFromUrlBar);
urlInput.addEventListener("keydown", (e) => { if (e.key === "Enter") fetchFromUrlBar(); });

// --- Import Document ---

async function convertFile(filePath) {
  const workerUrl = await ensureWorkerUrl();
  if (!workerUrl) return;

  const isImage = await invoke("detect_file_is_image", { filePath });

  if (isImage) {
    const ok = await confirm(
      "Image conversion uses AI Neurons (costs apply). Continue?",
      { title: "Image Conversion Cost", kind: "warning" }
    );
    if (!ok) return;
  }

  const statusEl = document.getElementById("status");
  statusEl.textContent = "Converting…";

  try {
    const result = await invoke("convert_file_to_markdown", {
      filePath,
      workerUrl,
    });
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: result.markdown },
    });
    svgCache.clear();
    renderPreview(result.markdown);
    const tag = result.is_image ? " (image OCR)" : "";
    statusEl.textContent = `Converted${tag}: ${filePath.split("/").pop()}`;
  } catch (e) {
    statusEl.textContent = `Convert error: ${e}`;
  }
}

document.getElementById("btn-import").addEventListener("click", async () => {
  const path = await open({
    filters: [{
      name: "Documents",
      extensions: IMPORT_EXTENSIONS,
    }],
  });
  if (path) await convertFile(path);
});

// --- Drag & Drop ---

const appEl = document.getElementById("app");

appEl.addEventListener("dragover", (e) => {
  e.preventDefault();
  appEl.classList.add("drop-active");
});

appEl.addEventListener("dragleave", (e) => {
  if (!appEl.contains(e.relatedTarget)) {
    appEl.classList.remove("drop-active");
  }
});

appEl.addEventListener("drop", async (e) => {
  e.preventDefault();
  appEl.classList.remove("drop-active");

  const paths = e.dataTransfer?.files;
  if (!paths || paths.length === 0) return;

  // Tauri exposes dropped file paths via the event
  // For web drag-and-drop, we need to use Tauri's drag-drop event instead
  // Fall back to prompting the user to use the Import button
  document.getElementById("status").textContent =
    "Drop detected — use the Import button to select files (Tauri security restriction)";
});

// Tauri file drop event (works with native file drops)
if (window.__TAURI__?.event) {
  window.__TAURI__.event.listen("tauri://drag-drop", async (event) => {
    const paths = event.payload.paths;
    if (!paths || paths.length === 0) return;

    const filePath = paths[0];
    const ext = filePath.split(".").pop()?.toLowerCase() || "";

    if (IMPORT_EXTENSIONS.includes(ext)) {
      await convertFile(filePath);
    } else if (ext === "md" || ext === "markdown" || ext === "mdx") {
      const content = await readTextFile(filePath);
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: content },
      });
      currentFilePath = filePath;
      svgCache.clear();
      renderPreview(content);
      updateStatus(editor.state);
    } else {
      document.getElementById("status").textContent = `Unsupported file type: .${ext}`;
    }
  });
}

// --- Table Editor ---

document.getElementById("btn-table").addEventListener("click", () => {
  editTableAtCursor(editor);
});

// --- Export PDF ---

document.getElementById("btn-export-pdf").addEventListener("click", () => {
  window.print();
});

// --- Copy as Rich Text ---

async function copyRichText() {
  const preview = document.getElementById("preview-pane");
  const html = preview.innerHTML;
  const text = preview.innerText;
  const statusEl = document.getElementById("status");

  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
    statusEl.textContent = "Copied as rich text";
  } catch (e) {
    statusEl.textContent = `Copy failed: ${e}`;
  }
}

document.getElementById("btn-copy-rich").addEventListener("click", copyRichText);

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "C") {
    e.preventDefault();
    copyRichText();
  }
});

// --- Settings ---

document.getElementById("btn-settings").addEventListener("click", () => {
  showSettings({
    onSave: (url) => {
      const statusEl = document.getElementById("status");
      statusEl.textContent = url ? `Worker URL: ${url}` : "Worker URL cleared";
    },
  });
});

// --- Resizable divider ---

const divider = document.getElementById("divider");
const editorPane = document.getElementById("editor-pane");
const previewPane = document.getElementById("preview-pane");

let isDragging = false;

divider.addEventListener("mousedown", () => { isDragging = true; });
document.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  const container = document.getElementById("app");
  const rect = container.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;
  const clamped = Math.max(0.2, Math.min(0.8, ratio));
  editorPane.style.flex = `${clamped}`;
  previewPane.style.flex = `${1 - clamped}`;
});
document.addEventListener("mouseup", () => { isDragging = false; });

// --- MCP Bridge: State Sync & Event Listeners ---

let syncTimeout = null;
let lastSyncedContent = null;
let lastSyncedFilePath = null;

function syncEditorState() {
  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    const content = editor.state.doc.toString();
    if (content === lastSyncedContent && currentFilePath === lastSyncedFilePath) return;
    lastSyncedContent = content;
    lastSyncedFilePath = currentFilePath;
    const cursorPos = editor.state.selection.main.head;
    invoke("sync_editor_state", {
      content,
      filePath: currentFilePath,
      cursorPos: cursorPos,
      workerUrl: getWorkerUrl() || null,
    }).catch(() => {});
  }, 2000);
}

// Bridge event listeners
if (window.__TAURI__?.event) {
  const { listen } = window.__TAURI__.event;

  listen("bridge:set-content", (event) => {
    const content = event.payload;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: content },
    });
    svgCache.clear();
    renderPreview(content);
    updateStatus(editor.state);
  });

  listen("bridge:insert-text", (event) => {
    const { text, position } = event.payload;
    let pos;
    if (position === "start") {
      pos = 0;
    } else if (position === "end") {
      pos = editor.state.doc.length;
    } else {
      pos = editor.state.selection.main.head;
    }
    editor.dispatch({ changes: { from: pos, insert: text } });
    renderPreview(editor.state.doc.toString());
    updateStatus(editor.state);
  });

  listen("bridge:open-file", async (event) => {
    const path = event.payload;
    try {
      const content = await readTextFile(path);
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: content },
      });
      currentFilePath = path;
      svgCache.clear();
      renderPreview(content);
      updateStatus(editor.state);
      syncEditorState();
    } catch (e) {
      document.getElementById("status").textContent = `Open failed: ${e}`;
    }
  });

  listen("bridge:save-file", async (event) => {
    const path = event.payload || currentFilePath;
    if (!path) return;
    try {
      await writeTextFile(path, editor.state.doc.toString());
      if (!currentFilePath) {
        currentFilePath = path;
        updateStatus(editor.state);
      }
    } catch (e) {
      document.getElementById("status").textContent = `Save failed: ${e}`;
    }
  });

  listen("bridge:export-pdf", () => {
    window.print();
  });
}

// Initial sync
syncEditorState();

// --- Scroll Sync Event Listeners ---

const cmScroller = editor.dom.querySelector(".cm-scroller");
cmScroller.addEventListener("scroll", () => {
  cancelAnimationFrame(editorScrollRAF);
  editorScrollRAF = requestAnimationFrame(syncEditorToPreview);
}, { passive: true });

document.getElementById("preview-pane").addEventListener("scroll", () => {
  cancelAnimationFrame(previewScrollRAF);
  previewScrollRAF = requestAnimationFrame(syncPreviewToEditor);
}, { passive: true });

// First-run: show settings if Worker not configured
checkFirstRun();
