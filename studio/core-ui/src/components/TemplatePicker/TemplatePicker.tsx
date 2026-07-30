import { TEMPLATES, type TemplateDef } from "../../data/templates";
import { TemplateLibrary } from "./TemplateLibrary";
import { useEscapeToClose } from "../../hooks/useEscapeToClose";
import "./TemplatePicker.css";

export interface TemplatePickerProps {
  open: boolean;
  onClose: () => void;
  onUseTemplate: (template: TemplateDef) => void;
  /** Templates to show — defaults to the bundled three (BLOCK_GUIDE.md §10). */
  templates?: TemplateDef[];
}

/**
 * Empty-canvas / "New from template" picker — 04_DESIGN_SYSTEM.md §5
 * ("Empty canvas state: three template cards, not a blank void") and F1
 * ("empty canvas with 3 template cards"). Copy is taken verbatim from
 * BLOCK_GUIDE.md §10 (see src/data/templates/index.ts) rather than invented
 * here.
 */
export function TemplatePicker({ open, onClose, onUseTemplate, templates = TEMPLATES }: TemplatePickerProps) {
  useEscapeToClose(open, onClose);
  if (!open) return null;

  return (
    <div className="template-picker__overlay" role="dialog" aria-label="Choose a template">
      <div className="template-picker">
        <div className="template-picker__header">
          <div className="template-picker__title">Start from a template</div>
          {/* 04_DESIGN_SYSTEM.md §6 voice/copy rule, quoted verbatim: "Empty
              states invite: 'Drag a PDF Source here, or start from a
              template.'" */}
          <p className="template-picker__subtitle">Drag a PDF Source here, or start from a template.</p>
          <button className="template-picker__close" onClick={onClose} aria-label="Close template picker">
            ✕
          </button>
        </div>
        <TemplateLibrary templates={templates} actionLabel="Use this template" onUseTemplate={onUseTemplate} />
      </div>
    </div>
  );
}
