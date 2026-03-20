// Context menu for external links in the preview pane.
// Offers: Open in Browser, Fetch as Markdown, Render as Markdown, Crawl Site.

import { getWorkerUrl } from "./settings.ts";

const { invoke } = window.__TAURI__.core;

let menu: HTMLElement | null = null;

interface LinkMenuDeps {
  statusEl: HTMLElement;
  loadContentAsTab: (content: string) => void;
  normalizeMarkdown: (s: string) => string;
  crawlUrl: (urlInput: HTMLInputElement, urlBar: HTMLElement) => void;
  urlInput: HTMLInputElement;
  urlBar: HTMLElement;
}

let deps: LinkMenuDeps;

export function initLinkContextMenu(previewPane: HTMLElement, d: LinkMenuDeps) {
  deps = d;

  previewPane.addEventListener("contextmenu", (e) => {
    const anchor = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
    if (!anchor) return;
    const href = anchor.getAttribute("href") ?? "";
    if (!/^https?:\/\//.test(href)) return;

    e.preventDefault();
    showMenu(e.clientX, e.clientY, href);
  });

  document.addEventListener("click", dismiss);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") dismiss();
  });
}

function dismiss() {
  if (menu) {
    menu.remove();
    menu = null;
  }
}

function showMenu(x: number, y: number, url: string) {
  dismiss();

  const workerUrl = getWorkerUrl();

  menu = document.createElement("div");
  menu.className = "link-context-menu";

  const items: { label: string; disabled?: boolean; action: () => void }[] = [
    {
      label: "Open in Browser",
      action: () => invoke("plugin:shell|open", { path: url }),
    },
    {
      label: "Fetch as Markdown",
      action: () => fetchAsMarkdown(url),
    },
    {
      label: "Render as Markdown",
      disabled: !workerUrl,
      action: () => renderAsMarkdown(url, workerUrl),
    },
    {
      label: "Crawl Site",
      disabled: !workerUrl,
      action: () => {
        deps.urlInput.value = url;
        deps.crawlUrl(deps.urlInput, deps.urlBar);
      },
    },
  ];

  for (const item of items) {
    const btn = document.createElement("button");
    btn.className = "link-context-item";
    btn.textContent = item.label;
    if (item.disabled) {
      btn.disabled = true;
      btn.title = "Configure Worker URL in Settings";
    }
    btn.addEventListener("click", () => {
      dismiss();
      item.action();
    });
    menu.appendChild(btn);
  }

  // Position, keeping within viewport
  menu.style.left = `${Math.min(x, window.innerWidth - 200)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 160)}px`;
  document.body.appendChild(menu);
}

async function fetchAsMarkdown(url: string) {
  deps.statusEl.textContent = "Fetching page…";
  try {
    const result = await invoke<{ body: string; is_markdown: boolean }>("fetch_url_as_markdown", {
      url,
    });
    if (result.is_markdown) {
      deps.loadContentAsTab(deps.normalizeMarkdown(result.body));
      deps.statusEl.textContent = `Fetched (Markdown for Agents): ${url}`;
      return;
    }
    // Try Worker conversion
    const workerUrl = getWorkerUrl();
    if (workerUrl) {
      try {
        const markdown = await invoke<string>("fetch_url_via_worker", { url, workerUrl });
        deps.loadContentAsTab(deps.normalizeMarkdown(markdown));
        deps.statusEl.textContent = `Fetched (AI.toMarkdown): ${url}`;
        return;
      } catch {
        // Fall through
      }
    }
    deps.loadContentAsTab(result.body);
    deps.statusEl.textContent = `Fetched (raw HTML): ${url}`;
  } catch (e) {
    deps.statusEl.textContent = `Fetch error: ${e}`;
  }
}

async function renderAsMarkdown(url: string, workerUrl: string) {
  deps.statusEl.textContent = "Rendering page…";
  try {
    const markdown = await invoke<string>("fetch_rendered_url_as_markdown", { url, workerUrl });
    deps.loadContentAsTab(deps.normalizeMarkdown(markdown));
    deps.statusEl.textContent = `Rendered: ${url}`;
  } catch (e) {
    deps.statusEl.textContent = `Render error: ${e}`;
  }
}
