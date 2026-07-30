import { useMemo, useState } from "react";
import blockGuideRaw from "../../content/BLOCK_GUIDE.md?raw";
import { parseInline, parseMarkdown, type MdBlock } from "../../utils/markdown";
import { useEscapeToClose } from "../../hooks/useEscapeToClose";
import "./DocumentationPanel.css";

function Inline({ text }: { text: string }) {
  const spans = parseInline(text);
  return (
    <>
      {spans.map((s, i) =>
        s.bold ? (
          <strong key={i}>{s.text}</strong>
        ) : s.code ? (
          <code key={i}>{s.text}</code>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

function BlockView({ block }: { block: MdBlock }) {
  switch (block.kind) {
    case "heading": {
      const Tag = (`h${block.level}` as unknown) as "h1" | "h2" | "h3";
      return (
        <Tag id={block.id} className={`docs-panel__h docs-panel__h${block.level}`}>
          <Inline text={block.text} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p className="docs-panel__p">
          <Inline text={block.text} />
        </p>
      );
    case "list":
      return (
        <ul className="docs-panel__list">
          {block.items.map((item, i) => (
            <li key={i}>
              <Inline text={item} />
            </li>
          ))}
        </ul>
      );
    case "code":
      return (
        <pre className="docs-panel__code">
          <code>{block.text}</code>
        </pre>
      );
    case "table":
      return (
        <div className="docs-panel__table-wrap">
          <table className="docs-panel__table">
            <thead>
              <tr>
                {block.header.map((h, i) => (
                  <th key={i}>
                    <Inline text={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci}>
                      <Inline text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "hr":
      return <hr className="docs-panel__hr" />;
  }
}

export interface DocumentationPanelProps {
  open: boolean;
  onClose: () => void;
}

/** Renders src/content/BLOCK_GUIDE.md -- the single canonical source for
 * both this in-app panel and anything read outside the app -- as an
 * in-app reference with a jump-to-section table of contents. */
export function DocumentationPanel({ open, onClose }: DocumentationPanelProps) {
  useEscapeToClose(open, onClose);
  const blocks = useMemo(() => parseMarkdown(blockGuideRaw), []);
  const toc = useMemo(
    () => blocks.filter((b): b is Extract<MdBlock, { kind: "heading" }> => b.kind === "heading" && b.level === 2),
    [blocks],
  );
  const [query, setQuery] = useState("");

  if (!open) return null;

  const filtered = query.trim()
    ? blocks.filter((b) => {
        if (b.kind === "heading") return true; // keep section structure visible while filtering
        const text = "text" in b ? b.text : "items" in b ? b.items.join(" ") : "";
        return text.toLowerCase().includes(query.trim().toLowerCase());
      })
    : blocks;

  return (
    <div className="docs-panel__overlay" role="dialog" aria-label="Documentation">
      <div className="docs-panel">
        <div className="docs-panel__header">
          <div className="docs-panel__title">Documentation</div>
          <input
            className="docs-panel__search"
            placeholder="Search the guide…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search documentation"
          />
          <button className="docs-panel__close" onClick={onClose} aria-label="Close documentation">
            ✕
          </button>
        </div>
        <div className="docs-panel__body">
          <nav className="docs-panel__toc" aria-label="Table of contents">
            {toc.map((h) => (
              <a key={h.id} href={`#${h.id}`} className="docs-panel__toc-link">
                {h.text}
              </a>
            ))}
          </nav>
          <div className="docs-panel__content">
            {filtered.map((b, i) => (
              <BlockView key={i} block={b} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
