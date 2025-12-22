// src/contracts/grants.ts
import { z } from "zod";

/**
 * Core Grant record stored in DB/seed JSON.
 * Keep it stable + minimal.
 */
export const GrantProgram = z.object({
  id: z.string(),
  program: z.string(), // display name
  ecosystem: z.string(), // e.g. "Avalanche", "Ethereum", "Multi-chain"
  chains: z.array(z.string()).default([]), // e.g. ["avalanche-fuji", "evm"] or CAIP-2
  tags: z.array(z.string()).default([]), // e.g. ["infra","defi","gaming"]
  preferredLanguages: z.array(z.string()).optional(), // ["Solidity","TypeScript"]
  minQualityScore: z.number().min(0).max(100).optional(),
  notes: z.string().optional(),

  // Optional metadata for linking out
  url: z.string().url().optional(),
  deadlineIso: z.string().optional(),
});

export type GrantProgram = z.infer<typeof GrantProgram>;

/**
 * Request: match a builder/repo profile to grant programs.
 * This is useful both as a standalone endpoint and as a sub-step in GitHub analyze.
 */
export const GrantMatchRequest = z.object({
  chainHint: z.string().optional(), // "avalanche-fuji" or "eip155:43113"
  tags: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]), // normalized language names
  qualityScore: z.number().min(0).max(100).optional(),
  limit: z.number().int().min(1).max(20).default(5),
});

export type GrantMatchRequest = z.infer<typeof GrantMatchRequest>;

/**
 * Response: ranked matches with rationale.
 */
export const GrantMatchItem = z.object({
  grantId: z.string(),
  program: z.string(),
  ecosystem: z.string().optional(),
  fitScore: z.number().min(0).max(100),
  why: z.array(z.string()).default([]),
});

export type GrantMatchItem = z.infer<typeof GrantMatchItem>;

export const GrantMatchResponse = z.object({
  matches: z.array(GrantMatchItem),
  meta: z
    .object({
      chainHint: z.string().optional(),
      generatedAtIso: z.string().optional(),
    })
    .optional(),
});

export type GrantMatchResponse = z.infer<typeof GrantMatchResponse>;

