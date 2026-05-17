import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { logger } from "../utils/logger.js";

export type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

type ProviderPathOptions = {
  local: boolean;
};

type ProviderSetupResult = {
  configPath: string;
  needsRestart: boolean;
  extraActions?: Array<{ path: string; content: string }>;
};

type Provider = {
  name: string;
  supportsLocal: boolean;
  resolvePath: (opts: ProviderPathOptions) => string | null;
  buildConfig: (existing: string, server: McpServerConfig) => string;
  needsRestart: boolean;
};

async function backupFile(filePath: string): Promise<string | null> {
  try {
    const basename = path.basename(filePath);
    const backupPath = path.join(os.tmpdir(), `rodocs-bak-${basename}-${Date.now()}.bak`);
    await fs.copyFile(filePath, backupPath);
    return backupPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return null;
  }
}

async function ensureDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function mergeJsonConfig(
  existing: string,
  serverKey: string,
  server: McpServerConfig,
  nestPath: string[],
): string {
  const parsed = JSON.parse(existing || "{}") as Record<string, unknown>;
  let target = parsed as Record<string, unknown>;
  for (const key of nestPath) {
    if (!target[key] || typeof target[key] !== "object") {
      target[key] = {};
    }
    target = target[key] as Record<string, unknown>;
  }
  target[serverKey] = server;
  return JSON.stringify(parsed, null, 2);
}

export const PROVIDERS: Record<string, Provider> = {
  "claude-code": {
    name: "Claude Code",
    supportsLocal: true,
    needsRestart: false,
    resolvePath: (opts) => {
      if (opts.local) {
        return path.join(process.cwd(), ".mcp.json");
      }
      return path.join(os.homedir(), ".claude", "settings.json");
    },
    buildConfig: (existing, server) => {
      return mergeJsonConfig(existing, "rodocs", server, ["mcpServers"]);
    },
  },
  claude: {
    name: "Claude Desktop",
    supportsLocal: false,
    needsRestart: true,
    resolvePath: () => {
      if (process.platform === "win32") {
        return path.join(
          process.env.APPDATA || os.homedir(),
          "Claude",
          "claude_desktop_config.json",
        );
      }
      if (process.platform === "darwin") {
        return path.join(
          os.homedir(),
          "Library",
          "Application Support",
          "Claude",
          "claude_desktop_config.json",
        );
      }
      return path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json");
    },
    buildConfig: (existing, server) => {
      return mergeJsonConfig(existing, "rodocs", server, ["mcpServers"]);
    },
  },
  opencode: {
    name: "OpenCode",
    supportsLocal: true,
    needsRestart: true,
    resolvePath: (opts) => {
      if (opts.local) {
        return path.join(process.cwd(), "opencode.json");
      }
      if (process.platform === "win32") {
        return path.join(process.env.APPDATA || os.homedir(), "opencode", "config.json");
      }
      return path.join(os.homedir(), ".config", "opencode", "config.json");
    },
    buildConfig: (existing, server) => {
      const parsed = JSON.parse(existing || "{}") as Record<string, unknown>;
      if (!parsed.mcp || typeof parsed.mcp !== "object") {
        parsed.mcp = {};
      }
      const mcp = parsed.mcp as Record<string, unknown>;
      const command = [server.command, ...(server.args || [])];
      const entry: Record<string, unknown> = {
        type: "local",
        command,
        enabled: true,
      };
      if (server.env && Object.keys(server.env).length > 0) {
        entry.environment = server.env;
      }
      mcp.rodocs = entry;
      return JSON.stringify(parsed, null, 2);
    },
  },
  codex: {
    name: "Codex",
    supportsLocal: true,
    needsRestart: true,
    resolvePath: (opts) => {
      if (opts.local) {
        return path.join(process.cwd(), ".codex", "config.toml");
      }
      if (process.platform === "win32") {
        return path.join(os.homedir(), ".codex", "config.toml");
      }
      return path.join(os.homedir(), ".codex", "config.toml");
    },
    buildConfig: (existing, server) => {
      const parsed = existing.trim() ? (parseToml(existing) as Record<string, unknown>) : {};
      if (!parsed.mcp_servers || typeof parsed.mcp_servers !== "object") {
        parsed.mcp_servers = {};
      }
      const servers = parsed.mcp_servers as Record<string, unknown>;
      const entry: Record<string, unknown> = {
        command: server.command,
        args: server.args || [],
      };
      if (server.env && Object.keys(server.env).length > 0) {
        entry.env = server.env;
      }
      servers.rodocs = entry;
      return stringifyToml(parsed);
    },
  },
  gemini: {
    name: "Gemini CLI",
    supportsLocal: false,
    needsRestart: true,
    resolvePath: () => {
      if (process.platform === "win32") {
        return path.join(os.homedir(), ".gemini", "settings.json");
      }
      return path.join(os.homedir(), ".gemini", "settings.json");
    },
    buildConfig: (existing, server) => {
      return mergeJsonConfig(existing, "rodocs", server, ["mcpServers"]);
    },
  },
  cursor: {
    name: "Cursor",
    supportsLocal: false,
    needsRestart: false,
    resolvePath: () => path.join(os.homedir(), ".cursor", "mcp.json"),
    buildConfig: (existing, server) => {
      return mergeJsonConfig(existing, "rodocs", server, ["mcpServers"]);
    },
  },
  vscode: {
    name: "VS Code",
    supportsLocal: false,
    needsRestart: false,
    resolvePath: () => path.join(process.cwd(), ".vscode", "mcp.json"),
    buildConfig: (existing, server) => {
      return mergeJsonConfig(existing, "rodocs", server, ["servers"]);
    },
  },
};

export async function runSetup(
  providerName: string,
  daemon: boolean,
  githubToken?: string,
  local = false,
): Promise<ProviderSetupResult | null> {
  const provider = PROVIDERS[providerName];
  if (!provider) {
    logger.error(
      `Provider "${providerName}" not supported. Available: ${Object.keys(PROVIDERS).join(", ")}`,
    );
    return null;
  }

  if (local && !provider.supportsLocal) {
    logger.warn(
      `Provider "${provider.name}" does not support local configuration. Using global config.`,
    );
  }

  const useLocal = local && provider.supportsLocal;
  const configPath = provider.resolvePath({ local: useLocal });
  if (!configPath) {
    logger.info(`Manual setup required for ${provider.name}.`);
    return null;
  }

  await ensureDir(configPath);

  const existing = await fs.readFile(configPath, "utf8").catch(() => "");
  const backupPath = await backupFile(configPath);
  if (backupPath) {
    logger.info(`Backup created at: ${backupPath}`);
  }

  const server: McpServerConfig = {
    command: "npx",
    args: ["-y", "rodocsmcp", ...(daemon ? ["--client"] : [])],
    env: githubToken ? { GITHUB_TOKEN: githubToken } : {},
  };

  const newContent = provider.buildConfig(existing, server);
  await fs.writeFile(configPath, newContent, "utf8");

  const extraActions: Array<{ path: string; content: string }> = [];

  if (providerName === "claude-code" && useLocal) {
    const settingsPath = path.join(process.cwd(), ".claude", "settings.json");
    await ensureDir(settingsPath);
    const settingsExisting = await fs.readFile(settingsPath, "utf8").catch(() => "{}");
    const settings = JSON.parse(settingsExisting) as Record<string, unknown>;
    if (!settings.permissions || typeof settings.permissions !== "object") {
      settings.permissions = {};
    }
    const perms = settings.permissions as Record<string, unknown>;
    if (!Array.isArray(perms.allow)) {
      perms.allow = [];
    }
    const allow = perms.allow as string[];
    const mcpPerm = "mcp__rodocs__*";
    if (!allow.includes(mcpPerm)) {
      allow.push(mcpPerm);
    }
    const settingsContent = JSON.stringify(settings, null, 2);
    await fs.writeFile(settingsPath, settingsContent, "utf8");
    extraActions.push({ path: settingsPath, content: settingsContent });
    logger.info(`Created ${settingsPath} with MCP permissions.`);
  }

  logger.info(`Successfully configured ${provider.name} at: ${configPath}`);
  if (provider.needsRestart) {
    logger.info(`Note: Restart ${provider.name} for changes to take effect.`);
  }

  return { configPath, needsRestart: provider.needsRestart, extraActions };
}
