import { useEffect, useRef, useState } from "react";
import { CATEGORIES, BLOCK_CATALOG } from "../../data/catalog";
import type { BlockSpec } from "../../types/graph";
import "./Palette.css";

// 1x1 transparent gif — hides the browser's native drag preview so our own
// custom ghost element (04 §9 A1) is the only thing the user sees.
const EMPTY_DRAG_IMAGE = new Image();
EMPTY_DRAG_IMAGE.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7";

interface PaletteProps {
  onBlockDoubleClick?: (spec: BlockSpec) => void;
  /** Block list to render — defaults to the bundled static catalog. Passed
   * explicitly by StudioShell once the live registry (`GET /api/blocks`)
   * has loaded, so the palette always reflects whichever source is live. */
  blocks?: BlockSpec[];
}

/**
 * Left rail — blocks grouped by category (05 §3 headings, tinted per 04
 * §8.5), search, and drag-to-canvas (04 §9 A1: ghost node at 85% scale/60%
 * opacity follows the cursor; the palette item itself dims while dragging).
 */
export function Palette({ onBlockDoubleClick, blocks = BLOCK_CATALOG }: PaletteProps) {
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState<BlockSpec | null>(null);
  const [ghostPos, setGhostPos] = useState({ x: 0, y: 0 });
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    function onDragOver(e: DragEvent) {
      setGhostPos({ x: e.clientX, y: e.clientY });
    }
    window.addEventListener("dragover", onDragOver);
    return () => window.removeEventListener("dragover", onDragOver);
  }, [dragging]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? blocks.filter(
        (b) => b.label.toLowerCase().includes(q) || b.purpose.toLowerCase().includes(q) || b.type.includes(q),
      )
    : blocks;

  return (
    <aside className="palette" aria-label="Block palette">
      <div className="palette__search">
        <input
          ref={searchRef}
          type="search"
          placeholder="Search blocks · Ctrl+K"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search blocks"
        />
      </div>

      <div className="palette__scroll">
        {CATEGORIES.map((cat) => {
          const blocks = filtered.filter((b) => b.category === cat.id);
          if (blocks.length === 0) return null;
          return (
            <section className="palette__group" key={cat.id}>
              <h3 className="palette__group-title" style={{ ["--cat-tint" as string]: `var(${cat.tintVar})` }}>
                <span className="palette__group-dot" />
                {cat.label}
              </h3>
              <ul className="palette__items">
                {blocks.map((b) => (
                  <li key={b.type}>
                    <div
                      className={`palette-item${dragging?.type === b.type ? " is-dragging" : ""}`}
                      draggable
                      role="button"
                      tabIndex={0}
                      title={b.purpose}
                      onDoubleClick={() => onBlockDoubleClick?.(b)}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("application/x-graft-block", b.type);
                        e.dataTransfer.effectAllowed = "copy";
                        e.dataTransfer.setDragImage(EMPTY_DRAG_IMAGE, 0, 0);
                        setDragging(b);
                      }}
                      onDragEnd={() => setDragging(null)}
                    >
                      <span className="palette-item__icon" style={{ ["--cat-tint" as string]: `var(${cat.tintVar})` }}>
                        {b.label.slice(0, 1)}
                      </span>
                      <span className="palette-item__label">
                        {b.label}
                        {b.cost === "paid" && <span className="palette-item__paid">$</span>}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {filtered.length === 0 && <p className="palette__empty">No blocks match "{query}".</p>}
      </div>

      {dragging && (
        <div
          className="palette-ghost"
          style={{
            transform: `translate(${ghostPos.x}px, ${ghostPos.y}px) translate(-50%, -50%) scale(0.85)`,
            ["--cat-tint" as string]: `var(${categoryTint(dragging)})`,
          }}
        >
          {dragging.label}
        </div>
      )}
    </aside>
  );
}

function categoryTint(spec: BlockSpec): string {
  const cat = CATEGORIES.find((c) => c.id === spec.category);
  return cat?.tintVar ?? "--acc";
}
