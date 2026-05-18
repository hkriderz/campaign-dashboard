import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import type { StwRow, StwData } from "@/lib/pdi-tools/types";
import { parseNdjson, buildStwData } from "@/lib/pdi-tools/parse-ndjson";
import { resolveNdjsonDataDir } from "@/lib/pdi-tools/resolve-ndjson-dir";
import { resolvePdiToolsCredentials } from "@/lib/pdi-tools/resolve-pdi-credentials";

const BQ_DATASET = process.env.BQ_DATASET ?? "l11_stw";

function SURVEY_QUERY(projectId: string): string {
  return `
  SELECT DISTINCT
    campaigns.name AS name,
    survey.question_name,
    survey.answer_value
  FROM \`${projectId}.${BQ_DATASET}.survey_results\` AS survey
  JOIN \`${projectId}.${BQ_DATASET}.campaigns\` AS campaigns
    ON survey.campaign_id = campaigns.id
  WHERE survey.question_name IS NOT NULL
    AND survey.answer_value IS NOT NULL
  ORDER BY campaigns.name, survey.question_name, survey.answer_value
`;
}

async function fetchFromBigQuery(): Promise<StwData> {
  const { BigQuery } = await import("@google-cloud/bigquery");

  const creds = resolvePdiToolsCredentials();
  if (!creds.gcpCredentialsPath) {
    throw new Error(
      "No GCP service account configured. Upload `gcp-service-account.json` in PDI Tools → Credentials, set GOOGLE_APPLICATION_CREDENTIALS in .env.local, or add a JSON key under the `credentials/` folder."
    );
  }

  const credentials = JSON.parse(fs.readFileSync(creds.gcpCredentialsPath, "utf-8"));

  const projectId =
    creds.gcpProjectId ?? process.env.GCP_PROJECT_ID ?? (credentials as { project_id?: string }).project_id;
  if (!projectId || typeof projectId !== "string") {
    throw new Error("GCP project id missing (expected in service account JSON or GCP_PROJECT_ID).");
  }

  const bq = new BigQuery({
    projectId,
    credentials,
  });

  const [rows] = await bq.query({ query: SURVEY_QUERY(projectId) });

  const stwRows: StwRow[] = rows.map((r: Record<string, string>) => ({
    name: r.name,
    question_name: r.question_name,
    answer_value: r.answer_value,
  }));

  return buildStwData(stwRows);
}

function loadCachedSurveys(): StwData {
  const dir = resolveNdjsonDataDir();
  if (!dir) {
    throw new Error(
      "No cached stw_surveys.ndjson found. Set PDI_TOOLS_DATA_DIR to a folder containing stw_surveys.ndjson and pdi_questions.ndjson, " +
        "or place those files in ../pdiv3 or ../MoonDough relative to the dashboard."
    );
  }
  const filePath = path.join(dir, "stw_surveys.ndjson");
  const text = fs.readFileSync(filePath, "utf-8");
  const rows = parseNdjson<StwRow>(text);
  return buildStwData(rows);
}

export async function GET(req: NextRequest) {
  const source = req.nextUrl.searchParams.get("source");

  try {
    let surveys: StwData;

    if (source === "cached") {
      surveys = loadCachedSurveys();
    } else {
      surveys = await fetchFromBigQuery();
    }

    return NextResponse.json({ surveys }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message, code: 500 }, { status: 500 });
  }
}
