import type { PaidBlockEstimate } from "../../api/client";
import type { BlockSpec } from "../../types/graph";
import "./CostConfirmSheet.css";

export interface CostConfirmSheetProps {
  open: boolean;
  /** One entry per PAID block reachable in the current graph, from the
   * backend's 402 {@code estimated} field (POST /api/graphs/run). */
  paidBlocks: PaidBlockEstimate[];
  /** Live-merged block registry, used to show a human label instead of the
   * raw block type id — falls back to the type id itself if unknown. */
  blockByType: Record<string, BlockSpec>;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Spend-confirmation sheet — 04_DESIGN_SYSTEM.md flow F4 ("Paid run flow"):
 * "Run → cost sheet (A14) lists `Cluster QA Generator ~510 calls · Neighbor
 * QA ~330 calls · est total <$2` → user confirms → per-block statuses
 * stream", and 05_BLOCK_CATALOG.md §2: "The runner requires an explicit
 * user confirm before executing any PAID block."
 *
 * The backend's cost estimators (studio/backend/stubs.py) price chat-call
 * blocks in USD from the configured model's list price and the measured
 * tokens/call of a real run; ``usd`` is ``null`` only when the model has no
 * price-table entry or the calls have no measured token basis (embedding
 * calls). A $ total is only ever shown when EVERY listed block has a real
 * ``usd`` figure; when any is missing this shows call counts plus an honest
 * "no per-call pricing configured" note rather than fabricating a number.
 */
export function CostConfirmSheet({ open, paidBlocks, blockByType, onConfirm, onCancel }: CostConfirmSheetProps) {
  if (!open) return null;

  const totalCalls = paidBlocks.reduce((sum, b) => sum + b.calls, 0);
  const allHaveUsd = paidBlocks.length > 0 && paidBlocks.every((b) => typeof b.usd === "number");
  const totalUsd = allHaveUsd ? paidBlocks.reduce((sum, b) => sum + (b.usd ?? 0), 0) : null;

  return (
    <div className="cost-confirm-sheet__overlay" role="dialog" aria-label="Confirm paid run">
      <div className="cost-confirm-sheet">
        <div className="cost-confirm-sheet__header">
          <div className="cost-confirm-sheet__title">Confirm paid run</div>
          <p className="cost-confirm-sheet__subtitle">
            This graph calls {paidBlocks.length} PAID block{paidBlocks.length === 1 ? "" : "s"} — each makes real
            LLM/API calls. Nothing runs until you confirm.
          </p>
        </div>

        <ul className="cost-confirm-sheet__list">
          {paidBlocks.map((b) => {
            const label = blockByType[b.type]?.label ?? b.type;
            return (
              <li key={b.block_id} className="cost-confirm-sheet__row">
                <span className="cost-confirm-sheet__row-label">{label}</span>
                <span className="cost-confirm-sheet__row-calls mono">~{b.calls} calls</span>
                <span className="cost-confirm-sheet__row-usd mono">{typeof b.usd === "number" ? `$${b.usd.toFixed(2)}` : "—"}</span>
              </li>
            );
          })}
        </ul>

        <div className="cost-confirm-sheet__total">
          <span className="mono">{totalCalls} calls total</span>
          {totalUsd !== null ? (
            <span className="mono">est. total ${totalUsd.toFixed(2)}</span>
          ) : (
            <span className="cost-confirm-sheet__no-pricing">no per-call pricing configured — showing call counts only</span>
          )}
        </div>

        <div className="cost-confirm-sheet__actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={onConfirm}>
            Confirm and run
          </button>
        </div>
      </div>
    </div>
  );
}
