// src/routes.ts
import type { Request, Response } from "express";
import { AnalyzeRepoRequest } from "./contracts/github.js";
import { analyzeGithubRepo } from "./services/grantees/index.js";

/**
 * POST /v1/github/analyze
 * Body: AnalyzeRepoRequest
 * Returns: AnalyzeRepoResponse
 */
export async function githubAnalyze(req: Request, res: Response) {
  const parsed = AnalyzeRepoRequest.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.flatten(),
    });
  }

  try {
    const result = await analyzeGithubRepo(parsed.data, {
      chainDefault: "avalanche-fuji",
      githubToken: process.env.GITHUB_TOKEN,
    });

    return res.status(200).json(result);
  } catch (err: any) {
    // Normalize common failures without leaking internals
    const msg = err?.message ?? "Unknown error";

    // GitHub rate limit / auth issues often come back as 401/403 in message
    if (msg.includes("GitHub API error 401") || msg.includes("GitHub API error 403")) {
      return res.status(502).json({
        error: "GitHub API authentication/rate-limit issue",
        hint: "Set GITHUB_TOKEN in your .env for higher rate limits.",
      });
    }

    // repo not found / private without token
    if (msg.includes("GitHub API error 404")) {
      return res.status(404).json({
        error: "Repository not found",
        hint: "Check the repo URL, or provide a GITHUB_TOKEN if the repo is private.",
      });
    }

    return res.status(500).json({
      error: "Failed to analyze repository",
      message: msg,
    });
  }
}
