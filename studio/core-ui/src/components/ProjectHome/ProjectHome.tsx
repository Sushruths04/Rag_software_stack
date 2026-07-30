import { TEMPLATES, type TemplateDef } from "../../data/templates";
import type { RecentProject } from "../../hooks/useDesktopProject";
import { trackSpotlight } from "../../utils/spotlight";
import { TemplateLibrary } from "../TemplatePicker/TemplateLibrary";
import "../TemplatePicker/TemplatePicker.css";
import "./ProjectHome.css";

export interface ProjectHomeProps {
  recentProjects: RecentProject[];
  onCreateProject: (template: TemplateDef | null) => void;
  onCreateSampleProject: () => void;
  onOpenProject: () => void;
  onOpenRecent: (path: string) => void;
}

/**
 * Desktop-only home screen (B-M1): shown when no project is open. Three
 * template cards + a recent-projects list, per 03_PHASE2_SOFTWARE_PLAN.md
 * B-M1 ("recent-projects home screen ... the empty state from design §5").
 * Reuses TemplatePicker's card markup/CSS so the same three templates read
 * identically here and inside an open project's "New from template" flow.
 */
export function ProjectHome({
  recentProjects,
  onCreateProject,
  onCreateSampleProject,
  onOpenProject,
  onOpenRecent,
}: ProjectHomeProps) {
  return (
    <div className="project-home">
      <div className="project-home__header">
        <span className="project-home__logo">
          GRAFT <span>Block Studio</span>
        </span>
        <p className="project-home__subtitle">Build, run, and evaluate RAG ground-truth pipelines — visually.</p>
      </div>

      <section className="project-home__section">
        <h2 className="project-home__section-title">New project</h2>
        <div className="template-picker__grid">
          <article className="template-card template-card--sample" onMouseMove={trackSpotlight}>
            <div className="template-card__tag mono">bundled data · runs offline</div>
            <h3 className="template-card__title">Try the sample project</h3>
            <p className="template-card__description">
              Creates a project with the ECMA-404 corpus (PDF, chunks, facts, 20 GT pairs) and two ready-to-run
              sessions: a free retrieval evaluation and a paid QA-generation demo.
            </p>
            <button className="primary template-card__action" onClick={onCreateSampleProject}>
              Create sample project
            </button>
          </article>
        </div>
        <TemplateLibrary
          templates={TEMPLATES}
          actionLabel="New project from this template"
          onUseTemplate={(t) => onCreateProject(t)}
        />
        <button className="project-home__blank" onClick={() => onCreateProject(null)}>
          Or start a blank project
        </button>
      </section>

      <section className="project-home__section">
        <div className="project-home__section-row">
          <h2 className="project-home__section-title">Recent projects</h2>
          <button onClick={onOpenProject}>Open a project...</button>
        </div>
        {recentProjects.length === 0 ? (
          <p className="project-home__empty">No recent projects yet.</p>
        ) : (
          <ul className="project-home__recent-list">
            {recentProjects.map((p) => (
              <li key={p.path}>
                <button className="project-home__recent-item" onClick={() => onOpenRecent(p.path)}>
                  <span className="project-home__recent-name">{p.name}</span>
                  <span className="project-home__recent-path mono">{p.path}</span>
                  <span className="project-home__recent-date mono">{p.lastOpened.slice(0, 10)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
