// src/services/grantees/githubAnalyzeService.ts
import {
  AnalyzeRepoRequest,
  AnalyzeRepoResponse,
} from "../../contracts/github";

import { parseRepoUrl } from "../github/parseRepoUrl";
import { fetchRepoSignals } from "../github/fetchRepoSignals";
import { qualityScore } from "../scoring/qualityScore";

import { loadGrants } from "../grants/grantsRepo";
import { matchGrants } from "../grants/matcher";

/**
 * Grantees API logic: GitHub repo → signals + quality + grant-fit
 * This is the function your route calls after x402 payment is settled.
 */
export async function analyzeGithubRepo(
  input: AnalyzeRepoRequest,
  opts?: {
    githubToken?: string;
    chainDefault?: string; // e.g. "avalanche-fuji"
  },
): Promise<AnalyzeRepoResponse> {
  const chainHint = input.chainHint ?? opts?.chainDefault ?? "avalanche-fuji";
  const githubToken = opts?.githubToken ?? process.env.GITHUB_TOKEN;

  // 1) parse repo url
  const { owner, repo } = parseRepoUrl(input.repoUrl);

  // 2) fetch signals (lightweight; depth is future extension)
  const signals = await fetchRepoSignals(owner, repo, githubToken);

  // 3) compute score
  const q = qualityScore({
    stars: signals.repo.stars,
    forks: signals.repo.forks,
    openIssues: signals.repo.openIssues,
    recentCommitCount: signals.activity?.recentCommitCount,
    languages: signals.repo.languages,
    lastPushIso: signals.repo.lastPushIso,
  });

  // 4) infer tags from repo languages (simple heuristics; expand later)
  const inferredTags = inferTagsFromSignals({
    languages: signals.repo.languages,
  });

  // 5) match grants (Fuji-first)
  const grants = loadGrants();
  const grantFit = matchGrants({
    grants,
    qualityScore: q.score,
    repoLanguages: signals.repo.languages,
    extraTags: inferredTags,
    chainHint,
  });

  // 6) return contract-shaped response
  const out: AnalyzeRepoResponse = {
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

  return out;
}

/**
 * Very light tag inference.
 * Keep deterministic + cheap. You can add LLM-powered tagging later (paid tier).
 */
function inferTagsFromSignals(input: {
  languages?: Record<string, number>;
}): string[] {
  const langs = Object.keys(input.languages ?? {}).map((l) => l.toLowerCase());
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

