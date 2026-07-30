import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { CostConfirmSheet } from "./CostConfirmSheet";
import type { PaidBlockEstimate } from "../../api/client";
import type { BlockSpec } from "../../types/graph";

afterEach(cleanup);

const CLUSTER_ESTIMATE: PaidBlockEstimate = {
  block_id: "b11",
  type: "qa_gen_clusters",
  calls: 510,
  usd: null,
  note: "clusters x3.5 (3-5 calls/cluster avg)",
};

const PAIRS_ESTIMATE: PaidBlockEstimate = {
  block_id: "b10",
  type: "qa_gen_pairs",
  calls: 330,
  usd: null,
  note: "pairs x1.3 (round-2 avg)",
};

function makeSpec(type: string, label: string): BlockSpec {
  return {
    type,
    category: "generation",
    cost: "paid",
    label,
    subtitle: "generation · PAID",
    purpose: "",
    inputs: [],
    outputs: [],
    defaultParams: [],
    backing: "",
  };
}

const BLOCK_BY_TYPE: Record<string, BlockSpec> = {
  qa_gen_clusters: makeSpec("qa_gen_clusters", "Cluster QA Generator"),
  qa_gen_pairs: makeSpec("qa_gen_pairs", "Neighbor QA Generator"),
};

describe("CostConfirmSheet", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <CostConfirmSheet
        open={false}
        paidBlocks={[CLUSTER_ESTIMATE, PAIRS_ESTIMATE]}
        blockByType={BLOCK_BY_TYPE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each paid block by label with its estimated call count, and a total", () => {
    render(
      <CostConfirmSheet
        open
        paidBlocks={[CLUSTER_ESTIMATE, PAIRS_ESTIMATE]}
        blockByType={BLOCK_BY_TYPE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: /confirm/i });
    expect(within(dialog).getByText(/Cluster QA Generator/)).toBeInTheDocument();
    expect(within(dialog).getByText(/~510 calls/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Neighbor QA Generator/)).toBeInTheDocument();
    expect(within(dialog).getByText(/~330 calls/)).toBeInTheDocument();
    // total calls across both blocks
    expect(within(dialog).getByText(/840 calls total/)).toBeInTheDocument();
  });

  it("falls back to the raw block type when no catalog label is known", () => {
    render(
      <CostConfirmSheet
        open
        paidBlocks={[{ block_id: "bx", type: "mystery_block", calls: 12, usd: null, note: "" }]}
        blockByType={{}}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/mystery_block/)).toBeInTheDocument();
  });

  it("is honest about missing $ pricing instead of fabricating a total", () => {
    render(
      <CostConfirmSheet
        open
        paidBlocks={[CLUSTER_ESTIMATE, PAIRS_ESTIMATE]}
        blockByType={BLOCK_BY_TYPE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: /confirm/i });
    expect(within(dialog).getByText(/no per-call pricing configured/i)).toBeInTheDocument();
    expect(within(dialog).queryByText(/^\$/)).not.toBeInTheDocument();
  });

  it("shows a real $ total when every estimate has a usd figure", () => {
    render(
      <CostConfirmSheet
        open
        paidBlocks={[
          { ...CLUSTER_ESTIMATE, usd: 1.2 },
          { ...PAIRS_ESTIMATE, usd: 0.6 },
        ]}
        blockByType={BLOCK_BY_TYPE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: /confirm/i });
    expect(within(dialog).getByText(/est\. total \$1\.80/)).toBeInTheDocument();
  });

  it("calls onConfirm when the Confirm action is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <CostConfirmSheet
        open
        paidBlocks={[CLUSTER_ESTIMATE]}
        blockByType={BLOCK_BY_TYPE}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when the Cancel action (or close) is clicked", () => {
    const onCancel = vi.fn();
    render(
      <CostConfirmSheet
        open
        paidBlocks={[CLUSTER_ESTIMATE]}
        blockByType={BLOCK_BY_TYPE}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
