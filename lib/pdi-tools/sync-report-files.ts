import "server-only";

import * as fs from "fs";
import * as path from "path";
import { ensurePdiSyncExportsDir, resolvePdiSyncExportsDir } from "./sync-working-dir";

export type SyncReportFileKind = "mapping-report" | "payload-preview" | "final-result-synthesis";

export type SyncReportFileEntry = {
  id: string;
  fileName: string;
  kind: SyncReportFileKind;
  modifiedAt: string;
  sizeBytes: number;
  downloadUrl: string;
};

function reportKind(fileName: string): SyncReportFileKind | null {
  const n = fileName.toLowerCase();
  if (!n.endsWith(".csv")) return null;
  if (n === "pdi_mapping_report.csv" || n.startsWith("pdi_mapping_report_")) return "mapping-report";
  if (n === "pdi_payload_preview.csv" || n.startsWith("pdi_payload_preview_")) return "payload-preview";
  if (n.startsWith("final_result_synthesis_")) return "final-result-synthesis";
  return null;
}

function assertSafeReportFileName(fileName: string): void {
  if (
    !fileName ||
    fileName !== path.basename(fileName) ||
    fileName.includes("..") ||
    fileName.includes("/") ||
    fileName.includes("\\")
  ) {
    throw new Error("Invalid report file name.");
  }
  if (!reportKind(fileName)) {
    throw new Error("Unsupported sync report file.");
  }
}

export function listSyncReportFiles(): { exportsDir: string; files: SyncReportFileEntry[] } {
  const exportsDir = ensurePdiSyncExportsDir();
  const files: SyncReportFileEntry[] = [];

  for (const fileName of fs.readdirSync(exportsDir)) {
    const kind = reportKind(fileName);
    if (!kind) continue;

    const absolutePath = path.join(exportsDir, fileName);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(absolutePath);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }

    files.push({
      id: fileName,
      fileName,
      kind,
      modifiedAt: stat.mtime.toISOString(),
      sizeBytes: stat.size,
      downloadUrl: `/api/pdi/sync-reports/${encodeURIComponent(fileName)}`,
    });
  }

  files.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
  return { exportsDir, files };
}

export function resolveSyncReportFilePath(fileName: string): string {
  assertSafeReportFileName(fileName);

  const exportsDir = path.resolve(resolvePdiSyncExportsDir());
  const absolutePath = path.resolve(exportsDir, fileName);
  const rel = path.relative(exportsDir, absolutePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Invalid report path.");
  }
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error("Report file not found.");
  }
  return absolutePath;
}
