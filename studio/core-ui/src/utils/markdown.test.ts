import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, slugify } from "./markdown";

describe("slugify", () => {
  it("lowercases, strips punctuation, and hyphenates", () => {
    expect(slugify("Sources & Imports")).toBe("sources-imports");
    expect(slugify("Chunker `chunker`")).toBe("chunker-chunker");
  });
});

describe("parseMarkdown", () => {
  it("parses headings at three levels with slugged ids", () => {
    const blocks = parseMarkdown("# Title\n## Section\n### Sub");
    expect(blocks).toEqual([
      { kind: "heading", level: 1, text: "Title", id: "title" },
      { kind: "heading", level: 2, text: "Section", id: "section" },
      { kind: "heading", level: 3, text: "Sub", id: "sub" },
    ]);
  });

  it("folds a multi-line paragraph into one block", () => {
    const blocks = parseMarkdown("This is line one\nand line two continues it.\n\nNew paragraph.");
    expect(blocks).toEqual([
      { kind: "paragraph", text: "This is line one and line two continues it." },
      { kind: "paragraph", text: "New paragraph." },
    ]);
  });

  it("parses an unordered list, folding indented continuation lines", () => {
    const blocks = parseMarkdown("- First item\n- Second item\n  continues here\n- Third");
    expect(blocks).toEqual([
      {
        kind: "list",
        items: ["First item", "Second item continues here", "Third"],
      },
    ]);
  });

  it("parses a fenced code block verbatim", () => {
    const blocks = parseMarkdown("```\nline one\nline two\n```");
    expect(blocks).toEqual([{ kind: "code", text: "line one\nline two" }]);
  });

  it("parses a pipe table, skipping the separator row", () => {
    const blocks = parseMarkdown("| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |");
    expect(blocks).toEqual([
      { kind: "table", header: ["a", "b"], rows: [["1", "2"], ["3", "4"]] },
    ]);
  });

  it("parses a horizontal rule", () => {
    expect(parseMarkdown("---")).toEqual([{ kind: "hr" }]);
  });

  it("round-trips the real BLOCK_GUIDE.md without throwing and finds every top block section", async () => {
    const raw = (await import("../content/BLOCK_GUIDE.md?raw")).default as string;
    const blocks = parseMarkdown(raw);
    const headings = blocks.filter((b) => b.kind === "heading") as Extract<
      ReturnType<typeof parseMarkdown>[number],
      { kind: "heading" }
    >[];
    const h2Texts = headings.filter((h) => h.level === 2).map((h) => h.text);
    expect(h2Texts).toEqual(
      expect.arrayContaining([
        "1. Getting started — concepts you need before your first block",
        "2. Sources & Imports",
        "5. Generation (all PAID except Demotion)",
        "6. Gates (all FREE — deterministic checks on local hardware)",
        "10. Sample pipelines to try",
      ]),
    );
    expect(blocks.some((b) => b.kind === "table")).toBe(true);
    expect(blocks.some((b) => b.kind === "list")).toBe(true);
    expect(blocks.some((b) => b.kind === "code")).toBe(true);
  });
});

describe("parseInline", () => {
  it("splits bold and code spans out of plain text", () => {
    expect(parseInline("plain **bold** and `code` text")).toEqual([
      { text: "plain " },
      { text: "bold", bold: true },
      { text: " and " },
      { text: "code", code: true },
      { text: " text" },
    ]);
  });

  it("returns a single plain span when there is no markup", () => {
    expect(parseInline("just text")).toEqual([{ text: "just text" }]);
  });
});
