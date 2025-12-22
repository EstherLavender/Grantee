// src/contracts/github.ts
import { z } from "zod";

/**
 * Request: analyze a GitHub repo and return signals + score + grant fit.
 */
export const AnalyzeRepoRequest = z.object({
  repoUrl: z.string().url(), // e.g. https://github.com/owner/repo
  branch: z.string().optional(), // default: repo default branch
  depth: z.enum(["light", "full"]).default("light"), // light=fast/cheap, full=deeper/expensive
  chainHint: z.string().optional(), // e.g. "avalanche-fuji" (or CAIP-2 eip155:43113)
});

export type AnalyzeRepoRequest = z.infer<typeof AnalyzeRepoRequest>;

/**
 * Response pieces
 */
export const RepoSignals = z.object({
  owner: z.string(),
  name: z.string(),
  defaultBranch: z.string().optional(),
  stars: z.number().nonnegative(),
  forks: z.number().nonnegative().optional(),
  openIssues: z.number().nonnegative().optional(),
  languages: z.record(z.number().nonnegative()).optional(), // bytes per language
  lastPushIso: z.string().optional(), // ISO string
  lastUpdatedIso: z.string().optional(), // ISO string
});

export type RepoSignals = z.infer<typeof RepoSignals>;

export const RepoActivity = z.object({
  recentCommitCount: z.number().nonnegative().optional(),
  recentAuthors: z.array(z.string()).optional(),
});

export type RepoActivity = z.infer<typeof RepoActivity>;

export const QualityScore = z.object({
  score: z.number().min(0).max(100),
  reasons: z.array(z.string()),
});

export type QualityScore = z.infer<typeof QualityScore>;

/**
 * Grant fit item returned from matcher.
 */
export const GrantFitItem = z.object({
  grantId: z.string(),
  program: z.string(),
  fitScore: z.number().min(0).max(100),
  why: z.array(z.string()),
});

export type GrantFitItem = z.infer<typeof GrantFitItem>;

/**
 * Final response for /v1/github/analyze
 */
export const AnalyzeRepoResponse = z.object({
  repo: RepoSignals,
  activity: RepoActivity.optional(),
  quality: QualityScore,
  grantFit: z.array(GrantFitItem).default([]),
  meta: z
    .object({
      chainHint: z.string().optional(),
      depth: z.enum(["light", "full"]).optional(),
      generatedAtIso: z.string().optional(),
    })
    .optional(),
});

export type AnalyzeRepoResponse = z.infer<typeof AnalyzeRepoResponse>;
