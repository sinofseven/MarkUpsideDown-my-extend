// Shared CJK emphasis spacing logic.
// CommonMark delimiter-flanking rules treat CJK characters as "letters",
// causing emphasis markers adjacent to CJK text to fail parsing.
// Reference: https://zenn.dev/miyabitti/articles/594fdb7373a3a8
//
// normalize.ts uses half-width space (portable Markdown for all parsers).
// preview-render.ts uses hair space U+200A (invisible, passes flanking rules).

export const CJK_RE = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}]/u;

function spaceCjkEmphasis(line: string, re: RegExp, marker: string, space: string): string {
  return line.replace(re, (m, content, offset, str) => {
    const before = offset > 0 ? str[offset - 1] : "";
    const afterPos = offset + m.length;
    const after = afterPos < str.length ? str[afterPos] : "";
    const pre = before && CJK_RE.test(before) ? space : "";
    const post = after && CJK_RE.test(after) ? space : "";
    return `${pre}${marker}${content}${marker}${post}`;
  });
}

export function fixCjkEmphasisWith(text: string, space: string): string {
  let inFence = false;
  return text
    .split("\n")
    .map((line) => {
      if (/^(`{3,}|~{3,})/.test(line.trimStart())) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;

      // Strip inner spaces: "** text **" → "**text**"
      line = line.replace(/\*\*\s+((?:[^*]|\*(?!\*))+?)\s+\*\*/g, "**$1**");
      line = line.replace(/__\s+((?:[^_]|_(?!_))+?)\s+__/g, "__$1__");

      // Insert spaces at CJK boundaries (longer markers first to avoid conflicts)
      line = spaceCjkEmphasis(line, /\*\*((?:[^*]|\*(?!\*))+?)\*\*/g, "**", space);
      line = spaceCjkEmphasis(line, /(?<!\*)\*((?:[^*\n])+?)\*(?!\*)/g, "*", space);
      line = spaceCjkEmphasis(line, /__((?:[^_]|_(?!_))+?)__/g, "__", space);
      line = spaceCjkEmphasis(line, /(?<!_)_((?:[^_\n])+?)_(?!_)/g, "_", space);

      return line;
    })
    .join("\n");
}
