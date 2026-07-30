import "./TemplatePicker/TemplatePicker.css";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  /** Defaults to "Cancel" — override for a two-real-actions dialog (e.g.
   * "Restore draft" / "Discard draft", where neither side is a no-op). */
  cancelLabel?: string;
  /** Hides the cancel/secondary button entirely, for a single-action
   * acknowledgement dialog (e.g. "this file is corrupted, started blank"). */
  hideCancel?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Minimal reusable yes/no (or single-acknowledge) dialog, same overlay
 * chrome as TemplatePicker. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  hideCancel = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="template-picker__overlay" role="dialog" aria-label={title}>
      <div className="template-picker" style={{ width: "min(420px, 90vw)" }}>
        <div className="template-picker__header">
          <div className="template-picker__title">{title}</div>
          <p className="template-picker__subtitle">{message}</p>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          {!hideCancel && <button onClick={onCancel}>{cancelLabel}</button>}
          <button className="primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
