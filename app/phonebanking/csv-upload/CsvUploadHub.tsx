"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import StwRawUploadPanel from "@/components/phonebanking/StwRawUploadPanel";
import WidePbImportPanel from "@/components/phonebanking/WidePbImportPanel";
import type { WidePbPrepareResult } from "@/lib/wide-csv-prepare";
import type { PhoneBankCsvRow } from "@/lib/types";
import { clearAllTombstonesForTag } from "@/lib/tombstone-client";

type TagOption = { id: string; label: string };

type SliceRow = {
  sliceKey: string;
  rowCount: number;
  phoneBankName: string;
  isoDate: string;
};

type TombstoneRow = {
  sliceKey: string;
  removedAt: string;
  reason: string;
  phoneBankName?: string;
  isoDate?: string;
};

type ScanSummary = {
  rowCount: number;
  dates: Array<{ iso: string; count: number }>;
  slices: SliceRow[];
  /** Set by preview API: roster vs wide crosstab. */
  csvKind?: "google_sheet_roster" | "wide_pb_crosstab";
};

type MetaResponse = {
  ok: boolean;
  data?: {
    tag: string;
    slices: SliceRow[];
    tombstones: TombstoneRow[];
    uploadedAt: string | null;
    replacePreviewRows?: PhoneBankCsvRow[];
  };
  error?: string;
};

/** Hub scope: merged CSV view across candidates. */
const HUB_ALL = "__all__" as const;
const SLICE_KEY_SEP = "\x1f";

type SliceRowView = SliceRow & { sourceTagId: string; sourceTagLabel: string };
type TombstoneView = TombstoneRow & { sourceTagId: string; sourceTagLabel: string };

function sliceCompositeKey(s: Pick<SliceRowView, "sourceTagId" | "sliceKey">): string {
  return `${s.sourceTagId}${SLICE_KEY_SEP}${s.sliceKey}`;
}

function parseSliceCompositeKey(k: string): { sourceTagId: string; sliceKey: string } | null {
  const i = k.indexOf(SLICE_KEY_SEP);
  if (i <= 0) return null;
  return { sourceTagId: k.slice(0, i), sliceKey: k.slice(i + SLICE_KEY_SEP.length) };
}

function slugifyTagId(label: string): string {
  const s = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s || `tag-${Date.now()}`;
}

const FOCUS_OPTIONS = [
  { id: "general", label: "General" },
  { id: "gotv", label: "GOTV" },
  { id: "violation", label: "Violation" },
] as const;

export default function CsvUploadHub({
  initialTagId,
  tags,
}: {
  initialTagId: string;
  tags: TagOption[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [hubTagId, setHubTagId] = useState(() => {
    const fromUrl = searchParams.get("tag")?.trim();
    if (fromUrl === "all" || fromUrl === "") return HUB_ALL;
    if (fromUrl && tags.some((t) => t.id === fromUrl)) return fromUrl;
    if (initialTagId === "all" || initialTagId === "") return HUB_ALL;
    if (initialTagId && tags.some((t) => t.id === initialTagId)) return initialTagId;
    return HUB_ALL;
  });

  const [importTagId, setImportTagId] = useState(() => tags[0]?.id ?? "");

  const [slices, setSlices] = useState<SliceRowView[]>([]);
  const [tombstones, setTombstones] = useState<TombstoneView[]>([]);
  const [uploadedAt, setUploadedAt] = useState<string | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);

  const [importSlices, setImportSlices] = useState<SliceRow[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [selectedSliceKeys, setSelectedSliceKeys] = useState<Set<string>>(() => new Set());
  const [scan, setScan] = useState<ScanSummary | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [overrideDate, setOverrideDate] = useState(false);
  const [targetIsoDate, setTargetIsoDate] = useState("");
  const [focus, setFocus] = useState<(typeof FOCUS_OPTIONS)[number]["id"]>("general");
  const [replaceMode, setReplaceMode] = useState(false);
  const [replaceSliceKey, setReplaceSliceKey] = useState("");
  const [replacePreview, setReplacePreview] = useState<PhoneBankCsvRow[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [ackTombstone, setAckTombstone] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"ok" | "err" | "warn">("ok");
  const [pendingTombstoneKeys, setPendingTombstoneKeys] = useState<string[]>([]);

  const [hubTab, setHubTab] = useState<"sheets" | "stw">("stw");
  const [sheetWideMeta, setSheetWideMeta] = useState<WidePbPrepareResult | null>(null);
  const [sheetWideCsv, setSheetWideCsv] = useState<string | null>(null);
  const [sheetWidePreparing, setSheetWidePreparing] = useState(false);
  /** Roster uploads: which calendar days to merge (from preview scan). */
  const [rosterImportDatesSelected, setRosterImportDatesSelected] = useState<Set<string>>(() => new Set());

  const [newTagOpen, setNewTagOpen] = useState(false);
  const [newTagId, setNewTagId] = useState("");
  const [newTagLabel, setNewTagLabel] = useState("");
  const [newTagTerms, setNewTagTerms] = useState("");
  const [newTagMode, setNewTagMode] = useState<"phonebanking" | "both">("phonebanking");
  const [newTagWriteKey, setNewTagWriteKey] = useState("");
  const [newTagBusy, setNewTagBusy] = useState(false);
  const [importFetchNonce, setImportFetchNonce] = useState(0);
  const [clearLogBusy, setClearLogBusy] = useState(false);

  const loadMeta = useCallback(async () => {
    setMetaLoading(true);
    try {
      if (hubTagId === HUB_ALL) {
        const merged: SliceRowView[] = [];
        const mergedTomb: TombstoneView[] = [];
        let latest: string | null = null;
        await Promise.all(
          tags.map(async (t) => {
            const res = await fetch(
              `/api/phonebanking/csv-upload?tag=${encodeURIComponent(t.id)}`,
              { cache: "no-store" }
            );
            const json = (await res.json()) as MetaResponse;
            if (!json.ok || !json.data) return;
            const up = json.data.uploadedAt;
            if (up && (!latest || up > latest)) latest = up;
            for (const s of json.data.slices) {
              merged.push({ ...s, sourceTagId: t.id, sourceTagLabel: t.label });
            }
            for (const row of json.data.tombstones) {
              mergedTomb.push({ ...row, sourceTagId: t.id, sourceTagLabel: t.label });
            }
          })
        );
        merged.sort((a, b) =>
          `${a.sourceTagLabel} ${a.phoneBankName} ${a.isoDate}`.localeCompare(
            `${b.sourceTagLabel} ${b.phoneBankName} ${b.isoDate}`
          )
        );
        mergedTomb.sort((a, b) => b.removedAt.localeCompare(a.removedAt));
        setSlices(merged);
        setTombstones(mergedTomb);
        setUploadedAt(latest);
        return;
      }

      const res = await fetch(
        `/api/phonebanking/csv-upload?tag=${encodeURIComponent(hubTagId)}`,
        { cache: "no-store" }
      );
      const json = (await res.json()) as MetaResponse;
      if (json.ok && json.data) {
        const label = tags.find((x) => x.id === hubTagId)?.label ?? hubTagId;
        setSlices(
          json.data.slices.map((s) => ({
            ...s,
            sourceTagId: hubTagId,
            sourceTagLabel: label,
          }))
        );
        setTombstones(
          json.data.tombstones.map((row) => ({
            ...row,
            sourceTagId: hubTagId,
            sourceTagLabel: label,
          }))
        );
        setUploadedAt(json.data.uploadedAt);
      }
    } finally {
      setMetaLoading(false);
    }
  }, [hubTagId, tags]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    if (!tags.length) return;
    setImportTagId((current) => {
      if (!current || !tags.some((t) => t.id === current)) {
        return tags[0]!.id;
      }
      return current;
    });
  }, [tags]);

  useEffect(() => {
    const tid = importTagId && tags.some((t) => t.id === importTagId) ? importTagId : tags[0]?.id;
    if (!tid) {
      setImportSlices([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/phonebanking/csv-upload?tag=${encodeURIComponent(tid)}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as MetaResponse;
      if (cancelled) return;
      if (json.ok && json.data?.slices) setImportSlices(json.data.slices);
      else setImportSlices([]);
    })();
    return () => {
      cancelled = true;
    };
  }, [importTagId, tags, importFetchNonce]);

  const validCompositeSet = useMemo(
    () => new Set(slices.map((s) => sliceCompositeKey(s))),
    [slices]
  );
  useEffect(() => {
    setSelectedSliceKeys((prev) => {
      const next = new Set<string>();
      for (const k of prev) {
        if (validCompositeSet.has(k)) next.add(k);
      }
      return next.size === prev.size && [...prev].every((k) => next.has(k)) ? prev : next;
    });
  }, [validCompositeSet]);

  const loadReplacePreview = useCallback(
    async (sk: string) => {
      if (!importTagId || !sk) {
        setReplacePreview([]);
        return;
      }
      setPreviewLoading(true);
      try {
        const res = await fetch(
          `/api/phonebanking/csv-upload?tag=${encodeURIComponent(importTagId)}&sliceKey=${encodeURIComponent(sk)}`,
          { cache: "no-store" }
        );
        const json = (await res.json()) as MetaResponse;
        if (json.ok && json.data?.replacePreviewRows) {
          setReplacePreview(json.data.replacePreviewRows);
        } else {
          setReplacePreview([]);
        }
      } finally {
        setPreviewLoading(false);
      }
    },
    [importTagId]
  );

  useEffect(() => {
    if (replaceMode && replaceSliceKey) {
      void loadReplacePreview(replaceSliceKey);
    } else {
      setReplacePreview([]);
    }
  }, [replaceMode, replaceSliceKey, loadReplacePreview]);

  useEffect(() => {
    const t = searchParams.get("tag")?.trim();
    if (!t || t === "all") {
      if (hubTagId !== HUB_ALL) setHubTagId(HUB_ALL);
      return;
    }
    if (tags.some((x) => x.id === t) && t !== hubTagId) {
      setHubTagId(t);
    }
  }, [searchParams, tags, hubTagId]);

  async function onPickFile(f: File | null) {
    setFile(f);
    setScan(null);
    setSheetWideMeta(null);
    setSheetWideCsv(null);
    setRosterImportDatesSelected(new Set());
    setPendingTombstoneKeys([]);
    setAckTombstone(false);
    setMessage("");
    if (!f) return;
    setScanLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/phonebanking/csv-upload/preview", {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (json.ok && json.data?.scan) {
        const s = json.data.scan as ScanSummary;
        setScan(s);
        const dateIsos = s.dates.map((d) => d.iso);
        setRosterImportDatesSelected(new Set(dateIsos));
        if (s.dates.length === 1) {
          setTargetIsoDate(s.dates[0]!.iso);
          setOverrideDate(false);
        } else if (s.dates.length > 1) {
          setTargetIsoDate(s.dates[0]!.iso);
          setOverrideDate(false);
        } else {
          setOverrideDate(true);
          setTargetIsoDate("");
        }

        if (s.csvKind === "wide_pb_crosstab" && importTagId) {
          setSheetWidePreparing(true);
          try {
            const prepFd = new FormData();
            prepFd.append("file", f);
            prepFd.append("tag", importTagId);
            const prepRes = await fetch("/api/phonebanking/csv-upload/wide-prepare", {
              method: "POST",
              body: prepFd,
            });
            const prepJson = await prepRes.json();
            if (prepJson.ok && prepJson.data) {
              setSheetWideMeta(prepJson.data as WidePbPrepareResult);
              setSheetWideCsv((prepJson.data as WidePbPrepareResult).wideCsv);
              setMessageTone("ok");
              setMessage(
                `Wide crosstab ready: ${(prepJson.data as WidePbPrepareResult).rowCount} row(s). Reorder columns and choose days below (same as Scale-to-Win).`
              );
            } else {
              setMessageTone("err");
              setMessage(prepJson.error ?? "Could not prepare wide CSV");
            }
          } finally {
            setSheetWidePreparing(false);
          }
        }
      } else {
        setMessageTone("err");
        setMessage(json.error ?? "Preview failed");
      }
    } catch (e) {
      setMessageTone("err");
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setScanLoading(false);
    }
  }

  async function onUpload() {
    if (!importTagId || !file) {
      setMessageTone("err");
      setMessage("Choose an import candidate and CSV file.");
      return;
    }
    if (replaceMode && !replaceSliceKey) {
      setMessageTone("err");
      setMessage("Select a phone bank to replace.");
      return;
    }
    if (!replaceMode && overrideDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetIsoDate.trim())) {
      setMessageTone("err");
      setMessage("Enter a valid target date (YYYY-MM-DD) or turn off date override.");
      return;
    }
    if (scan?.csvKind === "wide_pb_crosstab") {
      setMessageTone("err");
      setMessage("Wide crosstab files use the import panel below (phone bank name, column order, and day checkboxes).");
      return;
    }

    if (scan && scan.dates.length > 0) {
      const selected = scan.dates.map((d) => d.iso).filter((iso) => rosterImportDatesSelected.has(iso));
      if (selected.length === 0) {
        setMessageTone("err");
        setMessage("Select at least one calendar day to import.");
        return;
      }
    }

    setUploading(true);
    setMessage("");
    try {
      const fd = new FormData();
      fd.append("tag", importTagId);
      fd.append("file", file);
      fd.append("mode", replaceMode ? "replace" : "add");
      fd.append("focus", focus);
      if (!replaceMode && overrideDate && targetIsoDate.trim()) {
        fd.append("targetIsoDate", targetIsoDate.trim());
      }
      if (replaceMode && replaceSliceKey) {
        fd.append("replaceSliceKey", replaceSliceKey);
      }
      if (scan && scan.dates.length > 0) {
        const selected = scan.dates.map((d) => d.iso).filter((iso) => rosterImportDatesSelected.has(iso));
        fd.append("includedIsoDates", JSON.stringify(selected));
      }
      if (ackTombstone || pendingTombstoneKeys.length > 0) {
        fd.append("acknowledgeTombstone", "1");
      }

      const res = await fetch("/api/phonebanking/csv-upload", { method: "POST", body: fd });
      const json = await res.json();

      if (res.status === 409 && json.code === "TOMBSTONE_CONFLICT") {
        setMessageTone("warn");
        setMessage(json.error ?? "Tombstone conflict");
        setPendingTombstoneKeys(Array.isArray(json.sliceKeys) ? json.sliceKeys : []);
        setUploading(false);
        return;
      }

      if (!json.ok) {
        setMessageTone("err");
        setMessage(json.error ?? "Upload failed");
        return;
      }

      setMessageTone("ok");
      const d = json.data;
      const bumps = d.bumpedSlices?.length
        ? ` Renamed ${d.bumpedSlices.length} slice(s) to avoid overwriting existing data.`
        : "";
      const rep = d.replacedSlices?.length ? ` Replaced ${d.replacedSlices.length} slice(s).` : "";
      setMessage(
        `Saved: ${d.rowCount ?? 0} rows, ${d.sliceCount ?? 0} slice(s) total.${rep}${bumps}`
      );
      setPendingTombstoneKeys([]);
      setAckTombstone(false);
      setFile(null);
      setScan(null);
      setSheetWideMeta(null);
      setSheetWideCsv(null);
      setRosterImportDatesSelected(new Set());
      router.refresh();
      void loadMeta();
      setImportFetchNonce((n) => n + 1);
    } catch (e) {
      setMessageTone("err");
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  const allSlicesSelected =
    slices.length > 0 && selectedSliceKeys.size === slices.length;

  function toggleSliceSelected(composite: string) {
    setSelectedSliceKeys((prev) => {
      const next = new Set(prev);
      if (next.has(composite)) next.delete(composite);
      else next.add(composite);
      return next;
    });
  }

  function toggleSelectAllSlices() {
    if (allSlicesSelected) {
      setSelectedSliceKeys(new Set());
    } else {
      setSelectedSliceKeys(new Set(slices.map((s) => sliceCompositeKey(s))));
    }
  }

  async function onDeleteSelectedSlices() {
    const composites = [...selectedSliceKeys];
    if (composites.length === 0) {
      setMessageTone("err");
      setMessage("Select at least one phone bank using the checkboxes.");
      return;
    }
    if (
      !window.confirm(
        `Delete CSV data for ${composites.length} phone bank slice(s)?\n\nThis cannot be undone except by re-importing.`
      )
    ) {
      return;
    }
    try {
      const byTag = new Map<string, string[]>();
      for (const c of composites) {
        const p = parseSliceCompositeKey(c);
        if (!p) continue;
        const arr = byTag.get(p.sourceTagId) ?? [];
        arr.push(p.sliceKey);
        byTag.set(p.sourceTagId, arr);
      }
      let totalRows = 0;
      let totalSlices = 0;
      for (const [tid, sks] of byTag) {
        if (!sks.length) continue;
        const res = await fetch("/api/phonebanking/csv-upload", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tag: tid, sliceKeys: sks }),
        });
        const json = await res.json();
        if (!json.ok) {
          setMessageTone("err");
          setMessage(json.error ?? "Delete failed");
          return;
        }
        totalRows += json.data?.removedRows ?? 0;
        totalSlices += json.data?.removedSlices ?? 0;
      }
      setMessageTone("ok");
      setMessage(`Removed ${totalRows} row(s) across ${totalSlices} slice(s).`);
      setSelectedSliceKeys(new Set());
      if (
        replaceMode &&
        replaceSliceKey &&
        composites.includes(sliceCompositeKey({ sourceTagId: importTagId, sliceKey: replaceSliceKey }))
      ) {
        setReplaceSliceKey("");
        setReplacePreview([]);
      }
      void loadMeta();
      setImportFetchNonce((n) => n + 1);
      router.refresh();
    } catch (e) {
      setMessageTone("err");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  async function onDeleteAllSlices() {
    if (slices.length === 0) return;
    const tagIds =
      hubTagId === HUB_ALL
        ? [...new Set(slices.map((s) => s.sourceTagId))]
        : [hubTagId];
    if (
      !window.confirm(
        hubTagId === HUB_ALL
          ? `Delete ALL CSV phone bank slices for ${tagIds.length} candidate(s) shown below (${slices.length} slice(s))?\n\nThis cannot be undone except by re-importing.`
          : `Delete ALL ${slices.length} saved phone bank slice(s) for this candidate?\n\nThis cannot be undone except by re-importing.`
      )
    ) {
      return;
    }
    try {
      let totalRows = 0;
      let totalSlices = 0;
      for (const tid of tagIds) {
        const res = await fetch("/api/phonebanking/csv-upload", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tag: tid, deleteAll: true }),
        });
        const json = await res.json();
        if (!json.ok) {
          setMessageTone("err");
          setMessage(json.error ?? "Delete failed");
          return;
        }
        totalRows += json.data?.removedRows ?? 0;
        totalSlices += json.data?.removedSlices ?? 0;
      }
      setMessageTone("ok");
      setMessage(`Removed ${totalRows} row(s); ${totalSlices} slice(s) cleared.`);
      setSelectedSliceKeys(new Set());
      setReplaceSliceKey("");
      setReplacePreview([]);
      void loadMeta();
      setImportFetchNonce((n) => n + 1);
      router.refresh();
    } catch (e) {
      setMessageTone("err");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  async function onDeleteSlice(composite: string) {
    const p = parseSliceCompositeKey(composite);
    if (!p) return;
    const sl = slices.find(
      (s) => s.sourceTagId === p.sourceTagId && s.sliceKey === p.sliceKey
    );
    const label = sl
      ? `${hubTagId === HUB_ALL ? `[${sl.sourceTagLabel}] ` : ""}${sl.phoneBankName} (${sl.isoDate})`
      : p.sliceKey;
    if (
      !window.confirm(
        `Delete CSV data for this phone bank?\n\n${label}\n\nThis cannot be undone except by re-importing.`
      )
    ) {
      return;
    }
    try {
      const res = await fetch("/api/phonebanking/csv-upload", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag: p.sourceTagId, sliceKey: p.sliceKey }),
      });
      const json = await res.json();
      if (!json.ok) {
        setMessageTone("err");
        setMessage(json.error ?? "Delete failed");
        return;
      }
      setMessageTone("ok");
      setMessage(`Removed ${json.data?.removedRows ?? 0} row(s) for that phone bank.`);
      setSelectedSliceKeys((prev) => {
        const next = new Set(prev);
        next.delete(composite);
        return next;
      });
      if (importTagId === p.sourceTagId && replaceSliceKey === p.sliceKey) {
        setReplaceSliceKey("");
        setReplacePreview([]);
      }
      void loadMeta();
      setImportFetchNonce((n) => n + 1);
      router.refresh();
    } catch (e) {
      setMessageTone("err");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  async function onCreateTagAndUse() {
    const id = newTagId.trim() || slugifyTagId(newTagLabel);
    const label = newTagLabel.trim();
    const terms = newTagTerms
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (!label) {
      setMessageTone("err");
      setMessage("Enter a display label for the new candidate.");
      return;
    }
    setNewTagBusy(true);
    setMessage("");
    try {
      const headers: HeadersInit = { "Content-Type": "application/json" };
      const key = newTagWriteKey.trim();
      if (key) headers["x-campaign-tags-append-secret"] = key;
      const res = await fetch("/api/campaign-tags/append", {
        method: "POST",
        headers,
        body: JSON.stringify({
          id,
          label,
          searchTerms: terms.length ? terms : [label],
          mode: newTagMode,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setMessageTone("err");
        setMessage(json.error ?? "Could not create tag");
        return;
      }
      const createdId = json.data?.id as string;
      setMessageTone("ok");
      setMessage(`Created candidate tag "${json.data?.label ?? createdId}" and selected it for import.`);
      setNewTagOpen(false);
      setNewTagId("");
      setNewTagLabel("");
      setNewTagTerms("");
      setImportTagId(createdId);
      router.refresh();
    } catch (e) {
      setMessageTone("err");
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setNewTagBusy(false);
    }
  }

  const hubTagLabel = useMemo(
    () => (hubTagId === HUB_ALL ? "All candidates" : tags.find((t) => t.id === hubTagId)?.label ?? hubTagId),
    [tags, hubTagId]
  );

  const importTagLabel = useMemo(
    () => tags.find((t) => t.id === importTagId)?.label ?? importTagId,
    [tags, importTagId]
  );

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-16">
      <div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
          <Link href="/phonebanking" className="text-indigo-600 dark:text-indigo-400 hover:underline">
            ← Phone banking
          </Link>
        </p>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">CSV upload</h1>
        <p className="text-gray-600 dark:text-gray-400 text-sm mt-2">
          Merge phone bank data into the per-candidate CSV store used with BigQuery. Convert a{" "}
          <strong>Scale-to-Win raw</strong> export, or upload a <strong>Google Sheets</strong> roster or wide crosstab —
          wide files get the same column order and day filters on both tabs.
        </p>
      </div>

      <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Candidate</h2>
        <div className="flex flex-wrap gap-3 items-center">
          <label className="text-xs text-gray-600 dark:text-gray-400">
            Tag
            <select
              value={hubTagId}
              onChange={(e) => {
                const v = e.target.value;
                setHubTagId(v);
                const q = v === HUB_ALL ? "all" : v;
                router.replace(`/phonebanking/csv-upload?tag=${encodeURIComponent(q)}`);
              }}
              className="ml-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm"
            >
              <option value={HUB_ALL}>All candidates</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} ({t.id})
                </option>
              ))}
            </select>
          </label>
          {uploadedAt ? (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Newest CSV save in view: {uploadedAt}
            </span>
          ) : null}
          {metaLoading ? (
            <span className="text-xs text-gray-400">Loading slices…</span>
          ) : (
            <span className="text-xs text-gray-500">{slices.length} phone bank slice(s) in this view</span>
          )}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {hubTagId === HUB_ALL ? (
            <>
              Showing saved slices for <strong>every</strong> phone-banking candidate. Open a dashboard:{" "}
              {tags.map((t, i) => (
                <span key={t.id}>
                  {i > 0 ? " · " : null}
                  <Link className="text-indigo-600 hover:underline" href={`/phonebanking/${t.id}`}>
                    {t.label}
                  </Link>
                </span>
              ))}
            </>
          ) : (
            <>
              Dashboard for{" "}
              <Link className="text-indigo-600 hover:underline" href={`/phonebanking/${hubTagId}`}>
                {hubTagLabel}
              </Link>
            </>
          )}
        </p>
      </section>

      <div className="lg:grid lg:grid-cols-[1fr_17rem] lg:gap-6 lg:items-start space-y-6 lg:space-y-0">
        <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap gap-2 border-b border-gray-200 dark:border-gray-700 pb-2">
        <button
          type="button"
          onClick={() => setHubTab("stw")}
          className={[
            "rounded-lg px-3 py-1.5 text-sm font-semibold",
            hubTab === "stw"
              ? "bg-violet-600 text-white"
              : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800",
          ].join(" ")}
        >
          Scale-to-Win raw
        </button>
        <button
          type="button"
          onClick={() => setHubTab("sheets")}
          className={[
            "rounded-lg px-3 py-1.5 text-sm font-semibold",
            hubTab === "sheets"
              ? "bg-indigo-600 text-white"
              : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800",
          ].join(" ")}
        >
          Google Sheets CSV
        </button>
      </div>

      <section
        className={[
          "rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40 p-5 space-y-4",
          hubTab === "sheets" ? "" : "hidden",
        ].join(" ")}
        aria-hidden={hubTab !== "sheets"}
      >
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Upload CSV</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 -mt-2">
          Use the <strong>roster</strong> export (<code className="text-[10px]">Date</code>,{" "}
          <code className="text-[10px]">Phone bank</code>, caller columns) or a <strong>wide crosstab</strong> (
          <code className="text-[10px]">Caller Name</code>, <code className="text-[10px]">Date</code>, …). Wide files
          get the same column menu, day checkboxes, and import flow as Scale-to-Win. Roster uploads can filter by
          calendar day. By default data is <strong>added</strong>; use <strong>Replace</strong> to overwrite a slice.
        </p>

        <div>
          <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">File (.csv)</span>
          <div className="flex flex-wrap items-center gap-2 max-w-md">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="sr-only"
              onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm font-semibold text-gray-800 dark:text-gray-200 shadow-sm hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 dark:focus:ring-offset-gray-900"
            >
              Browse…
            </button>
            <span className="text-sm text-gray-600 dark:text-gray-400 truncate">
              {file ? file.name : "No file chosen"}
            </span>
          </div>
          {scanLoading || sheetWidePreparing ? (
            <p className="text-xs text-gray-500 mt-1">
              {sheetWidePreparing ? "Preparing wide crosstab…" : "Scanning file…"}
            </p>
          ) : null}
        </div>

        {sheetWideMeta && sheetWideCsv ? (
          <WidePbImportPanel
            key={`sheet-wide-${importTagId}-${sheetWideMeta.rowCount}`}
            tagId={importTagId}
            tagLabel={importTagLabel}
            slices={importSlices}
            meta={sheetWideMeta}
            wideCsv={sheetWideCsv}
            downloadPrefix="sheet-pb-report"
            resetOrderLabel="Reset to file order"
            orderHelpText="Default order: Caller, Date, time columns, script questions in file order, then Canvass Result columns last."
            showTagLink={false}
            onImportComplete={() => {
              void loadMeta();
              setImportFetchNonce((n) => n + 1);
              setFile(null);
              setScan(null);
              setSheetWideMeta(null);
              setSheetWideCsv(null);
              router.refresh();
            }}
          />
        ) : null}

        {scan ? (
          <div className="rounded-lg border border-gray-100 dark:border-gray-800 p-3 text-xs space-y-2 bg-gray-50/80 dark:bg-gray-800/30">
            <p className="font-semibold text-gray-800 dark:text-gray-200">Detected in file</p>
            <p>{scan.rowCount} data row(s)</p>
            {scan.dates.length > 0 ? (
              scan.csvKind === "wide_pb_crosstab" ? (
                <ul className="list-disc pl-4">
                  {scan.dates.map((d) => (
                    <li key={d.iso}>
                      {d.iso} — {d.count} row(s)
                    </li>
                  ))}
                </ul>
              ) : (
                <fieldset className="space-y-2 pt-1">
                  <legend className="text-[11px] font-semibold text-gray-800 dark:text-gray-200">
                    Calendar days to import
                  </legend>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {scan.dates.map((d) => (
                      <label key={d.iso} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          className="rounded border-gray-400"
                          checked={rosterImportDatesSelected.has(d.iso)}
                          onChange={() => {
                            setRosterImportDatesSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(d.iso)) next.delete(d.iso);
                              else next.add(d.iso);
                              return next;
                            });
                          }}
                        />
                        <span className="font-mono text-[11px]">
                          {d.iso} · {d.count} row(s)
                        </span>
                      </label>
                    ))}
                  </div>
                  {scan.dates.length > 1 ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setRosterImportDatesSelected(new Set(scan.dates.map((x) => x.iso)))
                        }
                        className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 hover:underline"
                      >
                        Select all days
                      </button>
                      <button
                        type="button"
                        onClick={() => setRosterImportDatesSelected(new Set())}
                        className="text-[11px] font-semibold text-gray-600 dark:text-gray-400 hover:underline"
                      >
                        Clear all
                      </button>
                    </div>
                  ) : null}
                </fieldset>
              )
            ) : (
              <p className="text-amber-700 dark:text-amber-300">No parseable dates in rows.</p>
            )}
            <p className="text-gray-600 dark:text-gray-400">
              Format:{" "}
              {scan.csvKind === "wide_pb_crosstab" ? (
                <>
                  <strong>Wide PB crosstab</strong> (Caller Name, Date, question columns)
                </>
              ) : (
                <>
                  <strong>Google Sheets roster</strong> (Date, Phone bank, Caller, …)
                </>
              )}
            </p>
            {scan.slices.length > 1 && scan.csvKind !== "wide_pb_crosstab" ? (
              <p className="text-amber-800 dark:text-amber-200">
                Multiple phone banks in one file — each slice is handled separately. Use date override to align them
                to one day if needed.
              </p>
            ) : null}
          </div>
        ) : null}

        {!sheetWideMeta ? (
        <>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-gray-700 dark:text-gray-300">Focus (add mode)</legend>
            {FOCUS_OPTIONS.map((o) => (
              <label key={o.id} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="focus"
                  checked={focus === o.id}
                  onChange={() => setFocus(o.id)}
                  disabled={replaceMode}
                />
                {o.label}
              </label>
            ))}
          </fieldset>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={overrideDate}
                onChange={(e) => setOverrideDate(e.target.checked)}
                disabled={replaceMode}
              />
              Override date (all rows use this day)
            </label>
            <input
              type="date"
              value={targetIsoDate}
              onChange={(e) => setTargetIsoDate(e.target.value)}
              disabled={replaceMode || !overrideDate}
              className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1 text-sm"
            />
            {!overrideDate && scan?.dates.length === 1 ? (
              <p className="text-[11px] text-gray-500">Using detected date {scan.dates[0]!.iso}</p>
            ) : null}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={replaceMode} onChange={(e) => setReplaceMode(e.target.checked)} />
          Replace an existing phone bank (same CSV format; incoming rows match that PB’s name and date)
        </label>

        {replaceMode ? (
          <div className="space-y-3 pl-1 border-l-2 border-violet-300 dark:border-violet-700 pl-3">
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              Slices on <strong>{importTagLabel}</strong> (import target).
            </p>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
              Phone bank to replace
              <select
                value={replaceSliceKey}
                onChange={(e) => setReplaceSliceKey(e.target.value)}
                className="mt-1 block w-full max-w-lg rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm"
              >
                <option value="">— Select —</option>
                {importSlices.map((s) => (
                  <option key={s.sliceKey} value={s.sliceKey}>
                    {s.phoneBankName} · {s.isoDate} ({s.rowCount} rows)
                  </option>
                ))}
              </select>
            </label>
            {previewLoading ? (
              <p className="text-xs text-gray-500">Loading current rows…</p>
            ) : replacePreview.length > 0 ? (
              <div className="overflow-x-auto max-h-64 overflow-y-auto rounded border border-gray-200 dark:border-gray-700 text-xs">
                <table className="min-w-full border-collapse">
                  <thead className="sticky top-0 bg-gray-100 dark:bg-gray-800">
                    <tr>
                      <th className="text-left p-1 border-b">Caller</th>
                      <th className="text-right p-1 border-b">Surveyed</th>
                      <th className="text-right p-1 border-b">Final SS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {replacePreview.slice(0, 80).map((r, i) => (
                      <tr key={i} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="p-1 whitespace-nowrap">{r.callerName}</td>
                        <td className="p-1 text-right">{r.surveyed}</td>
                        <td className="p-1 text-right">{r.finalSS}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {replacePreview.length > 80 ? (
                  <p className="p-2 text-gray-500">Showing 80 of {replacePreview.length} rows…</p>
                ) : null}
              </div>
            ) : replaceSliceKey ? (
              <p className="text-xs text-amber-700">No rows found for that slice.</p>
            ) : null}
          </div>
        ) : null}

        {pendingTombstoneKeys.length > 0 ? (
          <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50/80 dark:bg-amber-950/30 p-3 text-sm space-y-2">
            <p className="font-semibold text-amber-900 dark:text-amber-200">Previously removed from CSV</p>
            <p className="text-xs text-amber-900/90">
              Keys: {pendingTombstoneKeys.join(", ")}. Check the box below to confirm you want to restore this data.
            </p>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={ackTombstone} onChange={(e) => setAckTombstone(e.target.checked)} />
              I understand — clear the removal record and import
            </label>
          </div>
        ) : null}

        <button
          type="button"
          disabled={
            uploading ||
            !importTagId ||
            !file ||
            (pendingTombstoneKeys.length > 0 && !ackTombstone)
          }
          onClick={() => void onUpload()}
          className="rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 text-sm font-semibold"
        >
          {uploading ? "Uploading…" : replaceMode ? "Replace phone bank" : "Add to CSV store"}
        </button>
        </>
        ) : null}

        {message && hubTab === "sheets" ? (
          <p
            className={
              messageTone === "err"
                ? "text-sm text-red-700 dark:text-red-400"
                : messageTone === "warn"
                  ? "text-sm text-amber-800 dark:text-amber-200"
                  : "text-sm text-emerald-700 dark:text-emerald-400"
            }
          >
            {message}
          </p>
        ) : null}
      </section>

      <section
        className={[
          "rounded-xl border border-violet-200 dark:border-violet-900/50 bg-white dark:bg-gray-900/40 p-5 space-y-4",
          hubTab === "stw" ? "" : "hidden",
        ].join(" ")}
        aria-hidden={hubTab !== "stw"}
      >
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Scale-to-Win raw → PB report</h2>
        <StwRawUploadPanel
          tagId={importTagId}
          tagLabel={importTagLabel}
          slices={importSlices}
          onMetaRefresh={() => {
            void loadMeta();
            setImportFetchNonce((n) => n + 1);
            router.refresh();
          }}
        />
      </section>
        </div>

        <aside className="rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/40 dark:bg-indigo-950/25 p-4 space-y-3 text-sm lg:sticky lg:top-4 self-start">
          <h3 className="text-xs font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide">
            Import target
          </h3>
          <p className="text-[11px] leading-snug text-gray-600 dark:text-gray-400">
            Merges and STW reference headers use this candidate only — independent of the{" "}
            <strong>Candidate</strong> dropdown above (which controls the saved-slices list).
          </p>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
            Candidate for import
            <select
              value={importTagId}
              onChange={(e) => setImportTagId(e.target.value)}
              disabled={tags.length === 0}
              className="mt-1 block w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm"
            >
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} ({t.id})
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => setNewTagOpen((o) => !o)}
            className="w-full rounded-lg border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-xs font-semibold text-indigo-800 dark:text-indigo-200 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
          >
            {newTagOpen ? "Hide new tag form" : "＋ New campaign tag…"}
          </button>

          {newTagOpen ? (
            <div className="space-y-2 border-t border-indigo-200/70 dark:border-indigo-800/50 pt-3">
              <p className="text-[10px] leading-snug text-gray-600 dark:text-gray-400">
                Appends one row to <code className="rounded bg-white/80 dark:bg-gray-900/80 px-0.5">campaign-tags.json</code>.
                Server must allow writes: set{" "}
                <code className="text-[10px]">ALLOW_INSECURE_TAG_APPEND=1</code> for trusted local use, or set{" "}
                <code className="text-[10px]">CAMPAIGN_TAGS_APPEND_SECRET</code> and paste it below.
              </p>
              <label className="block text-[11px] font-medium text-gray-700 dark:text-gray-300">
                Display label <span className="text-red-600">*</span>
                <input
                  type="text"
                  value={newTagLabel}
                  onChange={(e) => setNewTagLabel(e.target.value)}
                  onBlur={() => {
                    if (!newTagId.trim() && newTagLabel.trim()) {
                      setNewTagId(slugifyTagId(newTagLabel));
                    }
                  }}
                  className="mt-0.5 block w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1 text-xs"
                  placeholder="e.g. NH Flyers QC"
                />
              </label>
              <label className="block text-[11px] font-medium text-gray-700 dark:text-gray-300">
                Tag id (slug)
                <input
                  type="text"
                  value={newTagId}
                  onChange={(e) => setNewTagId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  className="mt-0.5 block w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1 text-xs font-mono"
                  placeholder="auto from label"
                />
              </label>
              <label className="block text-[11px] font-medium text-gray-700 dark:text-gray-300">
                BigQuery / name hints (comma-separated)
                <input
                  type="text"
                  value={newTagTerms}
                  onChange={(e) => setNewTagTerms(e.target.value)}
                  className="mt-0.5 block w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1 text-xs"
                  placeholder="optional; defaults to label"
                />
              </label>
              <label className="block text-[11px] font-medium text-gray-700 dark:text-gray-300">
                Mode
                <select
                  value={newTagMode}
                  onChange={(e) => setNewTagMode(e.target.value as "phonebanking" | "both")}
                  className="mt-0.5 block w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1 text-xs"
                >
                  <option value="phonebanking">Phone banking</option>
                  <option value="both">Both (canvassing + phone)</option>
                </select>
              </label>
              <label className="block text-[11px] font-medium text-gray-700 dark:text-gray-300">
                Append secret (optional)
                <input
                  type="password"
                  autoComplete="off"
                  value={newTagWriteKey}
                  onChange={(e) => setNewTagWriteKey(e.target.value)}
                  className="mt-0.5 block w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1 text-xs"
                  placeholder="CAMPAIGN_TAGS_APPEND_SECRET"
                />
              </label>
              <button
                type="button"
                disabled={newTagBusy || !newTagLabel.trim()}
                onClick={() => void onCreateTagAndUse()}
                className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-2 py-1.5 text-xs font-semibold"
              >
                {newTagBusy ? "Creating…" : "Create tag & use for import"}
              </button>
            </div>
          ) : null}
        </aside>
      </div>

      <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40 p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Saved phone banks</h2>
          {slices.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={selectedSliceKeys.size === 0}
                onClick={() => void onDeleteSelectedSlices()}
                className="rounded-lg border border-red-200 dark:border-red-900/60 bg-white dark:bg-gray-900 px-3 py-1.5 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Delete selected
              </button>
              <button
                type="button"
                onClick={() => void onDeleteAllSlices()}
                className="rounded-lg bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 text-xs font-semibold"
              >
                Delete all
              </button>
            </div>
          ) : null}
        </div>
        {slices.length === 0 ? (
          <p className="text-sm text-gray-500">
            {hubTagId === HUB_ALL
              ? "No CSV slices stored for any phone-banking candidate yet."
              : "No slices yet for this candidate."}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800 border border-gray-100 dark:border-gray-800 rounded-lg overflow-hidden">
            <li className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/80">
              <input
                type="checkbox"
                className="rounded border-gray-300 dark:border-gray-600"
                checked={allSlicesSelected}
                onChange={toggleSelectAllSlices}
                aria-label="Select all phone banks"
              />
              <span>Select all</span>
            </li>
            {slices.map((s) => {
              const ck = sliceCompositeKey(s);
              return (
              <li
                key={ck}
                className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm justify-between"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300 dark:border-gray-600 shrink-0"
                    checked={selectedSliceKeys.has(ck)}
                    onChange={() => toggleSliceSelected(ck)}
                    aria-label={`Select ${s.phoneBankName} ${s.isoDate}`}
                  />
                  <div className="min-w-0">
                    {hubTagId === HUB_ALL ? (
                      <span className="text-[10px] uppercase tracking-wide text-indigo-600 dark:text-indigo-400 mr-1.5">
                        {s.sourceTagLabel}
                      </span>
                    ) : null}
                    <span className="font-medium text-gray-900 dark:text-gray-100">{s.phoneBankName}</span>
                    <span className="text-gray-500 text-xs ml-2">{s.isoDate}</span>
                    <span className="text-gray-400 text-xs ml-2">{s.rowCount} rows</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="text-xs text-red-600 dark:text-red-400 hover:underline shrink-0"
                  onClick={() => void onDeleteSlice(ck)}
                >
                  Delete
                </button>
              </li>
            );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Removal log (tombstones)</h2>
          {tombstones.length > 0 ? (
            <button
              type="button"
              disabled={clearLogBusy || metaLoading}
              className="text-xs font-medium rounded border border-gray-400 dark:border-gray-500 px-2.5 py-1 text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
              onClick={() => {
                void (async () => {
                  const scopeLabel =
                    hubTagId === HUB_ALL
                      ? `all ${tags.length} candidates`
                      : tags.find((t) => t.id === hubTagId)?.label ?? hubTagId;
                  if (
                    !confirm(
                      `Clear the removal log for ${scopeLabel} (${tombstones.length} entr${tombstones.length === 1 ? "y" : "ies"})?\n\nThis empties tombstone files on disk. Hidden slices will show on tag dashboards again. Deleted CSV rows are not restored.`
                    )
                  ) {
                    return;
                  }
                  setClearLogBusy(true);
                  setMessage("");
                  try {
                    const tagIds =
                      hubTagId === HUB_ALL ? tags.map((t) => t.id) : [hubTagId];
                    let total = 0;
                    for (const id of tagIds) {
                      total += await clearAllTombstonesForTag(id);
                    }
                    setMessageTone("ok");
                    setMessage(
                      total > 0
                        ? `Cleared ${total} tombstone entr${total === 1 ? "y" : "ies"} from the removal log.`
                        : "Removal log was already empty."
                    );
                    await loadMeta();
                    router.refresh();
                  } catch (e) {
                    setMessageTone("err");
                    setMessage(e instanceof Error ? e.message : String(e));
                  } finally {
                    setClearLogBusy(false);
                  }
                })();
              }}
            >
              {clearLogBusy ? "Clearing…" : "Clear removal log"}
            </button>
          ) : null}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 leading-snug">
          Records campaign-days removed via Delete or Hide on the dashboard. Same data as{" "}
          <code className="text-[10px]">data/phonebanking-csv-tombstones-&lt;tag&gt;.json</code>.
        </p>
        {tombstones.length === 0 ? (
          <p className="text-xs text-gray-500">No removed slices recorded.</p>
        ) : (
          <ul className="text-xs space-y-1 text-gray-600 dark:text-gray-400 max-h-48 overflow-y-auto">
            {tombstones.map((t) => (
              <li key={`${t.sourceTagId}-${t.sliceKey}-${t.removedAt}`}>
                {hubTagId === HUB_ALL ? (
                  <span className="text-[10px] uppercase text-indigo-600 dark:text-indigo-400 mr-1">
                    [{t.sourceTagLabel}]
                  </span>
                ) : null}
                <code className="text-[10px] bg-gray-100 dark:bg-gray-800 px-1 rounded">{t.sliceKey}</code> —{" "}
                {t.reason} at {new Date(t.removedAt).toLocaleString()}
                {t.phoneBankName ? ` (${t.phoneBankName})` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      {message ? (
        <p
          className={
            messageTone === "err"
              ? "text-sm text-red-700 dark:text-red-400"
              : messageTone === "warn"
                ? "text-sm text-amber-800 dark:text-amber-200"
                : "text-sm text-emerald-700 dark:text-emerald-400"
          }
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
