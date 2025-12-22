export function parseRepoUrl(repoUrl: string): { owner: string; repo: string } {
  const u = new URL(repoUrl);
  const parts = u.pathname
    .replace(/^\//, "")
    .replace(/\/$/, "")
    .replace(/\.git$/, "")
    .split("/");

  if (parts.length < 2) throw new Error("Invalid GitHub repo URL. Use https://github.com/<owner>/<repo>");
  return { owner: parts[0], repo: parts[1] };
}
