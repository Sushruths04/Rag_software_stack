/**
 * Minimal, dependency-free markdown -> block list parser for the in-app
 * Documentation panel. Deliberately supports only what BLOCK_GUIDE.md
 * (src/content/BLOCK_GUIDE.md) actually uses -- headers, paragraphs,
 * unordered lists, fenced code blocks, pipe tables, horizontal rules, and
 * inline **bold** / `code` -- rather than pulling in a general markdown
 * dependency for one document.
 */

export type MdBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string; id: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "code"; text: string }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "hr" };

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

export function parseMarkdown(source: string): MdBlock[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    if (/^-{3,}\s*$/.test(line.trim())) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3;
      const text = heading[2].trim();
      blocks.push({ kind: "heading", level, text, id: slugify(text) });
      i++;
      continue;
    }

    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push({ kind: "code", text: codeLines.join("\n") });
      continue;
    }

    if (line.trim().startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }
      const cellsOf = (row: string) =>
        row
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
      const header = cellsOf(tableLines[0]);
      const rows = tableLines.slice(2).map(cellsOf); // skip header + separator row
      blocks.push({ kind: "table", header, rows });
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        let item = lines[i].replace(/^[-*]\s+/, "");
        i++;
        // fold indented continuation lines into the same list item
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) {
          item += " " + lines[i].trim();
          i++;
        }
        items.push(item);
      }
      blocks.push({ kind: "list", items });
      continue;
    }

    // paragraph: fold subsequent non-blank, non-special lines in
    const paraLines = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith("|") &&
      !/^[-*]\s+/.test(lines[i]) &&
      !lines[i].startsWith("```") &&
      !/^-{3,}\s*$/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ kind: "paragraph", text: paraLines.join(" ") });
  }

  return blocks;
}

/** Split inline **bold** / `code` spans out of a text run for rendering. */
export type InlineSpan = { text: string; bold?: boolean; code?: boolean };

export function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > lastIndex) spans.push({ text: text.slice(lastIndex, match.index) });
    const token = match[0];
    if (token.startsWith("**")) spans.push({ text: token.slice(2, -2), bold: true });
    else spans.push({ text: token.slice(1, -1), code: true });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) spans.push({ text: text.slice(lastIndex) });
  return spans;
}
