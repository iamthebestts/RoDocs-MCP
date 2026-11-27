import { describe, expect, it } from "vitest";
import { buildGithubHeaders, parseGithubTokenArgs, resolveGithubToken } from "../github-token.js";

describe("resolveGithubToken", () => {
  it("prefers an explicit CLI token over the environment", () => {
    expect(resolveGithubToken("cli-token", { GITHUB_TOKEN: "env-token" })).toBe("cli-token");
  });

  it("falls back to GITHUB_TOKEN from the environment", () => {
    expect(resolveGithubToken(undefined, { GITHUB_TOKEN: "env-token" })).toBe("env-token");
  });

  it("returns undefined when neither source provides a token", () => {
    expect(resolveGithubToken(undefined, {})).toBeUndefined();
  });

  it("treats blank tokens as absent", () => {
    expect(resolveGithubToken("   ", { GITHUB_TOKEN: "  " })).toBeUndefined();
  });
});

describe("buildGithubHeaders", () => {
  it("adds an Authorization header when a token resolves", () => {
    expect(buildGithubHeaders({ Accept: "text/plain" }, "abc")).toEqual({
      Accept: "text/plain",
      Authorization: "Bearer abc",
    });
  });

  it("leaves headers untouched when no token resolves", () => {
    expect(buildGithubHeaders({ Accept: "text/plain" }, undefined)).toEqual({
      Accept: "text/plain",
    });
  });
});

describe("parseGithubTokenArgs", () => {
  it("parses --github-token <value>", () => {
    const result = parseGithubTokenArgs(["--github-token", "abc", "Actor"], {});
    expect(result.githubToken).toBe("abc");
    expect(result.args).toEqual(["Actor"]);
  });

  it("parses --github-token=<value>", () => {
    const result = parseGithubTokenArgs(["--github-token=abc", "Actor"], {});
    expect(result.githubToken).toBe("abc");
    expect(result.args).toEqual(["Actor"]);
  });

  it("falls back to the environment when no CLI flag is present", () => {
    const result = parseGithubTokenArgs(["Actor"], { GITHUB_TOKEN: "env-token" });
    expect(result.githubToken).toBe("env-token");
  });

  it("omits the githubToken key entirely when no token is available", () => {
    const result = parseGithubTokenArgs(["Actor"], {});
    expect("githubToken" in result).toBe(false);
    expect(result.githubToken).toBeUndefined();
  });

  it("throws when --github-token has no value", () => {
    expect(() => parseGithubTokenArgs(["--github-token"], {})).toThrow();
  });
});
