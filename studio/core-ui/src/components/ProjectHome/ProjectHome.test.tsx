import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ProjectHome } from "./ProjectHome";

afterEach(cleanup);

describe("ProjectHome", () => {
  it("renders the sample-project card above the template grid and fires onCreateSampleProject on click", () => {
    const onCreateSampleProject = vi.fn();
    render(
      <ProjectHome
        recentProjects={[]}
        onCreateProject={vi.fn()}
        onCreateSampleProject={onCreateSampleProject}
        onOpenProject={vi.fn()}
        onOpenRecent={vi.fn()}
      />,
    );

    expect(screen.getByText("Try the sample project")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create sample project" }));
    expect(onCreateSampleProject).toHaveBeenCalledTimes(1);
  });

  it("does not fire onCreateProject when the sample card is clicked", () => {
    const onCreateProject = vi.fn();
    render(
      <ProjectHome
        recentProjects={[]}
        onCreateProject={onCreateProject}
        onCreateSampleProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenRecent={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create sample project" }));
    expect(onCreateProject).not.toHaveBeenCalled();
  });

  it("renders category headings and keeps the sample-project card outside the searchable library", () => {
    render(
      <ProjectHome
        recentProjects={[]}
        onCreateProject={vi.fn()}
        onCreateSampleProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenRecent={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Retrieval & Eval" })).toBeInTheDocument();
    const input = screen.getByLabelText("Search templates");
    fireEvent.change(input, { target: { value: "zzz-no-such-template" } });
    // sample card is not part of the filterable library:
    expect(screen.getByText("Try the sample project")).toBeInTheDocument();
  });

  it("fires onCreateProject with the picked template from a grouped card", () => {
    const onCreateProject = vi.fn();
    render(
      <ProjectHome
        recentProjects={[]}
        onCreateProject={onCreateProject}
        onCreateSampleProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenRecent={vi.fn()}
      />,
    );
    const card = screen.getByText("Is plain BM25 good enough?").closest(".template-card") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: /new project from this template/i }));
    expect(onCreateProject).toHaveBeenCalledTimes(1);
    expect(onCreateProject.mock.calls[0][0].id).toBe("bm25-baseline");
  });
});
