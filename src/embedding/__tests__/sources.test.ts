import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildDocsEmbedDocs, buildGuidesEmbedDocs } from "../sources.js";

vi.mock("../../scraper/fetch.js", () => ({
  fetchIndex: vi.fn(async () => ({
    classes: ["Actor"],
    datatypes: ["Vector3"],
    enums: ["Material"],
    globals: ["task"],
    libraries: ["buffer"],
  })),
}));

vi.mock("../../scraper/guides.js", () => ({
  fetchGuideIndex: vi.fn(async () => [
    {
      path: "scripting/data/data-stores.md",
      title: "Data Stores",
      description: "Persist player data",
      category: "scripting",
    },
  ]),
}));

describe("embedding sources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("buildDocsEmbedDocs() maps API names to EmbedDoc entries", async () => {
    const docs = await buildDocsEmbedDocs();
    expect(docs).toHaveLength(5);
    expect(docs[0]).toEqual({ id: "Actor", source: "docs", text: "Actor" });
  });

  it("buildGuidesEmbedDocs() combines title and description", async () => {
    const docs = await buildGuidesEmbedDocs();
    expect(docs[0]?.id).toBe("scripting/data/data-stores.md");
    expect(docs[0]?.text).toContain("Data Stores");
    expect(docs[0]?.text).toContain("Persist player data");
  });
});