import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

const bg = "#1a1a2a";
const surface = "#24243a";
const border = "#35354a";
const text = "#e0ddd5";
const textMuted = "#7a7a8e";
const accent = "#7aacf0";
const green = "#a6e3a1";
const red = "#f38ba8";
const yellow = "#f9e2af";
const mauve = "#cba6f7";

const theme = EditorView.theme(
  {
    "&": {
      color: text,
      backgroundColor: bg,
    },
    ".cm-content": {
      caretColor: accent,
      fontFamily: '"SF Mono", "Fira Code", "JetBrains Mono", monospace',
      padding: "16px 0",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: accent,
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      {
        backgroundColor: "#35355a",
      },
    ".cm-activeLine": {
      backgroundColor: "rgba(255, 255, 255, 0.03)",
    },
    ".cm-gutters": {
      backgroundColor: bg,
      color: "#4a4a5e",
      border: "none",
      paddingRight: "8px",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "rgba(255, 255, 255, 0.03)",
      color: textMuted,
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 8px",
      fontSize: "12px",
    },
    ".cm-panels": {
      backgroundColor: surface,
      color: text,
      borderBottom: `1px solid ${border}`,
    },
    ".cm-panels.cm-panels-top": {
      borderBottom: `1px solid ${border}`,
    },
    ".cm-search": {
      padding: "8px 12px",
      gap: "6px",
    },
    ".cm-search label": {
      color: textMuted,
      fontSize: "12px",
    },
    ".cm-search input, .cm-search select": {
      backgroundColor: bg,
      color: text,
      border: `1px solid ${border}`,
      borderRadius: "4px",
      padding: "2px 6px",
      outline: "none",
    },
    ".cm-search input:focus": {
      borderColor: accent,
    },
    ".cm-search button": {
      backgroundColor: border,
      color: text,
      border: "none",
      borderRadius: "4px",
      padding: "2px 10px",
      cursor: "pointer",
    },
    ".cm-search button:hover": {
      backgroundColor: "#4a4a5a",
    },
    ".cm-searchMatch": {
      backgroundColor: "#89b4fa33",
      outline: `1px solid #89b4fa55`,
    },
    ".cm-searchMatch-selected": {
      backgroundColor: "#89b4fa66",
    },
  },
  { dark: true }
);

const highlighting = HighlightStyle.define([
  { tag: tags.heading, color: accent, fontWeight: "bold" },
  { tag: tags.heading1, fontSize: "1.4em" },
  { tag: tags.heading2, fontSize: "1.2em" },
  { tag: tags.emphasis, fontStyle: "italic", color: yellow },
  { tag: tags.strong, fontWeight: "bold", color: yellow },
  { tag: tags.link, color: accent, textDecoration: "underline" },
  { tag: tags.url, color: accent },
  { tag: tags.monospace, color: green },
  { tag: tags.quote, color: textMuted, fontStyle: "italic" },
  { tag: tags.keyword, color: mauve },
  { tag: tags.string, color: green },
  { tag: tags.number, color: yellow },
  { tag: tags.comment, color: textMuted },
  { tag: tags.meta, color: red },
  { tag: tags.processingInstruction, color: textMuted },
]);

export const oneDark = [theme, syntaxHighlighting(highlighting)];
