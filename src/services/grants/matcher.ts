import type { z } from "zod";
import type { GrantProgram } from "../../contracts/grants.js";

type Grant = z.infer<typeof GrantProgram>;

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Defensive helper: your zod schema might allow unknown/any here.
 * This ensures we only work with strings.
 */
function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function topLanguages(
  languages?: Record<string, number>,
  n: number = 5,
): string[] {
  if (!languages) return [];
  return Object.entries(languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name]) => name);
}

export type GrantMatch = {
  grantId: string;
  program: string;
  fitScore: number;
  why: string[];
};

export function matchGrants(input: {
  grants: Grant[];
  qualityScore: number;
  repoLanguages?: Record<string, number>;
  extraTags?: string[];
  chainHint?: string; // e.g. "avalanche-fuji" or "eip155:43113"
}): GrantMatch[] {
  const repoLangs: string[] = topLanguages(input.repoLanguages).map(normalize);
  const tags: string[] = (input.extraTags ?? []).map(normalize);
  const chainHint: string | undefined = input.chainHint
    ? normalize(input.chainHint)
    : undefined;

  return input.grants
    .map((g): GrantMatch => {
      const why: string[] = [];
      let rawScore = 0;

      // ---- Quality threshold ----
      const minQ: number = g.minQualityScore ?? 0;
      if (input.qualityScore >= minQ) {
        rawScore += 10;
        why.push(`Quality score meets threshold (${input.qualityScore} ≥ ${minQ})`);
      } else {
        rawScore -= 20;
        why.push(`Below typical threshold (${input.qualityScore} < ${minQ})`);
      }

      // ---- Chain alignment ----
      const grantChains: string[] = asStringArray(g.chains).map(normalize);

      if (chainHint && grantChains.includes(chainHint)) {
        rawScore += 20;
        why.push(`Aligned with chain: ${chainHint}`);
      } else if (grantChains.includes("evm")) {
        rawScore += 10;
        why.push("Broad EVM-compatible program");
      }

      // ---- Language fit ----
      const preferred: string[] = asStringArray(g.preferredLanguages).map(normalize);
      const langHits: string[] = preferred.filter((p: string) => repoLangs.includes(p));

      if (langHits.length) {
        rawScore += Math.min(15, langHits.length * 6);
        why.push(`Preferred languages: ${langHits.join(", ")}`);
      }

      // ---- Tag fit ----
      const grantTags: string[] = asStringArray(g.tags).map(normalize);
      const tagHits: string[] = grantTags.filter((t: string) => tags.includes(t));

      if (tagHits.length) {
        rawScore += Math.min(20, tagHits.length * 5);
        why.push(`Relevant tags: ${tagHits.join(", ")}`);
      }

      const fitScore: number = Math.max(0, Math.min(100, Math.round(rawScore + 50)));

      return {
        grantId: g.id,
        program: g.program,
        fitScore,
        why,
      };
    })
    .sort((a, b) => b.fitScore - a.fitScore)
    .slice(0, 5);
}