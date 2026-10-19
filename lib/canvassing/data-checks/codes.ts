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
