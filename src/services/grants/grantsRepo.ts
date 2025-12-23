import fs from "node:fs";
import path from "node:path";
import { GrantProgram } from "../../contracts/grants.js";
import type { z } from "zod";

type Grant = z.infer<typeof GrantProgram>;

export function loadGrants(): Grant[] {
  const filePath = path.join(process.cwd(), "src", "data", "grants.seed.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed: unknown = JSON.parse(raw);
  return GrantProgram.array().parse(parsed);
}