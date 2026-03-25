import { copySvgAsPng } from "./html-utils.ts";

let overlay: HTMLDivElement | null = null;
let scale = 1;
let translateX = 0;
let translateY = 0;
let dragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartTX = 0;
let dragStartTY = 0;

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;
const ZOOM_STEP = 0.15;
const FIT_PADDING = 40;

function applyTransform(container: HTMLElement) {
  container.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
}

function resetView() {
  scale = 1;
  translateX = 0;
  translateY = 0;
  const container = overlay?.querySelector<HTMLElement>(".mermaid-viewer-svg");
  if (container) applyTransform(container);
  updateZoomLabel();
}

function fitToView() {
  const viewport = overlay?.querySelector<HTMLElement>(".mermaid-viewer-viewport");
  const svgEl = overlay?.querySelector<SVGElement>(".mermaid-viewer-svg svg");
  if (!viewport || !svgEl) return;

  const vw = viewport.clientWidth - FIT_PADDING * 2;
  const vh = viewport.clientHeight - FIT_PADDING * 2;
  const sw = svgEl.clientWidth || svgEl.getBoundingClientRect().width;
  const sh = svgEl.clientHeight || svgEl.getBoundingClientRect().height;
  if (sw === 0 || sh === 0) return;

  scale = Math.min(1, vw / sw, vh / sh);
  // Center the SVG in the viewport
  translateX = (viewport.clientWidth - sw * scale) / 2;
  translateY = (viewport.clientHeight - sh * scale) / 2;

  const container = overlay?.querySelector<HTMLElement>(".mermaid-viewer-svg");
  if (container) applyTransform(container);
  updateZoomLabel();
}

function zoom(delta: number, cx?: number, cy?: number) {
  const prev = scale;
  scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale + delta));
  if (cx !== undefined && cy !== undefined) {
    const ratio = scale / prev;
    translateX = cx - ratio * (cx - translateX);
    translateY = cy - ratio * (cy - translateY);
  }
  const container = overlay?.querySelector<HTMLElement>(".mermaid-viewer-svg");
  if (container) applyTransform(container);
  updateZoomLabel();
}

function updateZoomLabel() {
  const label = overlay?.querySelector<HTMLElement>(".mermaid-viewer-zoom-label");
  if (label) label.textContent = `${Math.round(scale * 100)}%`;
}

function handleWheel(e: WheelEvent) {
  e.preventDefault();
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;
  const delta = e.deltaY < 0 ? ZOOM_STEP * scale : -ZOOM_STEP * scale;
  zoom(delta, cx, cy);
}

function handlePointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  dragging = true;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragStartTX = translateX;
  dragStartTY = translateY;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  (e.currentTarget as HTMLElement).style.cursor = "grabbing";
}

function handlePointerMove(e: PointerEvent) {
  if (!dragging) return;
  translateX = dragStartTX + (e.clientX - dragStartX);
  translateY = dragStartTY + (e.clientY - dragStartY);
  const container = overlay?.querySelector<HTMLElement>(".mermaid-viewer-svg");
  if (container) applyTransform(container);
}

function handlePointerUp(e: PointerEvent) {
  if (!dragging) return;
  dragging = false;
  (e.currentTarget as HTMLElement).style.cursor = "grab";
  (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === "Escape") close();
  if (e.key === "=" || e.key === "+") zoom(ZOOM_STEP * scale);
  if (e.key === "-") zoom(-ZOOM_STEP * scale);
  if (e.key === "0") resetView();
  if (e.key === "f") fitToView();
}

function copyAsPng(svgEl: SVGElement, btn: HTMLButtonElement) {
  copySvgAsPng(svgEl, btn);
}

export function open(mermaidContainer: HTMLElement) {
  if (overlay) close();

  const svg = mermaidContainer.querySelector("svg");
  if (!svg) return;

  overlay = document.createElement("div");
  overlay.className = "mermaid-viewer-overlay";

  // Close on background click
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  // Viewport area
  const viewport = document.createElement("div");
  viewport.className = "mermaid-viewer-viewport";
  viewport.addEventListener("wheel", handleWheel, { passive: false });
  viewport.addEventListener("pointerdown", handlePointerDown);
  viewport.addEventListener("pointermove", handlePointerMove);
  viewport.addEventListener("pointerup", handlePointerUp);
  viewport.addEventListener("pointercancel", handlePointerUp);

  const svgWrapper = document.createElement("div");
  svgWrapper.className = "mermaid-viewer-svg";
  svgWrapper.innerHTML = svg.outerHTML;
  viewport.appendChild(svgWrapper);
  overlay.appendChild(viewport);

  // Toolbar
  const toolbar = document.createElement("div");
  toolbar.className = "mermaid-viewer-toolbar";

  const closeBtn = btn("Close", close);
  closeBtn.classList.add("mermaid-viewer-text-btn", "mermaid-viewer-close-btn");

  const zoomIn = btn("+", () => zoom(ZOOM_STEP * scale));
  const zoomOut = btn("\u2212", () => zoom(-ZOOM_STEP * scale));
  const zoomLabel = document.createElement("span");
  zoomLabel.className = "mermaid-viewer-zoom-label";
  zoomLabel.textContent = "100%";
  const fitBtn = btn("Fit", fitToView);
  fitBtn.classList.add("mermaid-viewer-text-btn");

  const copyBtn = document.createElement("button");
  copyBtn.className = "mermaid-viewer-btn mermaid-viewer-text-btn";
  copyBtn.textContent = "Copy as PNG";
  const viewerSvg = svgWrapper.querySelector("svg");
  if (viewerSvg) {
    copyBtn.addEventListener("click", () => copyAsPng(viewerSvg, copyBtn));
  }

  const hint = document.createElement("span");
  hint.className = "mermaid-viewer-hint";
  hint.textContent = "Esc to close";

  toolbar.append(closeBtn, zoomOut, zoomLabel, zoomIn, fitBtn, copyBtn, hint);
  overlay.appendChild(toolbar);

  document.body.appendChild(overlay);
  document.addEventListener("keydown", handleKeyDown);

  // Fit to view after DOM is ready
  requestAnimationFrame(() => fitToView());
}

function btn(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "mermaid-viewer-btn";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

export function close() {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
  document.removeEventListener("keydown", handleKeyDown);
}
