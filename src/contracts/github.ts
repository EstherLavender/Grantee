
import { z } from "zod";

export const AnalyzeRepoRequest = z.object({
  repoUrl: z.string().url(),     // e.g. https://github.com/owner/name
  branch: z.string().optional(), // default: default branch
  depth: z.enum(["light", "full"]).default("light"), // light = fast + cheap
});

export type AnalyzeRepoRequest = z.infer<typeof AnalyzeRepoRequest>;

export const AnalyzeRepoResponse = z.object({
  repo: z.object({
    owner: z.string(),
    name: z.string(),
    defaultBranch: z.string().optional(),
    stars: z.number(),
    forks: z.number().optional(),
    openIssues: z.number().optional(),
    languages: z.record(z.number()).optional(), // bytes per lang
    lastPushIso: z.string().optional(),
  }),
  activity: z.object({
    recentCommitCount: z.number().optional(),
    recentAuthors: z.array(z.string()).optional(),
  }).optional(),
  quality: z.object({
    score: z.number().min(0).max(100),
    reasons: z.array(z.string()),
  }),
  grantFit: z.array(z.object({
    grantId: z.string(),
    program: z.string(),
    fitScore: z.number().min(0).max(100),
    why: z.array(z.string()),
  })).default([]),
});
export type AnalyzeRepoResponse = z.infer<typeof AnalyzeRepoResponse>;
