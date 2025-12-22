import { AnalyzeRepoRequest } from "../contracts/github";
import { analyzeGithubRepo } from "../services/grantees";

export async function githubAnalyze(req, res) {
  const parsed = AnalyzeRepoRequest.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const result = await analyzeGithubRepo(parsed.data, { chainDefault: "avalanche-fuji" });
  return res.json(result);
}

