const ANSWER_LABELS: Record<string, string> = {
  NH: "Not Home",
  MV: "Moved",
  HOSTILE: "Hostile",
  GTD: "Gated",
  D: "Deceased",
  DECL: "Declined Conversation",
  SS: "Strong Support",
  LS: "Lean Support",
  U: "Undecided",
  SO: "Strong Oppose",
  WTL8R: "Will Text Later",
  VRN: "Vote Right Now",
  LAT: "Will Vote Later",
  VIP: "Vote In Person",
  NO: "No Plan/Won't Vote",
  AV: "Already Voted",
  DRN: "Donate Now",
  WDL: "Will Donate Later",
  WND: "Will Not Donate",
  LB: "Language Barrier",
};

const CANVASS_CODES = new Set(["NH", "MV", "HOSTILE", "GTD", "D", "DECL", "LB"]);
const VOTE_CODES = new Set(["VRN", "LAT", "VIP", "NO", "AV"]);
const DONATE_CODES = new Set(["DRN", "WDL", "U", "WND"]);
const SUPPORT_TAIL_CODES = new Set(["LS", "U", "SO", "WTL8R"]);

export type PendingFlagCell = {
  index: number;
  code: string;
};

export type PendingFlagSegment = {
  kind: "canvass" | "question";
  codes: PendingFlagCell[];
};

export function pendingCodeKey(code: string): string {
  return code.trim().toUpperCase();
}

export function labelForPendingCode(code: string): string {
  const trimmed = code.trim();
  if (!trimmed) return trimmed;
  return ANSWER_LABELS[pendingCodeKey(trimmed)] ?? trimmed;
}

export function isNonContactGroupLabel(label: string): boolean {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "").startsWith("noncontact");
}

const SURVEY_START_CODES = new Set(["SS", "LS", "VRN", "DRN"]);

/**
 * Pending Approval group headers are often one column early. The non-contact
 * span is every flag column up to the first question header. A question header
 * sitting on a canvass code still belongs to the non-contact column under it.
 * Codes in that span stay non-contact even when they are not in CANVASS_CODES.
 */
export function splitLeadingNonContact(
  cells: PendingFlagCell[],
  groupAt: (columnIndex: number) => string
): { nonContact: PendingFlagCell[]; rest: PendingFlagCell[] } {
  let end = cells.length;
  for (let i = 0; i < cells.length; i++) {
    const group = groupAt(cells[i]!.index) ?? "";
    if (!group || isNonContactGroupLabel(group)) continue;
    const onCanvassCode = CANVASS_CODES.has(pendingCodeKey(cells[i]!.code));
    end = onCanvassCode ? i + 1 : i;
    break;
  }
  if (end === cells.length) {
    const start = cells.findIndex((cell) => SURVEY_START_CODES.has(pendingCodeKey(cell.code)));
    end = start < 0 ? cells.length : start;
  }
  return { nonContact: cells.slice(0, end), rest: cells.slice(end) };
}

/**
 * Group flag columns by code family. Pending Approval group headers are often
 * shifted one column early, so question titles are applied later in header order.
 */
export function segmentPendingFlagColumns(cells: PendingFlagCell[]): PendingFlagSegment[] {
  const segments: PendingFlagSegment[] = [];
  let index = 0;

  if (index < cells.length && CANVASS_CODES.has(pendingCodeKey(cells[index]!.code))) {
    const codes: PendingFlagCell[] = [];
    while (index < cells.length && CANVASS_CODES.has(pendingCodeKey(cells[index]!.code))) {
      codes.push(cells[index]!);
      index += 1;
    }
    segments.push({ kind: "canvass", codes });
  }

  while (index < cells.length) {
    const key = pendingCodeKey(cells[index]!.code);
    if (key === "VRN") {
      const codes: PendingFlagCell[] = [];
      while (index < cells.length && VOTE_CODES.has(pendingCodeKey(cells[index]!.code))) {
        codes.push(cells[index]!);
        index += 1;
      }
      segments.push({ kind: "question", codes });
      continue;
    }
    if (key === "DRN") {
      const codes: PendingFlagCell[] = [];
      while (index < cells.length && DONATE_CODES.has(pendingCodeKey(cells[index]!.code))) {
        codes.push(cells[index]!);
        index += 1;
      }
      segments.push({ kind: "question", codes });
      continue;
    }
    if (key === "SS" || key === "LS") {
      const codes: PendingFlagCell[] = [cells[index]!];
      index += 1;
      while (index < cells.length) {
        const next = pendingCodeKey(cells[index]!.code);
        if (next === "SS" || next === "VRN" || next === "DRN") break;
        if (!SUPPORT_TAIL_CODES.has(next)) break;
        codes.push(cells[index]!);
        index += 1;
      }
      segments.push({ kind: "question", codes });
      continue;
    }

    const codes: PendingFlagCell[] = [];
    while (index < cells.length) {
      const next = pendingCodeKey(cells[index]!.code);
      if (codes.length && (next === "SS" || next === "LS" || next === "VRN" || next === "DRN")) break;
      codes.push(cells[index]!);
      index += 1;
    }
    segments.push({ kind: "question", codes });
  }

  return segments;
}
