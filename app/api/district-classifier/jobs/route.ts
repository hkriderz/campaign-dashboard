import { NextResponse } from "next/server";
import {
  createDistrictJob,
  listDistrictJobs,
  markStaleDistrictJobsFailed,
} from "@/lib/district-classifier/store";
import {
  DEFAULT_DISTRICT_COLUMN_MAPPING,
  DISTRICT_LAYER_OPTIONS,
  type DistrictColumnMapping,
  type DistrictLayerId,
  type DistrictTargetSelection,
} from "@/lib/district-classifier/types";
import { isDistrictClassificationRunning, runDistrictClassificationJob } from "@/lib/district-classifier/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const VALID_LAYERS = new Set(DISTRICT_LAYER_OPTIONS.map((layer) => layer.id));

function parseLayers(raw: FormDataEntryValue | null): DistrictLayerId[] {
  const fallback: DistrictLayerId[] = ["la-city-council"];
  if (!raw) return fallback;

  const values = raw
    .toString()
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const layers = values.filter((value): value is DistrictLayerId =>
    VALID_LAYERS.has(value as DistrictLayerId)
  );

  return layers.length ? layers : fallback;
}

function parseTargetSelection(raw: FormDataEntryValue | null): DistrictTargetSelection {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw.toString()) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: DistrictTargetSelection = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!VALID_LAYERS.has(key as DistrictLayerId) || !Array.isArray(value)) continue;
      out[key as DistrictLayerId] = value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
    }
    return out;
  } catch {
    return {};
  }
}

function formText(form: FormData, key: keyof DistrictColumnMapping): string {
  return form.get(key)?.toString()?.trim() || DEFAULT_DISTRICT_COLUMN_MAPPING[key];
}

export async function GET() {
  if (!isDistrictClassificationRunning()) {
    markStaleDistrictJobsFailed();
  }
  return NextResponse.json({ ok: true, data: { jobs: listDistrictJobs() } });
}

export async function POST(req: Request) {
  try {
    if (!isDistrictClassificationRunning()) {
      markStaleDistrictJobsFailed();
    }

    if (isDistrictClassificationRunning()) {
      return NextResponse.json(
        {
          ok: false,
          error: "Another district classification job is already running. Wait for it to finish before starting a new one.",
          code: 409,
        },
        { status: 409 }
      );
    }

    const form = await req.formData();
    const file = form.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Missing CSV file.", code: 400 }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".csv")) {
      return NextResponse.json(
        { ok: false, error: "Upload must be a CSV file.", code: 400 },
        { status: 400 }
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.byteLength === 0) {
      return NextResponse.json({ ok: false, error: "CSV file is empty.", code: 422 }, { status: 422 });
    }
    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { ok: false, error: "CSV file is too large. Maximum size is 50 MB.", code: 413 },
        { status: 413 }
      );
    }

    const job = createDistrictJob({
      originalFileName: file.name,
      fileBuffer: bytes,
      layers: parseLayers(form.get("layers")),
      targetSelection: parseTargetSelection(form.get("targetSelection")),
      compareHistorical: form.get("compareHistorical")?.toString() !== "false",
      columnMapping: {
        addressCol: formText(form, "addressCol"),
        cityCol: formText(form, "cityCol"),
        stateCol: formText(form, "stateCol"),
        zipCol: formText(form, "zipCol"),
        streetNumCol: formText(form, "streetNumCol"),
        streetNameCol: formText(form, "streetNameCol"),
        aptCol: formText(form, "aptCol"),
      },
    });

    runDistrictClassificationJob(job.id);

    return NextResponse.json({ ok: true, data: { job } }, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[district-classifier/jobs POST]", message);
    return NextResponse.json({ ok: false, error: message, code: 500 }, { status: 500 });
  }
}
