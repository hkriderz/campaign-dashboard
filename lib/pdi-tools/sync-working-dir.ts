import * as fs from "fs";
import * as path from "path";

/** Mapper + Syncer mapping JSON (`stw_pdi_mapping_*.json`). */
export const PDI_MAPPINGS_DIR_NAME = "pdi-mappings";

/** STW → PDI sync CSV reports (`pdi_mapping_report.csv`, etc.). */
export const PDI_SYNC_EXPORTS_DIR_NAME = "pdi-sync-exports";

const LEGACY_DATA_MAPPINGS = path.join(process.cwd(), "data", "pdi-mappings");

export function resolvePdiMappingsDir(): string {
  if (process.env.PDI_MAPPINGS_DIR?.trim()) {
    return path.resolve(process.env.PDI_MAPPINGS_DIR.trim());
  }
  return path.join(process.cwd(), PDI_MAPPINGS_DIR_NAME);
}

export function ensurePdiMappingsDir(): string {
  const dir = resolvePdiMappingsDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolvePdiSyncExportsDir(): string {
  if (process.env.PDI_SYNC_EXPORTS_DIR?.trim()) {
    return path.resolve(process.env.PDI_SYNC_EXPORTS_DIR.trim());
  }
  return path.join(process.cwd(), PDI_SYNC_EXPORTS_DIR_NAME);
}

export function ensurePdiSyncExportsDir(): string {
  const dir = resolvePdiSyncExportsDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Where `stw_to_pdi.py` lives when using the Python engine (script path only).
 */
export function resolveStwToPdiScriptDir(): string {
  return process.env.PDI_STW_WORKING_DIR
    ? path.resolve(process.env.PDI_STW_WORKING_DIR)
    : path.resolve(process.cwd(), "..", "p" + "div" + "3");
}

/** @deprecated Use resolvePdiMappingsDir */
export function resolveSyncWorkingDir(): string {
  return resolvePdiMappingsDir();
}

/** @deprecated Use resolvePdiMappingsDir */
export function resolvePdiMappingsUploadDir(): string {
  return resolvePdiMappingsDir();
}

/** One-time moves: legacy paths and mistaken JSON in sync exports → pdi-mappings */
export function migrateMappingFilesToMappingsDir(): void {
  const mappingsDir = ensurePdiMappingsDir();
  const isMappingJson = (name: string) =>
    name.toLowerCase().endsWith(".json") && name.toLowerCase().includes("stw_pdi_mapping");

  const sources = [LEGACY_DATA_MAPPINGS, resolvePdiSyncExportsDir()];
  for (const srcDir of sources) {
    if (!fs.existsSync(srcDir)) continue;
    if (path.resolve(srcDir) === path.resolve(mappingsDir)) continue;
    for (const name of fs.readdirSync(srcDir)) {
      if (!isMappingJson(name)) continue;
      const src = path.join(srcDir, name);
      const dest = path.join(mappingsDir, name);
      try {
        if (!fs.statSync(src).isFile()) continue;
        if (!fs.existsSync(dest)) {
          fs.copyFileSync(src, dest);
        }
      } catch {
        continue;
      }
    }
  }
}
