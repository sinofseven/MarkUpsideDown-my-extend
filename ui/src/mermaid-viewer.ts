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
}

function copyAsPng(svgEl: SVGElement, btn: HTMLButtonElement) {
  const svgData = new XMLSerializer().serializeToString(svgEl);
  const img = new Image();
  img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));
  img.onload = () => {
    const s = 2;
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth * s;
    canvas.height = img.naturalHeight * s;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(s, s);
    ctx.drawImage(img, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).then(() => {
        btn.textContent = "Copied!";
        setTimeout(() => {
          btn.textContent = "Copy as PNG";
        }, 1500);
      });
    });
  };
}

export function open(mermaidContainer: HTMLElement) {
  if (overlay) close();

  const svg = mermaidContainer.querySelector("svg");
  if (!svg) return;

  scale = 1;
  translateX = 0;
  translateY = 0;

  overlay = document.createElement("div");
  overlay.className = "mermaid-viewer-overlay";

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

  const zoomIn = btn("+", () => zoom(ZOOM_STEP * scale));
  const zoomOut = btn("−", () => zoom(-ZOOM_STEP * scale));
  const zoomLabel = document.createElement("span");
  zoomLabel.className = "mermaid-viewer-zoom-label";
  zoomLabel.textContent = "100%";
  const resetBtn = btn("Reset", resetView);
  resetBtn.classList.add("mermaid-viewer-text-btn");

  const copyBtn = document.createElement("button");
  copyBtn.className = "mermaid-viewer-btn mermaid-viewer-text-btn";
  copyBtn.textContent = "Copy as PNG";
  const viewerSvg = svgWrapper.querySelector("svg");
  if (viewerSvg) {
    copyBtn.addEventListener("click", () => copyAsPng(viewerSvg, copyBtn));
  }

  const closeBtn = btn("✕", close);

  toolbar.append(zoomOut, zoomLabel, zoomIn, resetBtn, copyBtn, closeBtn);
  overlay.appendChild(toolbar);

  document.body.appendChild(overlay);
  document.addEventListener("keydown", handleKeyDown);
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
