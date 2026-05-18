import * as fs from "fs";
import * as path from "path";

/**
 * Directory containing `stw_surveys.ndjson` and `pdi_questions.ndjson` for cached mapper loads.
 */
export function resolveNdjsonDataDir(): string | null {
  const env = process.env.PDI_TOOLS_DATA_DIR?.trim();
  if (env) {
    const resolved = path.resolve(env);
    if (fs.existsSync(path.join(resolved, "stw_surveys.ndjson"))) {
      return resolved;
    }
  }

  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "pdi-data"),
    path.join(cwd, "..", "pdiv3"),
    path.join(cwd, "..", "MoonDough"),
  ];

  for (const dir of candidates) {
    const resolved = path.resolve(dir);
    if (
      fs.existsSync(path.join(resolved, "stw_surveys.ndjson")) &&
      fs.existsSync(path.join(resolved, "pdi_questions.ndjson"))
    ) {
      return resolved;
    }
  }

  return null;
}
