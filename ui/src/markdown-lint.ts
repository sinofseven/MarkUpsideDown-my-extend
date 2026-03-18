import { linter, type Diagnostic } from "@codemirror/lint";

/**
 * CodeMirror 6 lint extension for Markdown structural issues.
 * Checks heading hierarchy, broken links, table structure, etc.
 */
export const markdownLinter = linter(
  (view) => {
    const doc = view.state.doc;
    const diagnostics: Diagnostic[] = [];

    const lines: string[] = [];
    for (let i = 1; i <= doc.lines; i++) {
      lines.push(doc.line(i).text);
    }

    checkHeadings(lines, doc, diagnostics);
    checkLinks(lines, doc, diagnostics);
    checkTables(lines, doc, diagnostics);

    return diagnostics;
  },
  { delay: 500 },
);

// --- Heading checks ---

function checkHeadings(
  lines: string[],
  doc: { line: (n: number) => { from: number; to: number } },
  diagnostics: Diagnostic[],
) {
  const headings: { lineNum: number; level: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s/);
    if (match) {
      headings.push({ lineNum: i + 1, level: match[1].length });
    }
  }

  if (headings.length === 0) return;

  // Multiple h1
  const h1s = headings.filter((h) => h.level === 1);
  if (h1s.length > 1) {
    for (let i = 1; i < h1s.length; i++) {
      const line = doc.line(h1s[i].lineNum);
      diagnostics.push({
        from: line.from,
        to: line.to,
        severity: "warning",
        message: "Multiple h1 headings — consider using a single h1 per document",
      });
    }
  }

  // Heading level skip
  for (let i = 1; i < headings.length; i++) {
    const prev = headings[i - 1].level;
    const curr = headings[i].level;
    if (curr > prev + 1) {
      const line = doc.line(headings[i].lineNum);
      diagnostics.push({
        from: line.from,
        to: line.to,
        severity: "warning",
        message: `Heading level skip: h${prev} → h${curr} (missing h${prev + 1})`,
      });
    }
  }
}

// --- Link checks ---

function checkLinks(
  lines: string[],
  doc: { line: (n: number) => { from: number; to: number; text: string } },
  diagnostics: Diagnostic[],
) {
  // Collect heading anchors for internal link validation
  const anchors = new Set<string>();
  for (const line of lines) {
    const match = line.match(/^#{1,6}\s+(.*)/);
    if (match) {
      // Generate GitHub-style anchor
      const anchor = match[1]
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-");
      anchors.add(anchor);
    }
  }

  const linkPattern = /\[([^\]]*)\]\(([^)]*)\)/g;

  for (let i = 0; i < lines.length; i++) {
    // Skip code blocks
    if (lines[i].startsWith("```")) {
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) i++;
      continue;
    }

    let match;
    linkPattern.lastIndex = 0;
    while ((match = linkPattern.exec(lines[i])) !== null) {
      const target = match[2].trim();
      const lineObj = doc.line(i + 1);
      const from = lineObj.from + match.index;
      const to = from + match[0].length;

      // Empty link
      if (target === "" || target === "#") {
        diagnostics.push({ from, to, severity: "warning", message: "Empty link target" });
        continue;
      }

      // Broken internal anchor
      if (target.startsWith("#") && target.length > 1) {
        const anchor = target.slice(1);
        if (!anchors.has(anchor)) {
          diagnostics.push({
            from,
            to,
            severity: "info",
            message: `Internal anchor "${target}" does not match any heading`,
          });
        }
      }
    }
  }
}

// --- Table checks ---

function checkTables(
  lines: string[],
  doc: { line: (n: number) => { from: number; to: number } },
  diagnostics: Diagnostic[],
) {
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim().startsWith("|")) {
      i++;
      continue;
    }

    // Collect table block
    const start = i;
    while (i < lines.length && lines[i].trim().startsWith("|")) i++;
    const tableLines = lines.slice(start, i);

    if (tableLines.length < 2) continue;

    const colCounts = tableLines.map(
      (line) => line.replace(/^\|/, "").replace(/\|$/, "").split("|").length,
    );

    const headerCols = colCounts[0];

    // Check separator row
    const sepLine = tableLines[1];
    const isSep = sepLine
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .every((cell) => /^\s*:?-+:?\s*$/.test(cell));

    if (!isSep) {
      const line = doc.line(start + 2);
      diagnostics.push({
        from: line.from,
        to: line.to,
        severity: "warning",
        message: "Table missing separator row (expected | --- | --- | ...)",
      });
    }

    // Column count mismatch
    for (let j = 0; j < colCounts.length; j++) {
      if (colCounts[j] !== headerCols) {
        const line = doc.line(start + j + 1);
        diagnostics.push({
          from: line.from,
          to: line.to,
          severity: "warning",
          message: `Table column count mismatch: expected ${headerCols}, got ${colCounts[j]}`,
        });
      }
    }
  }
}
