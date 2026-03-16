import { defineConfig } from "vite-plus";
import type { Plugin } from "vite-plus";

const host = process.env.TAURI_DEV_HOST;

// Strip woff/ttf font references from KaTeX CSS (woff2 is sufficient for WebKit)
function katexWoff2Only(): Plugin {
  return {
    name: "katex-woff2-only",
    enforce: "pre",
    transform(code, id) {
      if (id.includes("katex") && /\.css($|\?)/.test(id)) {
        return code
          .replace(/,url\([^)]+\.woff\) format\("woff"\)/g, "")
          .replace(/,url\([^)]+\.ttf\) format\("truetype"\)/g, "");
      }
    },
  };
}

export default defineConfig({
  clearScreen: false,
  plugins: [katexWoff2Only()],
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 5174 } : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
