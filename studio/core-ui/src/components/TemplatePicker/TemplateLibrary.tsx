import { useState } from "react";
import { TEMPLATE_CATEGORIES, type TemplateDef } from "../../data/templates";
import { trackSpotlight } from "../../utils/spotlight";
import "./TemplatePicker.css";

export interface TemplateLibraryProps {
  templates: TemplateDef[];
  /** Card button label — differs between home screen and in-project picker. */
  actionLabel: string;
  onUseTemplate: (template: TemplateDef) => void;
}

/**
 * Category-grouped, text-filterable template card list (template-library
 * spec 2026-07-11). Owns the search state and the grouping; the card markup
 * is the exact `template-card` structure ProjectHome/TemplatePicker
 * previously duplicated, so existing CSS (including the spotlight hover)
 * applies unchanged. Search matches title, tag, and description,
 * case-insensitively; categories with no matching cards are hidden.
 */
export function TemplateLibrary({ templates, actionLabel, onUseTemplate }: TemplateLibraryProps) {
  const [query, setQuery] = useState("");
  const visible = templates.filter((t) => !t.hidden);
  const q = query.trim().toLowerCase();
  const matches = q
    ? visible.filter((t) => `${t.title} ${t.tag} ${t.description}`.toLowerCase().includes(q))
    : visible;

  return (
    <div className="template-library">
      <div className="template-library__search">
        <input
          type="search"
          placeholder="Search templates"
          aria-label="Search templates"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {TEMPLATE_CATEGORIES.map((cat) => {
        const cards = matches.filter((t) => t.category === cat);
        if (cards.length === 0) return null;
        return (
          <section key={cat} className="template-library__section">
            <h3 className="template-library__category">{cat}</h3>
            <div className="template-picker__grid">
              {cards.map((t) => (
                <article className="template-card" key={t.id} onMouseMove={trackSpotlight}>
                  <div className="template-card__tag mono">{t.tag}</div>
                  <h3 className="template-card__title">{t.title}</h3>
                  <p className="template-card__description">{t.description}</p>
                  <button className="primary template-card__action" onClick={() => onUseTemplate(t)}>
                    {actionLabel}
                  </button>
                </article>
              ))}
            </div>
          </section>
        );
      })}
      {matches.length === 0 && <p className="template-library__empty">No templates match "{query}".</p>}
    </div>
  );
}
