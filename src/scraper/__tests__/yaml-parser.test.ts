import { describe, expect, it } from "vitest";
import { parseYamlToDocEntry } from "../yaml-parser.js";

describe("yaml-parser", () => {
  it("parses class correctly", () => {
    const yaml = `
name: DataStore
type: class
inherits: [GlobalDataStore]
description: |
  Expoe metodos para acessar um unico data store.
code_samples:
  - DataStore-Budget
properties:
  - name: PropName
    summary: Summary
    type: string
`;
    const entry = parseYamlToDocEntry(yaml);
    expect(entry.class.name).toBe("DataStore");
    expect(entry.class.summary).toBe("Expoe metodos para acessar um unico data store.");
    expect(entry.class.kind).toBe("class");
    expect(entry.class.codeSamples[0]).toMatchObject({
      identifier: "DataStore-Budget",
      displayName: "DataStore Budget",
    });
    expect(entry.class.ownMembers.properties[0]?.name).toBe("PropName");
    expect(entry.class.ownMembers.properties[0]?.type).toBe("string");
  });

  it("handles missing fields with defaults", () => {
    const yaml = `
name: Test
type: class
`;
    const entry = parseYamlToDocEntry(yaml);
    expect(entry.class.description).toBe("");
    expect(entry.class.ownMembers.properties).toEqual([]);
    expect(entry.class.tags).toEqual([]);
  });

  it("flattens security", () => {
    const yaml = `
name: Test
type: class
description: Desc
methods:
  - name: M
    summary: S
    security: { read: PluginSecurity, write: None }
`;
    const entry = parseYamlToDocEntry(yaml);
    expect(entry.class.ownMembers.methods[0]?.security).toBe("PluginSecurity/None");
  });

  it("rejects invalid YAML documents", () => {
    expect(() => parseYamlToDocEntry("[]")).toThrow("expected a document object");
    expect(() => parseYamlToDocEntry("type: class")).toThrow("missing API name");
  });
});
