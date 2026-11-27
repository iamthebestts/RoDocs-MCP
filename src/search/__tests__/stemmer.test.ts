import { describe, expect, it } from "vitest";
import { stemWord } from "../stemmer.js";
import { tokenize } from "../tokenizer.js";

describe("stemmer", () => {
  it("stems animating to animate", () => {
    expect(tokenize("animating", { useStemming: true })).toContain("animate");
  });

  it("does not stem PascalCase API names", () => {
    expect(tokenize("BasePart", { useStemming: true })).toEqual(["base", "part"]);
  });

  it("stems running to run", () => {
    expect(stemWord("running")).toBe("run");
  });
});
