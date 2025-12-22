import type { z } from "zod";
import type { GrantProgram } from "../../contracts/grants";

function normalize(s: string) {
  return s.trim().toLowerCase();
}

function topLanguages(languages?: Record<string, number>, n = 5): string[] {
  if (!languages) return [];
  return Object.entries(languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name]) => name);
}

export function matchGrants(input: {
  grants: z.infer<typeof GrantProgram>[];
  qualityScore: number;
  repoLanguages?: Record<string, number>;
  extraTags?: string[];
  chainHint?: string; // "avalanche-fuji"
}) {
  const repoLangs = topLanguages(input.repoLanguages).map(normalize);
  const tags = (input.extraTags ?? []).map(normalize);
  const chainHint = input.chainHint ? normalize(input.chainHint) : undefined;

  return input.grants
    .map((g) => {
      const why: string[] = [];
      let rawScore = 0;

      const minQ = g.minQualityScore ?? 0;
      if (input.qualityScore >= minQ) {
        rawScore += 10;
        why.push(`Quality score meets threshold (${input.qualityScore} ≥ ${minQ})`);
      } else {
        rawScore -= 20;
        why.push(`Below typical threshold (${input.qualityScore} < ${minQ})`);
      }

      const grantChains = (g.chains ?? []).map(normalize);
      if (chainHint && grantChains.includes(chainHint)) {
        rawScore += 20;
        why.push(`Aligned with chain: ${chainHint}`);
      } else if (grantChains.includes("evm")) {
        rawScore += 10;
        why.push("Broad EVM-compatible program");
      }

      const preferred = (g.preferredLanguages ?? []).map(normalize);
      const langHits = preferred.filter((p) => repoLangs.includes(p));
      if (langHits.length) {
        rawScore += Math.min(15, langHits.length * 6);
        why.push(`Preferred languages: ${langHits.join(", ")}`);
      }

      const grantTags = (g.tags ?? []).map(normalize);
      const tagHits = grantTags.filter((t) => tags.includes(t));
      if (tagHits.length) {
        rawScore += Math.min(20, tagHits.length * 5);
        why.push(`Relevant tags: ${tagHits.join(", ")}`);
      }

      const fitScore = Math.max(0, Math.min(100, Math.round(rawScore + 50)));

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
