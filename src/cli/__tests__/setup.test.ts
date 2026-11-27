import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../utils/logger.js";
import { PROVIDERS, runSetup } from "../setup.js";

function getProvider(name: string) {
  const p = PROVIDERS[name];
  if (!p) throw new Error(`Provider ${name} not found`);
  return p;
}

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof os>("node:os");
  return { ...actual, homedir: vi.fn() };
});

describe("setup", () => {
  let tmpDir: string;
  const originalPlatform = process.platform;
  const originalCwd = process.cwd;
  const originalAppdata = process.env.APPDATA;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rodocs-setup-test-"));
    vi.mocked(os.homedir).mockReturnValue(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    Object.defineProperty(process, "platform", { value: originalPlatform });
    process.cwd = originalCwd;
    process.env.APPDATA = originalAppdata;
  });

  describe("claude-code", () => {
    it("should resolve global path on Linux", () => {
      Object.defineProperty(process, "platform", { value: "linux" });
      const p = getProvider("claude-code").resolvePath({ local: false });
      expect(p).toBe(path.join(tmpDir, ".claude", "settings.json"));
    });

    it("should resolve global path on Windows", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      const p = getProvider("claude-code").resolvePath({ local: false });
      expect(p).toBe(path.join(tmpDir, ".claude", "settings.json"));
    });

    it("should resolve local path to .mcp.json in cwd", () => {
      process.cwd = () => tmpDir;
      const p = getProvider("claude-code").resolvePath({ local: true });
      expect(p).toBe(path.join(tmpDir, ".mcp.json"));
    });

    it("should configure global correctly", async () => {
      const configPath = path.join(tmpDir, ".claude", "settings.json");
      vi.spyOn(getProvider("claude-code"), "resolvePath").mockReturnValue(configPath);

      await runSetup("claude-code", false);

      const content = await fs.readFile(configPath, "utf-8");
      const json = JSON.parse(content);
      expect(json.mcpServers.rodocs).toBeDefined();
      expect(json.mcpServers.rodocs.command).toBe("npx");
      expect(json.mcpServers.rodocs.args).toContain("-y");
      expect(json.mcpServers.rodocs.args).toContain("rodocsmcp");
    });

    it("should create .mcp.json and .claude/settings.json with --local", async () => {
      process.cwd = () => tmpDir;
      await runSetup("claude-code", false, undefined, true);

      const mcpContent = await fs.readFile(path.join(tmpDir, ".mcp.json"), "utf-8");
      const mcp = JSON.parse(mcpContent);
      expect(mcp.mcpServers.rodocs).toBeDefined();

      const settingsContent = await fs.readFile(
        path.join(tmpDir, ".claude", "settings.json"),
        "utf-8",
      );
      const settings = JSON.parse(settingsContent);
      expect(settings.permissions.allow).toContain("mcp__rodocs__*");
    });

    it("should merge with existing config", async () => {
      const configPath = path.join(tmpDir, ".claude", "settings.json");
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify({ mcpServers: { other: { command: "other" } }, someKey: true }, null, 2),
      );
      vi.spyOn(getProvider("claude-code"), "resolvePath").mockReturnValue(configPath);

      await runSetup("claude-code", false);

      const content = await fs.readFile(configPath, "utf-8");
      const json = JSON.parse(content);
      expect(json.mcpServers.rodocs).toBeDefined();
      expect(json.mcpServers.other).toBeDefined();
      expect(json.someKey).toBe(true);
    });
  });

  describe("claude (Desktop)", () => {
    it("should resolve path on Windows", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      process.env.APPDATA = path.join(tmpDir, "AppData", "Roaming");
      const p = getProvider("claude").resolvePath({ local: false });
      expect(p).toBe(
        path.join(tmpDir, "AppData", "Roaming", "Claude", "claude_desktop_config.json"),
      );
    });

    it("should resolve path on macOS", () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      const p = getProvider("claude").resolvePath({ local: false });
      expect(p).toBe(
        path.join(tmpDir, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
      );
    });

    it("should resolve path on Linux", () => {
      Object.defineProperty(process, "platform", { value: "linux" });
      const p = getProvider("claude").resolvePath({ local: false });
      expect(p).toBe(path.join(tmpDir, ".config", "Claude", "claude_desktop_config.json"));
    });

    it("should warn when --local is used and fall back to global", async () => {
      const configPath = path.join(tmpDir, "claude_desktop_config.json");
      vi.spyOn(getProvider("claude"), "resolvePath").mockReturnValue(configPath);
      const warnSpy = vi.spyOn(logger, "warn");

      await runSetup("claude", false, undefined, true);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("does not support local configuration"),
      );
      const content = await fs.readFile(configPath, "utf-8");
      const json = JSON.parse(content);
      expect(json.mcpServers.rodocs).toBeDefined();
    });

    it("should configure with restart notice", async () => {
      const configPath = path.join(tmpDir, "claude_desktop_config.json");
      vi.spyOn(getProvider("claude"), "resolvePath").mockReturnValue(configPath);

      const result = await runSetup("claude", false);

      expect(result?.needsRestart).toBe(true);
    });
  });

  describe("opencode", () => {
    it("should resolve global path on Linux", () => {
      Object.defineProperty(process, "platform", { value: "linux" });
      const p = getProvider("opencode").resolvePath({ local: false });
      expect(p).toBe(path.join(tmpDir, ".config", "opencode", "config.json"));
    });

    it("should resolve global path on Windows", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      process.env.APPDATA = path.join(tmpDir, "AppData", "Roaming");
      const p = getProvider("opencode").resolvePath({ local: false });
      expect(p).toBe(path.join(tmpDir, "AppData", "Roaming", "opencode", "config.json"));
    });

    it("should resolve local path to opencode.json in cwd", () => {
      process.cwd = () => tmpDir;
      const p = getProvider("opencode").resolvePath({ local: true });
      expect(p).toBe(path.join(tmpDir, "opencode.json"));
    });

    it("should configure with correct OpenCode format", async () => {
      const configPath = path.join(tmpDir, "opencode.json");
      vi.spyOn(getProvider("opencode"), "resolvePath").mockReturnValue(configPath);

      await runSetup("opencode", false, "tok_123");

      const content = await fs.readFile(configPath, "utf-8");
      const json = JSON.parse(content);
      expect(json.mcp.rodocs.type).toBe("local");
      expect(json.mcp.rodocs.command).toEqual(["npx", "-y", "rodocsmcp"]);
      expect(json.mcp.rodocs.enabled).toBe(true);
      expect(json.mcp.rodocs.environment).toEqual({ GITHUB_TOKEN: "tok_123" });
    });

    it("should merge with existing OpenCode config", async () => {
      const configPath = path.join(tmpDir, "opencode.json");
      await fs.writeFile(
        configPath,
        JSON.stringify({ mcp: { other: { type: "local", command: ["x"] } }, theme: "dark" }),
      );
      vi.spyOn(getProvider("opencode"), "resolvePath").mockReturnValue(configPath);

      await runSetup("opencode", false);

      const json = JSON.parse(await fs.readFile(configPath, "utf-8"));
      expect(json.mcp.rodocs).toBeDefined();
      expect(json.mcp.other).toBeDefined();
      expect(json.theme).toBe("dark");
    });
  });

  describe("codex", () => {
    it("should resolve global path", () => {
      const p = getProvider("codex").resolvePath({ local: false });
      expect(p).toBe(path.join(tmpDir, ".codex", "config.toml"));
    });

    it("should resolve local path to .codex/config.toml in cwd", () => {
      process.cwd = () => tmpDir;
      const p = getProvider("codex").resolvePath({ local: true });
      expect(p).toBe(path.join(tmpDir, ".codex", "config.toml"));
    });

    it("should generate valid TOML config", async () => {
      const configPath = path.join(tmpDir, ".codex", "config.toml");
      vi.spyOn(getProvider("codex"), "resolvePath").mockReturnValue(configPath);

      await runSetup("codex", false, "ghp_abc123");

      const content = await fs.readFile(configPath, "utf-8");
      expect(content).toContain("mcp_servers");
      expect(content).toContain("rodocs");
      expect(content).toContain("npx");
      expect(content).toContain("rodocsmcp");
      expect(content).toContain("GITHUB_TOKEN");
      expect(content).toContain("ghp_abc123");
    });

    it("should merge with existing TOML config", async () => {
      const configPath = path.join(tmpDir, ".codex", "config.toml");
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, 'model = "o3"\n');
      vi.spyOn(getProvider("codex"), "resolvePath").mockReturnValue(configPath);

      await runSetup("codex", false);

      const content = await fs.readFile(configPath, "utf-8");
      expect(content).toContain("mcp_servers");
      expect(content).toContain("rodocs");
      expect(content).toContain("o3");
    });
  });

  describe("gemini", () => {
    it("should resolve global path on Linux", () => {
      Object.defineProperty(process, "platform", { value: "linux" });
      const p = getProvider("gemini").resolvePath({ local: false });
      expect(p).toBe(path.join(tmpDir, ".gemini", "settings.json"));
    });

    it("should resolve global path on Windows", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      const p = getProvider("gemini").resolvePath({ local: false });
      expect(p).toBe(path.join(tmpDir, ".gemini", "settings.json"));
    });

    it("should warn when --local is used", async () => {
      const configPath = path.join(tmpDir, ".gemini", "settings.json");
      vi.spyOn(getProvider("gemini"), "resolvePath").mockReturnValue(configPath);
      const warnSpy = vi.spyOn(logger, "warn");

      await runSetup("gemini", false, undefined, true);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("does not support local configuration"),
      );
    });

    it("should configure with mcpServers format", async () => {
      const configPath = path.join(tmpDir, ".gemini", "settings.json");
      vi.spyOn(getProvider("gemini"), "resolvePath").mockReturnValue(configPath);

      await runSetup("gemini", false, "tok_xyz");

      const json = JSON.parse(await fs.readFile(configPath, "utf-8"));
      expect(json.mcpServers.rodocs.command).toBe("npx");
      expect(json.mcpServers.rodocs.env).toEqual({ GITHUB_TOKEN: "tok_xyz" });
    });
  });

  describe("cursor", () => {
    it("should configure correctly", async () => {
      const configPath = path.join(tmpDir, ".cursor", "mcp.json");
      vi.spyOn(getProvider("cursor"), "resolvePath").mockReturnValue(configPath);

      await runSetup("cursor", false);

      const json = JSON.parse(await fs.readFile(configPath, "utf-8"));
      expect(json.mcpServers.rodocs).toBeDefined();
    });
  });

  describe("vscode", () => {
    it("should configure correctly", async () => {
      const configPath = path.join(tmpDir, ".vscode", "mcp.json");
      vi.spyOn(getProvider("vscode"), "resolvePath").mockReturnValue(configPath);

      await runSetup("vscode", false);

      const json = JSON.parse(await fs.readFile(configPath, "utf-8"));
      expect(json.servers.rodocs).toBeDefined();
    });
  });

  describe("general behavior", () => {
    it("should return null for unsupported provider", async () => {
      const result = await runSetup("nonexistent", false);
      expect(result).toBeNull();
    });

    it("should create parent directories", async () => {
      const deepPath = path.join(tmpDir, "a", "b", "c", "config.json");
      vi.spyOn(getProvider("gemini"), "resolvePath").mockReturnValue(deepPath);

      await runSetup("gemini", false);

      const content = await fs.readFile(deepPath, "utf-8");
      expect(JSON.parse(content).mcpServers.rodocs).toBeDefined();
    });

    it("should create backup before modifying existing file", async () => {
      const configPath = path.join(tmpDir, "existing.json");
      await fs.writeFile(configPath, '{"existing": true}');
      vi.spyOn(getProvider("gemini"), "resolvePath").mockReturnValue(configPath);

      await runSetup("gemini", false);

      // Verify original was modified (not overwritten without merge)
      const json = JSON.parse(await fs.readFile(configPath, "utf-8"));
      expect(json.existing).toBe(true);
      expect(json.mcpServers.rodocs).toBeDefined();
    });

    it("should include --client arg when daemon flag is set", async () => {
      const configPath = path.join(tmpDir, "test.json");
      vi.spyOn(getProvider("gemini"), "resolvePath").mockReturnValue(configPath);

      await runSetup("gemini", true);

      const json = JSON.parse(await fs.readFile(configPath, "utf-8"));
      expect(json.mcpServers.rodocs.args).toContain("--client");
    });

    it("should include GITHUB_TOKEN in env when provided", async () => {
      const configPath = path.join(tmpDir, "test.json");
      vi.spyOn(getProvider("gemini"), "resolvePath").mockReturnValue(configPath);

      await runSetup("gemini", false, "ghp_test123");

      const json = JSON.parse(await fs.readFile(configPath, "utf-8"));
      expect(json.mcpServers.rodocs.env.GITHUB_TOKEN).toBe("ghp_test123");
    });

    it("should not include env when no token provided", async () => {
      const configPath = path.join(tmpDir, "test.json");
      vi.spyOn(getProvider("gemini"), "resolvePath").mockReturnValue(configPath);

      await runSetup("gemini", false);

      const json = JSON.parse(await fs.readFile(configPath, "utf-8"));
      expect(json.mcpServers.rodocs.env).toEqual({});
    });
  });
});
