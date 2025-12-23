import grants from "./grants.seed.json" assert { type: "json" };

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

export const GRANTS = grants as GrantSeed[];
