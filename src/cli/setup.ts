import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type McpServerConfig = {
  command: string | string[];
  args?: string[];
  env?: Record<string, string>;
};

export type McpConfig = {
  mcpServers?: Record<string, McpServerConfig>;
  servers?: Record<string, McpServerConfig>;
  mcp?: Record<string, McpServerConfig & { type: "local" }>;
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

export const PROVIDERS: Record<
  string,
  {
    name: string;
    path: () => string | null;
    // biome-ignore lint/suspicious/noExplicitAny: Required for flexible provider adapters
    buildConfig: (existing: any, server: McpServerConfig) => any;
  }
> = {
  claude: {
    name: "Claude Desktop",
    path: () => {
      const home = os.homedir();
      if (process.platform === "win32")
        return path.join(process.env.APPDATA || "", "Claude", "claude_desktop_config.json");
      if (process.platform === "darwin")
        return path.join(home, "Library/Application Support/Claude/claude_desktop_config.json");
      return null;
    },
    buildConfig: (existing: McpConfig, server: McpServerConfig) => ({
      ...existing,
      mcpServers: { ...existing.mcpServers, rodocs: server },
    }),
  },
  cursor: {
    name: "Cursor",
    path: () => path.join(os.homedir(), ".cursor", "mcp.json"),
    buildConfig: (existing: McpConfig, server: McpServerConfig) => ({
      ...existing,
      mcpServers: { ...existing.mcpServers, rodocs: server },
    }),
  },
  vscode: {
    name: "VS Code",
    path: () => path.join(process.cwd(), ".vscode", "mcp.json"),
    buildConfig: (existing: McpConfig, server: McpServerConfig) => ({
      ...existing,
      servers: { ...existing.servers, rodocs: server },
    }),
  },
  opencode: {
    name: "OpenCode",
    path: () => path.join(os.homedir(), ".config", "opencode", "opencode.json"),
    buildConfig: (existing: McpConfig, server: McpServerConfig) => ({
      ...existing,
      mcp: {
        ...existing.mcp,
        rodocs: {
          ...server,
          command: Array.isArray(server.command)
            ? server.command
            : [server.command, ...(server.args || [])],
          type: "local",
        },
      },
    }),
  },
  codex: {
    name: "Codex",
    path: () => path.join(os.homedir(), ".codex", "config.toml"),
    buildConfig: (existing: string, server: McpServerConfig) => {
      const newEntry = `[mcp_servers.rodocs]\ncommand = "${server.command}"\nargs = [${(
        server.args || []
      )
        .map((a) => `"${a}"`)
        .join(", ")}]\n[mcp_servers.rodocs.env]\n${Object.entries(server.env || {})
        .map(([k, v]) => `${k} = "${v}"`)
        .join("\n")}\n`;
      return `${existing}\n${newEntry}`;
    },
  },
};

export async function runSetup(
  providerName: string,
  daemon: boolean,
  githubToken?: string,
): Promise<void> {
  // biome-ignore lint/suspicious/noExplicitAny: Required for dynamic provider access
  const provider = (PROVIDERS as any)[providerName];
  if (!provider) {
    console.error(`Provider ${providerName} not supported.`);
    return;
  }

  const p = provider.path();
  if (!p) {
    console.log(`Manual setup required for ${provider.name}. Schema: ...`);
    return;
  }

  const backupPath = await backupFile(p);
  if (backupPath) {
    console.log(`Backup created at: ${backupPath}`);
  }

  const server: McpServerConfig = {
    command: "npx",
    args: ["rodocsmcp", ...(daemon ? ["--client"] : [])],
    env: githubToken ? { GITHUB_TOKEN: githubToken } : {},
  };

  if (providerName === "codex") {
    const existing = await fs.readFile(p, "utf-8").catch(() => "");
    await fs.writeFile(p, provider.buildConfig(existing, server));
  } else {
    const existing: McpConfig = JSON.parse(await fs.readFile(p, "utf-8").catch(() => "{}"));
    await fs.writeFile(p, JSON.stringify(provider.buildConfig(existing, server), null, 2));
  }
  console.log(`Successfully configured ${provider.name}.`);
}
