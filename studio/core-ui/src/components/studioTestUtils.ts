import { fireEvent, screen, within } from "@testing-library/react";

// The canvas now boots empty; most StudioShell test files need the full
// 22-block pipeline (index_builder among them) on screen, so hydrate it from
// the "sample-c" template that the empty-canvas effect's picker offers
// automatically on mount. Waits for the hydration's own "ready" console
// line, not a DOM block count — the trailing setEdges() call lands after the
// last block is on screen (see StudioShell.project.test.tsx's
// waitForTemplateReady).
//
// The 15000ms ceiling is contention-proof: findByText polls, so a generous
// ceiling costs nothing when the hydration succeeds quickly, but keeps the
// test from flaking under parallel-run CPU contention (dev servers etc.)
// where a tighter 3000ms budget can expire before React settles.
export async function hydrateFullPipeline() {
  const dialog = await screen.findByRole("dialog", { name: "Choose a template" });
  const card = within(dialog).getByText("The full v2 pipeline shape").closest(".template-card") as HTMLElement;
  fireEvent.click(within(card).getByRole("button", { name: /use this template/i }));
  await screen.findByText(/template "Full GT pipeline \(v2\)" ready/, {}, { timeout: 15000 });
}
