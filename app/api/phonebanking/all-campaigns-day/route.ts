import { NextRequest } from "next/server";
import { apiError, apiOk, errorMessage } from "@/lib/api/http";
import { buildAllCampaignsDayDashboard } from "@/lib/all-campaigns-day-dashboard";
import { isValidPhonebankingIsoDate } from "@/lib/queries/phonebanking";

/**
 * GET /api/phonebanking/all-campaigns-day?date=YYYY-MM-DD
 */
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date")?.trim() ?? "";

  if (!date) {
    return apiError("Missing query param: date", 400);
  }

  if (!isValidPhonebankingIsoDate(date)) {
    return apiError("Invalid date (expected YYYY-MM-DD)", 400);
  }

  try {
    const built = await buildAllCampaignsDayDashboard(date);
    if ("error" in built) {
      return apiError(built.error, 400);
    }
    return apiOk({ date, dashboard: built });
  } catch (err) {
    const message = errorMessage(err);
    console.error("[/api/phonebanking/all-campaigns-day]", message);
    return apiError(message, 500);
  }
}
