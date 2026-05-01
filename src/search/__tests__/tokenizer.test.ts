import { describe, expect, it } from "vitest";
import { tokenize } from "../tokenizer.js";

describe("tokenize", () => {
  describe("CamelCase splitting", () => {
    it("splits simple CamelCase", () => {
      expect(tokenize("DataStore")).toEqual(["data", "store"]);
    });

    it("splits multi-word CamelCase", () => {
      expect(tokenize("DataStoreService")).toEqual(["data", "store", "service"]);
    });

    it("splits consecutive uppercase (acronym)", () => {
      const result = tokenize("HTTPSRequest");
      expect(result).toContain("https");
      expect(result).toContain("request");
    });

    it("splits mixed case with numbers", () => {
      const result = tokenize("v3DataStore");
      expect(result).toContain("data");
      expect(result).toContain("store");
    });

    it("handles async suffix", () => {
      const result = tokenize("GetUserIdFromNameAsync");
      expect(result).toContain("user");
      expect(result).toContain("id");
      expect(result).toContain("name");
      expect(result).toContain("async");
    });

    it("handles all-uppercase token", () => {
      const result = tokenize("RunService");
      expect(result).toContain("run");
      expect(result).toContain("service");
    });
  });

  describe("stopword removal", () => {
    it("removes common english stopwords", () => {
      const result = tokenize("how to use the DataStore");
      expect(result).not.toContain("how");
      expect(result).not.toContain("to");
      expect(result).not.toContain("the");
      expect(result).toContain("data");
      expect(result).toContain("store");
    });

    it("removes standalone 'a'", () => {
      expect(tokenize("a RemoteEvent")).not.toContain("a");
    });
  });

  describe("normalization", () => {
    it("lowercases all tokens", () => {
      const result = tokenize("TweenService");
      for (const token of result) {
        expect(token).toBe(token.toLowerCase());
      }
    });

    it("removes punctuation", () => {
      const result = tokenize("player's data-store");
      expect(result).not.toContain("player's");
      expect(result).not.toContain("data-store");
    });

    it("returns no empty strings", () => {
      const result = tokenize("   spaces   everywhere   ");
      for (const token of result) {
        expect(token.length).toBeGreaterThan(0);
      }
    });

    it("returns empty array for empty string", () => {
      expect(tokenize("")).toEqual([]);
    });

    it("returns empty array for only stopwords", () => {
      expect(tokenize("how to the a")).toEqual([]);
    });
  });

  describe("deduplication", () => {
    it("does not return duplicate tokens", () => {
      const result = tokenize("store store store");
      const unique = [...new Set(result)];
      expect(result).toEqual(unique);
    });
  });
});
