import { NextResponse } from "next/server";
import type { DistrictScanResult } from "@/lib/district-classifier/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMN_ALIASES: Record<keyof DistrictScanResult["suggestedMapping"], string[]> = {
  address: ["address", "street address", "home address", "residence address", "addr"],
  city: ["city", "residence city"],
  state: ["state", "st"],
  zip: ["zip", "zip code", "zipcode", "postal code"],
  street_number: ["street #", "street number", "house number", "street num"],
  street_name: ["street name", "street"],
  apartment: ["apt #", "apt", "apartment", "unit", "unit #"],
};

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === "\"") {
        if (line[i + 1] === "\"") {
          current += "\"";
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === "\"") {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

function canonical(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function suggestMapping(columns: string[]): DistrictScanResult["suggestedMapping"] {
  const byCanonical = new Map(columns.map((column) => [canonical(column), column]));
  const suggestions: DistrictScanResult["suggestedMapping"] = {};
  for (const [target, aliases] of Object.entries(COLUMN_ALIASES) as Array<[keyof DistrictScanResult["suggestedMapping"], string[]]>) {
    for (const alias of aliases) {
      const match = byCanonical.get(canonical(alias));
      if (match) {
        suggestions[target] = match;
        break;
      }
    }
  }
  return suggestions;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Missing CSV file.", code: 400 }, { status: 400 });
    }

    const text = await file.text();
    const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(Boolean);
    const columns = parseCsvLine(lines[0] ?? "");
    const firstValues = parseCsvLine(lines[1] ?? "");
    const firstRow: Record<string, string> = {};
    columns.forEach((column, index) => {
      firstRow[column] = firstValues[index] ?? "";
    });

    const scan: DistrictScanResult = {
      columns,
      firstRow,
      suggestedMapping: suggestMapping(columns),
      districtMenus: {
        congressional: "Congressional District",
        state_senate: "State Senate District",
        assembly: "Assembly District",
        city_council: "City Council District",
        county_supervisor: "County Supervisor District",
      },
    };

    return NextResponse.json({ ok: true, data: { scan } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message, code: 500 }, { status: 500 });
  }
}
