import { gh } from "./githubClient";

type RepoMeta = {
  default_branch: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  pushed_at: string | null;
  updated_at: string | null;
};

type Commit = {
  sha: string;
  author?: { login?: string | null } | null;
  commit?: { author?: { name?: string | null; date?: string | null } | null } | null;
};

export async function fetchRepoSignals(owner: string, repo: string, token?: string) {
  const repoMeta = await gh<RepoMeta>(`/repos/${owner}/${repo}`, token);
  const languages = await gh<Record<string, number>>(`/repos/${owner}/${repo}/languages`, token);
  const commits = await gh<Commit[]>(`/repos/${owner}/${repo}/commits?per_page=30`, token);

  const recentAuthors = Array.from(
    new Set(
      commits
        .map((c) => c?.author?.login || c?.commit?.author?.name || null)
        .filter(Boolean) as string[],
    ),
  ).slice(0, 10);

  return {
    repo: {
      owner,
      name: repo,
      defaultBranch: repoMeta.default_branch,
      stars: repoMeta.stargazers_count ?? 0,
      forks: repoMeta.forks_count ?? 0,
      openIssues: repoMeta.open_issues_count ?? 0,
      languages,
      lastPushIso: repoMeta.pushed_at ?? undefined,
      lastUpdatedIso: repoMeta.updated_at ?? undefined,
    },
    activity: {
      recentCommitCount: commits.length,
      recentAuthors,
    },
  };
}
