import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { withCredentialContext } from "@/lib/credentials";
import type { PdiQuestion } from "@/lib/pdi-tools/types";
import { parseNdjson } from "@/lib/pdi-tools/parse-ndjson";
import { resolveNdjsonDataDir } from "@/lib/pdi-tools/resolve-ndjson-dir";
import { resolvePdiToolsCredentials } from "@/lib/pdi-tools/resolve-pdi-credentials";

const PDI_BASE_URL = "https://api.bluevote.com";
const LIMIT_MAX = 2000;

async function getPdiSessionToken(): Promise<string> {
  const c = resolvePdiToolsCredentials();
  if (!c.pdiUsername || !c.pdiPassword || !c.pdiApiToken) {
    throw new Error(
      "PDI credentials missing. Upload credentials on the PDI Tools page for this browser session."
    );
  }

  const res = await fetch(`${PDI_BASE_URL}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      Username: c.pdiUsername,
      Password: c.pdiPassword,
      ApiToken: c.pdiApiToken,
    }),
  });

  if (!res.ok) {
    throw new Error(`PDI login failed: ${res.status} ${res.statusText}`);
  }

  const data: { AccessToken?: string } = await res.json();
  if (!data.AccessToken) {
    throw new Error("PDI login response missing AccessToken");
  }
  return data.AccessToken;
}

async function fetchAllPdiQuestions(token: string): Promise<PdiQuestion[]> {
  const allData: PdiQuestion[] = [];
  let cursor = 1;
  let totalCount: number | null = null;

  while (true) {
    const params = new URLSearchParams({
      cursor: String(cursor),
      limit: String(LIMIT_MAX),
    });

    const res = await fetch(`${PDI_BASE_URL}/questions?${params}`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      throw new Error(`PDI questions fetch failed: ${res.status} ${res.statusText}`);
    }

    const json: { totalCount?: number; data?: PdiQuestion[] } = await res.json();
    totalCount ??= json.totalCount ?? 0;
    const page: PdiQuestion[] = json.data ?? [];
    allData.push(...page);

    if (totalCount !== null && allData.length >= totalCount) break;
    if (page.length === 0) break;
    cursor++;
  }

  return allData;
}

function loadCachedQuestions(): PdiQuestion[] {
  const dir = resolveNdjsonDataDir();
  if (!dir) {
    throw new Error(
      "No cached pdi_questions.ndjson found. Set PDI_TOOLS_DATA_DIR or add NDJSON files under ../pdiv3."
    );
  }
  const filePath = path.join(dir, "pdi_questions.ndjson");
  const text = fs.readFileSync(filePath, "utf-8");
  return parseNdjson<PdiQuestion>(text);
}

export const GET = withCredentialContext(
  async (req) => {
    const source = new URL(req.url).searchParams.get("source");

    let questions: PdiQuestion[];

    if (source === "cached") {
      questions = loadCachedQuestions();
    } else {
      const token = await getPdiSessionToken();
      questions = await fetchAllPdiQuestions(token);
    }

    return NextResponse.json({ questions }, { status: 200 });
  },
  { pdi: true }
);
