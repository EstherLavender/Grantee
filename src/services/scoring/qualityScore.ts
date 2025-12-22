export function qualityScore(input: {
  stars: number;
  forks?: number;
  openIssues?: number;
  recentCommitCount?: number;
  languages?: Record<string, number>;
  lastPushIso?: string;
}) {
  let score = 50;
  const reasons: string[] = [];

  const recentCommits = input.recentCommitCount ?? 0;
  if (recentCommits >= 20) { score += 14; reasons.push("High recent commit activity"); }
  else if (recentCommits >= 10) { score += 10; reasons.push("Active recent commits"); }
  else if (recentCommits >= 3) { score += 5; reasons.push("Some recent commits"); }
  else { score -= 6; reasons.push("Low recent commit activity"); }

  const stars = input.stars ?? 0;
  if (stars >= 100) { score += 12; reasons.push("Strong community interest (stars)"); }
  else if (stars >= 20) { score += 8; reasons.push("Some community interest (stars)"); }
  else if (stars >= 5) { score += 4; reasons.push("Early community signals (stars)"); }

  const forks = input.forks ?? 0;
  if (forks >= 20) { score += 6; reasons.push("Forked by others"); }
  else if (forks >= 5) { score += 3; reasons.push("Some forks"); }

  const openIssues = input.openIssues ?? 0;
  if (openIssues > 100) { score -= 10; reasons.push("Very high open-issue load"); }
  else if (openIssues > 50) { score -= 6; reasons.push("High open-issue load"); }

  if (input.lastPushIso) {
    const days = (Date.now() - new Date(input.lastPushIso).getTime()) / (1000 * 60 * 60 * 24);
    if (days < 7) { score += 10; reasons.push("Recently pushed"); }
    else if (days < 30) { score += 6; reasons.push("Recently updated"); }
    else if (days > 180) { score -= 10; reasons.push("Stale repo activity"); }
  }

  const langs = input.languages ? Object.entries(input.languages) : [];
  const langNames = new Set(langs.map(([k]) => k.toLowerCase()));
  if (langNames.has("typescript")) { score += 3; reasons.push("TypeScript present"); }
  if (langNames.has("solidity")) { score += 4; reasons.push("Solidity present"); }

  score = Math.max(0, Math.min(100, score));
  return { score, reasons };
}
