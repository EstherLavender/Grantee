// src/services/grants/grantsRepo.ts
import { GRANTS } from "../../data/grants.js";
import { GrantProgram } from "../../contracts/grants.js";
import type { z } from "zod";

type Grant = z.infer<typeof GrantProgram>;

export function loadGrants(): Grant[] {
  // Validate the seed data at runtime (keeps your safety)
  return GrantProgram.array().parse(GRANTS);
}
