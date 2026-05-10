import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROVIDERS, runSetup } from "../setup.js";

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof os>("node:os");
  return { ...actual, homedir: vi.fn() };
});

describe("setup", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rodocs-setup-test-"));
    // Mock os.homedir
    vi.mocked(os.homedir).mockReturnValue(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should configure Claude Desktop", async () => {
    const configPath = path.join(tmpDir, "claude_desktop_config.json");
    const provider = PROVIDERS.claude;
    if (!provider) throw new Error("Provider not found");
    vi.spyOn(provider, "path").mockReturnValue(configPath);

    await runSetup("claude", false);

    const content = await fs.readFile(configPath, "utf-8");
    const json = JSON.parse(content);
    expect(json.mcpServers.rodocs).toBeDefined();
  });

  it("should configure Cursor", async () => {
    const configPath = path.join(tmpDir, ".cursor", "mcp.json");
    await fs.mkdir(path.join(tmpDir, ".cursor"), { recursive: true });
    const provider = PROVIDERS.cursor;
    if (!provider) throw new Error("Provider not found");
    vi.spyOn(provider, "path").mockReturnValue(configPath);

    await runSetup("cursor", false);

    const content = await fs.readFile(configPath, "utf-8");
    const json = JSON.parse(content);
    expect(json.mcpServers.rodocs).toBeDefined();
  });

  it("should configure VS Code", async () => {
    const configPath = path.join(tmpDir, ".vscode", "mcp.json");
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    const provider = PROVIDERS.vscode;
    if (!provider) throw new Error("Provider not found");
    vi.spyOn(provider, "path").mockReturnValue(configPath);

    await runSetup("vscode", false);

    const content = await fs.readFile(configPath, "utf-8");
    const json = JSON.parse(content);
    expect(json.servers.rodocs).toBeDefined();
  });

  it("should configure OpenCode", async () => {
    const configPath = path.join(tmpDir, ".config", "opencode", "opencode.json");
    await fs.mkdir(path.join(tmpDir, ".config", "opencode"), { recursive: true });
    const provider = PROVIDERS.opencode;
    if (!provider) throw new Error("Provider not found");
    vi.spyOn(provider, "path").mockReturnValue(configPath);

    await runSetup("opencode", false);

    const content = await fs.readFile(configPath, "utf-8");
    const json = JSON.parse(content);
    expect(json.mcp.rodocs).toBeDefined();
    expect(Array.isArray(json.mcp.rodocs.command)).toBe(true);
  });
});
