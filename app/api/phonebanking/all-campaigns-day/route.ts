import { NextRequest } from "next/server";
import { apiError, withApiHandler } from "@/lib/api/http";
import { buildAllCampaignsDayDashboard } from "@/lib/all-campaigns-day-dashboard";
import { isValidPhonebankingIsoDate } from "@/lib/queries/phonebanking";
import { normalizeIsoDateRange } from "@/lib/validation/iso-date";

/**
 * GET /api/phonebanking/all-campaigns-day?date=YYYY-MM-DD
 * GET /api/phonebanking/all-campaigns-day?start=YYYY-MM-DD&end=YYYY-MM-DD
 */
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date")?.trim() ?? "";
  const startParam = req.nextUrl.searchParams.get("start")?.trim() ?? date;
  const endParam = req.nextUrl.searchParams.get("end")?.trim() ?? startParam;

  if (!startParam) {
    return apiError("Missing query param: date or start", 400);
  }

  if (!isValidPhonebankingIsoDate(startParam) || !isValidPhonebankingIsoDate(endParam)) {
    return apiError("Invalid date (expected YYYY-MM-DD)", 400);
  }
  const normalized = normalizeIsoDateRange(startParam, endParam);
  if (!normalized.ok) {
    return apiError(normalized.error, 400);
  }

  return withApiHandler(
    "/api/phonebanking/all-campaigns-day",
    async () => {
      const built = await buildAllCampaignsDayDashboard(normalized.startDate, normalized.endDate);
      if ("error" in built) {
        throw new Error(built.error);
      }
      return { date: normalized.startDate, start: normalized.startDate, end: normalized.endDate, dashboard: built };
    },
    { req, requireCredentials: { gcp: true } }
  );
}
