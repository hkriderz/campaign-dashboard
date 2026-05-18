import { NextResponse } from "next/server";
import { listMappingFiles, saveMappingExport } from "@/lib/pdi-tools/mapping-files";
import type { MappingOutput } from "@/lib/pdi-tools/types";

export async function POST(req: Request) {
  let body: { mapping?: MappingOutput };
  try {
    body = (await req.json()) as { mapping?: MappingOutput };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body", code: 400 }, { status: 400 });
  }

  if (!body.mapping || typeof body.mapping !== "object") {
    return NextResponse.json({ error: "mapping object is required", code: 400 }, { status: 400 });
  }

  try {
    const saved = saveMappingExport(body.mapping);
    const catalog = listMappingFiles();
    return NextResponse.json({
      ok: true,
      saved,
      mappingsDir: catalog.mappingsDir,
      exportsDir: catalog.mappingsDir,
      files: catalog.files,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message, code: 400 }, { status: 400 });
  }
}
