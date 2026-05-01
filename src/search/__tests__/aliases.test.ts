import { describe, expect, it } from "vitest";
import { resolveAliases } from "../aliases.js";

describe("resolveAliases", () => {
  describe("exact matches", () => {
    it("resolves 'datastore' to DataStore classes", () => {
      const result = resolveAliases("datastore");
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain("DataStoreService");
    });

    it("resolves 'memory store' multi-word alias", () => {
      const result = resolveAliases("memory store");
      expect(result).toContain("MemoryStoreService");
    });

    it("resolves 'remote event' multi-word alias", () => {
      const result = resolveAliases("remote event");
      expect(result).toContain("RemoteEvent");
    });

    it("resolves 'tween' alias", () => {
      const result = resolveAliases("tween");
      expect(result).toContain("TweenService");
    });
  });

  describe("case insensitivity", () => {
    it("handles uppercase query", () => {
      expect(resolveAliases("DATASTORE")).toEqual(resolveAliases("datastore"));
    });

    it("handles mixed case query", () => {
      expect(resolveAliases("DataStore")).toEqual(resolveAliases("datastore"));
    });

    it("handles mixed case multi-word", () => {
      expect(resolveAliases("Memory Store")).toEqual(resolveAliases("memory store"));
    });
  });

  describe("no match", () => {
    it("returns empty array for unknown query", () => {
      expect(resolveAliases("xyznotexists")).toEqual([]);
    });

    it("returns empty array for empty string", () => {
      expect(resolveAliases("")).toEqual([]);
    });

    it("returns empty array for whitespace only", () => {
      expect(resolveAliases("   ")).toEqual([]);
    });
  });

  describe("return type", () => {
    it("always returns an array", () => {
      expect(Array.isArray(resolveAliases("anything"))).toBe(true);
    });

    it("returned values are non-empty strings", () => {
      const result = resolveAliases("datastore");
      for (const name of result) {
        expect(typeof name).toBe("string");
        expect(name.length).toBeGreaterThan(0);
      }
    });
  });
});
