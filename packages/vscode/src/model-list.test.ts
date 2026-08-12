import { describe, expect, it } from "vitest";
import { sortedModelEntries, sortedModelIds } from "./model-list.js";

describe("model list ordering", () => {
  it("sorts model IDs alphabetically without duplicates", () => {
    expect(
      sortedModelIds([
        "zeta",
        "Alpha",
        "alpha",
        "Alpha",
        "model-10",
        "model-2",
        " ",
      ]),
    ).toEqual(["Alpha", "alpha", "model-2", "model-10", "zeta"]);
  });

  it("sorts discovered entries without changing their metadata", () => {
    const entries = [
      { id: "zeta", contextWindow: 8_192 },
      { id: "Alpha", contextWindow: 16_384 },
    ];

    expect(sortedModelEntries(entries)).toEqual([
      { id: "Alpha", contextWindow: 16_384 },
      { id: "zeta", contextWindow: 8_192 },
    ]);
  });
});
