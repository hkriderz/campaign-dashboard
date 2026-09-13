import { NextResponse } from "next/server";
import { campaignNameMatchesTag, getCanvassingTags, getTagById } from "@/lib/campaign-tags";
import { appendKnockEventsToIndex, loadKnockIndex } from "@/lib/canvassing/knock-index-store";
import { buildKnockEvents, parseCanvassingUploadFile } from "@/lib/canvassing/knock-details-parser";
import {
  filterKnockIndexRows,
  knockOccurredOnLa,
  tallyCanvassingOverview,
} from "@/lib/canvassing/overview-tally";
import { readCanvassingUploadFormFiles } from "@/lib/canvassing/upload-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function overviewPayload(startDate: string, endDate: string, tagId: string) {
  const index = loadKnockIndex();
  const tag = tagId ? getTagById(tagId) : undefined;
  const filtered = filterKnockIndexRows(index.rows, {
    startDate,
    endDate,
    assignmentMatches: tag ? (assignmentName) => campaignNameMatchesTag(assignmentName, tag) : undefined,
  });
  const tally = tallyCanvassingOverview(filtered);
  const days = index.rows.map((row) => knockOccurredOnLa(row.occurredAt)).filter(Boolean).sort();
  return {
    meta: {
      updatedAt: index.updatedAt,
      rowCount: index.rows.length,
      filteredRowCount: filtered.length,
      imports: index.imports.slice(-8),
      minDate: days[0] ?? "",
      maxDate: days[days.length - 1] ?? "",
    },
    candidates: getCanvassingTags().map((item) => ({ id: item.id, label: item.label })),
    stats: tally.stats,
    canvassers: tally.canvassers,
  };
}

function readDate(raw: string | null): string {
  const value = raw?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const startDate = readDate(url.searchParams.get("startDate"));
  const endDate = readDate(url.searchParams.get("endDate"));
  const tagId = url.searchParams.get("tagId")?.trim() ?? "";
  return NextResponse.json({ ok: true, data: overviewPayload(startDate, endDate, tagId) });
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const files = await readCanvassingUploadFormFiles(form);
    const parsed = (await Promise.all(files.map((file) => parseCanvassingUploadFile(file)))).flat();
    const knock = buildKnockEvents(parsed);
    if (!knock.events.length) {
      return NextResponse.json(
        { ok: false, error: "No Canvasser Details knock rows found in the upload.", code: 400 },
        { status: 400 }
      );
    }
    const appended = appendKnockEventsToIndex(knock.events, {
      source: "overview",
      fileNames: files.map((file) => file.fileName),
    });
    const startDate = readDate(typeof form.get("startDate") === "string" ? String(form.get("startDate")) : "");
    const endDate = readDate(typeof form.get("endDate") === "string" ? String(form.get("endDate")) : "");
    const tagId = form.get("tagId")?.toString()?.trim() ?? "";
    return NextResponse.json(
      {
        ok: true,
        data: {
          import: appended.importMeta,
          ...overviewPayload(startDate, endDate, tagId),
        },
      },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[canvassing/overview POST]", message);
    return NextResponse.json({ ok: false, error: message, code: 400 }, { status: 400 });
  }
}
