// src/data/grants.ts
import grantsJson from "./grants.seed.json" assert { type: "json" };

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

// Explicitly cast through unknown to satisfy TS + NodeNext
export const GRANTS: GrantSeed[] = grantsJson as unknown as GrantSeed[];
