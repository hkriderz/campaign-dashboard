import { NextResponse } from "next/server";
import {
  listMappingFiles,
  saveUploadedMappingFile,
} from "@/lib/pdi-tools/mapping-files";

export async function GET() {
  try {
    const payload = listMappingFiles();
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message, code: 500 }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("mappingFile");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "mappingFile is required.", code: 400 }, { status: 400 });
    }
    const text = await file.text();
    const saved = saveUploadedMappingFile(file.name, text);
    const payload = listMappingFiles();
    return NextResponse.json({ ok: true, saved, ...payload });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message, code: 400 }, { status: 400 });
  }
}
