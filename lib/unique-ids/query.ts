import type { UniqueIdChannel, UniqueIdFamily } from "./types";
import { UNIQUE_ID_CHANNELS, UNIQUE_ID_FAMILIES } from "./classify";

export type UniqueIdOverviewQuery = {
  startDate: string;
  endDate: string;
  tagId: string;
  q: string;
  family: UniqueIdFamily | "";
  channel: UniqueIdChannel | "";
  page: number;
  pageSize: number;
  format: "json" | "csv";
};

function readDate(raw: string | null): string {
  const value = raw?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function readFamily(raw: string | null): UniqueIdFamily | "" {
  const value = raw?.trim() ?? "";
  return UNIQUE_ID_FAMILIES.includes(value as UniqueIdFamily) ? (value as UniqueIdFamily) : "";
}

function readChannel(raw: string | null): UniqueIdChannel | "" {
  const value = raw?.trim() ?? "";
  return UNIQUE_ID_CHANNELS.includes(value as UniqueIdChannel) ? (value as UniqueIdChannel) : "";
}

function readPositiveInt(raw: string | null, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

export function parseUniqueIdOverviewQuery(url: URL): UniqueIdOverviewQuery {
  return {
    startDate: readDate(url.searchParams.get("startDate")),
    endDate: readDate(url.searchParams.get("endDate")),
    tagId: url.searchParams.get("tagId")?.trim() ?? "",
    q: url.searchParams.get("q")?.trim() ?? "",
    family: readFamily(url.searchParams.get("family")),
    channel: readChannel(url.searchParams.get("channel")),
    page: readPositiveInt(url.searchParams.get("page"), 1),
    pageSize: readPositiveInt(url.searchParams.get("pageSize"), 100),
    format: url.searchParams.get("format")?.trim() === "csv" ? "csv" : "json",
  };
}

export function parseUniqueIdOverviewForm(form: FormData): UniqueIdOverviewQuery {
  const get = (key: string): string | null => {
    const value = form.get(key);
    return typeof value === "string" ? value : null;
  };
  return {
    startDate: readDate(get("startDate")),
    endDate: readDate(get("endDate")),
    tagId: get("tagId")?.trim() ?? "",
    q: get("q")?.trim() ?? "",
    family: readFamily(get("family")),
    channel: readChannel(get("channel")),
    page: readPositiveInt(get("page"), 1),
    pageSize: readPositiveInt(get("pageSize"), 100),
    format: "json",
  };
}
