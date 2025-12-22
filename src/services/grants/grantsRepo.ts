import fs from "node:fs";
import path from "node:path";
import { GrantProgram } from "../../contracts/grants";

export function loadGrants() {
  const filePath = path.join(process.cwd(), "src", "data", "grants.seed.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw);
  return GrantProgram.array().parse(parsed);
}
