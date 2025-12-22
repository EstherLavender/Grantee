// src/services/grantees/githubAnalyzeService.ts
import type { AnalyzeRepoRequest, AnalyzeRepoResponse } from "../../contracts/github";

import { parseRepoUrl } from "../github/parseRepoUrl";
import { fetchRepoSignals } from "../github/fetchRepoSignals";
import { qualityScore } from "../scoring/qualityScore";
import { loadGrants } from "../grants/grantsRepo";
import { matchGrants } from "../grants/matcher";

export async function analyzeGithubRepo(
  input: AnalyzeRepoRequest,
  opts?: {
    githubToken?: string;
    chainDefault?: string; // "avalanche-fuji"
  },
): Promise<AnalyzeRepoResponse> {
  const chainHint = input.chainHint ?? opts?.chainDefault ?? "avalanche-fuji";
  const githubToken = opts?.githubToken ?? process.env.GITHUB_TOKEN;

  const { owner, repo } = parseRepoUrl(input.repoUrl);

  const signals = await fetchRepoSignals(owner, repo, githubToken);

  const q = qualityScore({
    stars: signals.repo.stars,
    forks: signals.repo.forks,
    openIssues: signals.repo.openIssues,
    recentCommitCount: signals.activity?.recentCommitCount,
    languages: signals.repo.languages,
    lastPushIso: signals.repo.lastPushIso,
  });

  const inferredTags = inferTagsFromLanguages(signals.repo.languages);

  const grants = loadGrants();
  const grantFit = matchGrants({
    grants,
    qualityScore: q.score,
    repoLanguages: signals.repo.languages,
    extraTags: inferredTags,
    chainHint,
  });

  return {
    repo: signals.repo,
    activity: signals.activity,
    quality: q,
    grantFit,
    meta: {
      chainHint,
      depth: input.depth,
      generatedAtIso: new Date().toISOString(),
    },
  };
}

function inferTagsFromLanguages(languages?: Record<string, number>): string[] {
  const langs = Object.keys(languages ?? {}).map((l) => l.toLowerCase());
  const tags = new Set<string>();

  if (langs.includes("solidity")) {
    tags.add("evm");
    tags.add("defi");
    tags.add("infra");
  }
  if (langs.includes("typescript") || langs.includes("javascript")) {
    tags.add("consumer");
    tags.add("devtools");
  }
  if (langs.includes("python")) tags.add("ai");
  if (langs.includes("rust") || langs.includes("go")) tags.add("infra");

  return Array.from(tags);
}
