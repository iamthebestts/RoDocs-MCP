import { describe, expect, it } from "vitest";
import { markDuplicates } from "../dedup.js";

describe("markDuplicates", () => {
  it("marks the lower-score duplicate across sources", () => {
    const result = markDuplicates({
      docs: [{ title: "Data Store Guide", name: "api", score: 10 }],
      guides: [{ title: "Data Store Guide", name: "guide", score: 5 }],
    });

    expect(result.docs[0]?.isDuplicate).toBeUndefined();
    expect(result.guides[0]?.isDuplicate).toBe(true);
  });

  it("does not mark different titles", () => {
    const result = markDuplicates({
      docs: [{ title: "Remote Events", name: "remote", score: 10 }],
      guides: [{ title: "Data Stores", name: "data", score: 5 }],
    });

    expect(result.docs[0]?.isDuplicate).toBeUndefined();
    expect(result.guides[0]?.isDuplicate).toBeUndefined();
  });
});
