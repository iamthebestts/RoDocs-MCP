import axios from "axios";
import { buildGithubHeaders } from "../utils/github-token.js";

interface TreeEntry {
  path?: string;
  type?: string;
}

interface TreeResponse {
  tree?: TreeEntry[];
  sha?: string;
}

const TREE_URL = "https://api.github.com/repos/Roblox/creator-docs/git/trees/main?recursive=1";

const http = axios.create({
  timeout: 20_000,
  headers: {
    "User-Agent": "rodocsmcp/1.0.0",
    Accept: "application/json",
  },
});

let cachedTree: {
  entries: TreeEntry[];
  sha: string;
  fetchedAt: number;
} | null = null;
const TREE_TTL_MS = 10 * 60 * 1000;

export async function fetchGitHubTree(
  githubToken?: string,
): Promise<{ entries: TreeEntry[]; sha: string }> {
  const now = Date.now();
  if (cachedTree !== null && now - cachedTree.fetchedAt < TREE_TTL_MS) {
    return { entries: cachedTree.entries, sha: cachedTree.sha };
  }

  const { data } = await http.get<TreeResponse>(TREE_URL, {
    headers: buildGithubHeaders({}, githubToken),
  });

  const entries = data.tree ?? [];
  const sha = data.sha ?? "default";

  cachedTree = { entries, sha, fetchedAt: now };
  return { entries, sha };
}
