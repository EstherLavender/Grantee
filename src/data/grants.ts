// src/data/grants.ts
import grantsJson from "./grants.seed.json" with { type: "json" };

export type GrantSeed = {
  id: string;
  program: string;
  ecosystem: string;
  chains: string[];
  tags: string[];
  preferredLanguages: string[];
  minQualityScore: number;
  notes: string;
};

export const GRANTS: GrantSeed[] = grantsJson as unknown as GrantSeed[];
