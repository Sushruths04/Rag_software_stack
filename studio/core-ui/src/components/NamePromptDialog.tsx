import { useEffect, useState } from "react";
import "./TemplatePicker/TemplatePicker.css";

export interface NamePromptDialogProps {
  open: boolean;
  title: string;
  subtitle: string;
  confirmLabel: string;
  defaultName: string;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}

/**
 * Minimal reusable name prompt (used for "New Project" and "New Session").
 * Deliberately not window.prompt(): WebView2's support for it is
 * inconsistent across versions, so a small in-app dialog (same overlay
 * chrome as TemplatePicker) is the safe choice.
 */
export function NamePromptDialog({
  open,
  title,
  subtitle,
  confirmLabel,
  defaultName,
  onCancel,
  onConfirm,
}: NamePromptDialogProps) {
  const [name, setName] = useState(defaultName);

  useEffect(() => {
    if (open) setName(defaultName);
  }, [open, defaultName]);

  if (!open) return null;

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed) onConfirm(trimmed);
  };

  return (
    <div className="template-picker__overlay" role="dialog" aria-label={title}>
      <div className="template-picker" style={{ width: "min(420px, 90vw)" }}>
        <div className="template-picker__header">
          <div className="template-picker__title">{title}</div>
          <p className="template-picker__subtitle">{subtitle}</p>
        </div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onCancel();
          }}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "8px 10px",
            marginBottom: 16,
            background: "var(--bg-1)",
            border: "1px solid var(--line-2)",
            borderRadius: 6,
            color: "var(--tx-hi)",
            fontFamily: "var(--font-mono)",
            fontSize: 13,
          }}
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={submit}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
