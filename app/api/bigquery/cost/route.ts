import { NextResponse } from "next/server";
import { readBqMonthCost } from "@/lib/bq-cost-log";

/** Month-to-date BigQuery spend for the dashboard service account, from the local job log. */
export async function GET() {
  return NextResponse.json(readBqMonthCost());
}
