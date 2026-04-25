function normalizeGithubToken(githubToken?: string): string | undefined {
  if (typeof githubToken !== "string") return undefined;
  const token = githubToken.trim();
  return token.length > 0 ? token : undefined;
}

export function resolveGithubToken(
  githubToken?: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return normalizeGithubToken(githubToken) ?? normalizeGithubToken(env.GITHUB_TOKEN);
}

export function buildGithubHeaders(
  headers: Record<string, string>,
  githubToken?: string,
): Record<string, string> {
  const token = resolveGithubToken(githubToken);
  if (token === undefined) return headers;
  return { ...headers, Authorization: `Bearer ${token}` };
}

export function parseGithubTokenArgs(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): { args: string[]; githubToken?: string } {
  const nextArgs: string[] = [];
  let githubToken: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--github-token") {
      const value = args[i + 1];
      const token = normalizeGithubToken(value);
      if (token === undefined) {
        throw new Error("--github-token requires a token argument.");
      }
      githubToken = token;
      i += 1;
      continue;
    }

    if (arg?.startsWith("--github-token=")) {
      const token = normalizeGithubToken(arg.slice("--github-token=".length));
      if (token === undefined) {
        throw new Error("--github-token requires a token argument.");
      }
      githubToken = token;
      continue;
    }

    if (arg !== undefined) nextArgs.push(arg);
  }

  return {
    args: nextArgs,
    githubToken: resolveGithubToken(githubToken, env) as string,
  };
}
