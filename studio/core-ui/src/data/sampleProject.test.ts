import { describe, expect, it } from "vitest";
import { buildSampleSessions, SAMPLE_FILES, sampleCorpusEntry } from "./sampleProject";

const P = {
  pdf: "C:\\proj\\datasets\\ecma404\\ecma404_json.pdf",
  chunks: "C:\\proj\\datasets\\ecma404\\s2_chunks_full.json",
  facts: "C:\\proj\\datasets\\ecma404\\facts_ecma404_json_full.json",
  qa: "C:\\proj\\datasets\\ecma404\\qa_ecma404_json_full.json",
};

describe("buildSampleSessions", () => {
  it("eval demo wires qa+chunks+facts through index_builder into evaluator", () => {
    const { evalDemo } = buildSampleSessions(P);
    const types = evalDemo.blocks.map((b) => b.type);
    expect(types).toEqual(["qa_import", "chunks_import", "facts_import", "index_builder", "evaluator"]);
    expect(evalDemo.blocks[0].params?.path).toBe(P.qa);
    expect(evalDemo.blocks[1].params?.path).toBe(P.chunks);
    expect(evalDemo.wires).toHaveLength(4); // chunks->index, qa->eval, index->eval, facts->eval
  });

  it("generation demo is facts -> sampler -> qa_gen_pairs with doc param set", () => {
    const { generationDemo } = buildSampleSessions(P);
    const gen = generationDemo.blocks.find((b) => b.type === "qa_gen_pairs");
    expect(gen?.params?.doc).toBe("ecma404_json_full");
    expect(
      generationDemo.wires.map((w) => `${w.from.block}.${w.from.port}->${w.to.block}.${w.to.port}`),
    ).toEqual(expect.arrayContaining([expect.stringContaining("candidates")]));
  });

  it("corpus entry paths are project-relative forward-slash", () => {
    expect(sampleCorpusEntry().pdf).toBe("datasets/ecma404/ecma404_json.pdf");
  });
});

describe("SAMPLE_FILES", () => {
  it("lists the five bundled ecma404 data files, including the mined bridges file", () => {
    expect(SAMPLE_FILES).toEqual([
      "ecma404_json.pdf",
      "s2_chunks_full.json",
      "facts_ecma404_json_full.json",
      "qa_ecma404_json_full.json",
      "bridges_ecma404_json_full.json",
    ]);
  });
});
