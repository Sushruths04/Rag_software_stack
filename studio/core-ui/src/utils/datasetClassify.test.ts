import { describe, expect, it } from "vitest";
import { classifyDatasetJson } from "./datasetClassify";

/**
 * Pure content-shape classifier for a dataset JSON dropped into
 * importCorpus (Task 10). No filename sniffing — the real fact/chunk/qa
 * files this has to distinguish come from Stage-0..5 of the pipeline and
 * carry their own distinguishing keys, so classification reads the parsed
 * shape only.
 */
describe("classifyDatasetJson", () => {
  it("classifies an array of fact objects (fact_id + bboxes) as facts", () => {
    const parsed = [{ fact_id: "f1", text: "The sky is blue.", bboxes: [[0, 0, 1, 1]] }];
    expect(classifyDatasetJson(parsed)).toBe("facts");
  });

  it("classifies an array of chunk objects (chunk_id + text) as chunks", () => {
    const parsed = [{ chunk_id: "c1", text: "Some chunk text.", page: 3 }];
    expect(classifyDatasetJson(parsed)).toBe("chunks");
  });

  it("classifies an array of qa objects (qa_id) as qa", () => {
    const parsed = [{ qa_id: "q1", question: "What?", answer: "This." }];
    expect(classifyDatasetJson(parsed)).toBe("qa");
  });

  it("classifies an object with a pairs array as qa", () => {
    const parsed = { schema_version: 1, pairs: [{ question: "What?", answer: "This." }] };
    expect(classifyDatasetJson(parsed)).toBe("qa");
  });

  it("classifies anything else — empty array, plain object, primitive — as unknown", () => {
    expect(classifyDatasetJson([])).toBe("unknown");
    expect(classifyDatasetJson({ hello: "world" })).toBe("unknown");
    expect(classifyDatasetJson("just a string")).toBe("unknown");
    expect(classifyDatasetJson([{ page: 1, note: "no id fields here" }])).toBe("unknown");
  });
});
