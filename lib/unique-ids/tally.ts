import {
  channelDisplayLabel,
  compareEventsNewestFirst,
  compareEventsOldestFirst,
  familyDisplayLabel,
  UNIQUE_ID_CHANNELS,
} from "./classify";
import type {
  UniqueIdChannel,
  UniqueIdChangedPerson,
  UniqueIdChangeSummary,
  UniqueIdContactEvent,
  UniqueIdFamily,
  UniqueIdFamilyCounts,
  UniqueIdPagedRows,
  UniqueIdRow,
  UniqueIdTally,
  UniqueIdTallyOptions,
  UniqueIdTransition,
} from "./types";

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

export function emptyChangeSummary(): UniqueIdChangeSummary {
  return { held: 0, changed: 0, transitions: [], people: [] };
}

export function emptyFamilyCounts(): UniqueIdFamilyCounts {
  return {
    uniqueIds: 0,
    strongSupport: 0,
    undecided: 0,
    strongOppose: 0,
  };
}

export function emptyChannelCounts(): Record<UniqueIdChannel, UniqueIdFamilyCounts> {
  return {
    phone: emptyFamilyCounts(),
    text: emptyFamilyCounts(),
    canvass: emptyFamilyCounts(),
  };
}

function addFamily(counts: UniqueIdFamilyCounts, family: UniqueIdFamily): void {
  counts.uniqueIds += 1;
  counts[family] += 1;
}

export function filterEventsByDate(
  events: readonly UniqueIdContactEvent[],
  startDate?: string,
  endDate?: string
): UniqueIdContactEvent[] {
  const start = startDate?.trim() ?? "";
  const end = endDate?.trim() ?? "";
  return events.filter((event) => {
    const day = event.occurredOn.trim();
    if (!day) return false;
    if (start && day < start) return false;
    if (end && day > end) return false;
    return true;
  });
}

function eventDateBounds(events: readonly UniqueIdContactEvent[]): { minDate: string; maxDate: string } {
  const days = events.map((event) => event.occurredOn.trim()).filter(Boolean).sort();
  return { minDate: days[0] ?? "", maxDate: days[days.length - 1] ?? "" };
}

function clampPageSize(raw: number | undefined): number {
  const n = Number.isFinite(raw) ? Math.floor(raw as number) : DEFAULT_PAGE_SIZE;
  if (n < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(n, MAX_PAGE_SIZE);
}

function matchesRowFilters(
  row: UniqueIdRow,
  options: UniqueIdTallyOptions
): boolean {
  const q = (options.q ?? "").trim().replace(/\s+/g, "").toUpperCase();
  if (q && !row.personId.includes(q)) return false;
  const family = options.family;
  if (family && row.family !== family) return false;
  const channel = options.channel;
  if (channel && !row.channels.includes(channel)) return false;
  return true;
}

function emptyPaged(page: number, pageSize: number): UniqueIdPagedRows {
  return { total: 0, page, pageSize, rows: [] };
}

export function emptyTally(options: UniqueIdTallyOptions = {}): UniqueIdTally {
  const pageSize = clampPageSize(options.pageSize);
  const page = Math.max(1, options.page ?? 1);
  return {
    eventCount: 0,
    uniqueIdCount: 0,
    minDate: "",
    maxDate: "",
    combined: emptyFamilyCounts(),
    byChannel: emptyChannelCounts(),
    changes: emptyChangeSummary(),
    ids: emptyPaged(page, pageSize),
    matchedRows: [],
  };
}

/**
 * Latest SS / U / SO per unique person ID. Combined uses the newest event across
 * channels; byChannel uses the newest event on that channel. Change is first vs
 * last family inside the date-filtered events.
 */
export function tallyUniqueIds(
  events: readonly UniqueIdContactEvent[],
  options: UniqueIdTallyOptions = {}
): UniqueIdTally {
  const pageSize = clampPageSize(options.pageSize);
  const page = Math.max(1, options.page ?? 1);
  const bounds = eventDateBounds(events);
  const filtered = filterEventsByDate(events, options.startDate, options.endDate);

  const byPerson = new Map<string, UniqueIdContactEvent[]>();
  for (const event of filtered) {
    const personId = event.personId.trim();
    if (!personId || !/[A-Z0-9]/i.test(personId)) continue;
    const list = byPerson.get(personId) ?? [];
    list.push(event);
    byPerson.set(personId, list);
  }

  const combined = emptyFamilyCounts();
  const byChannel = emptyChannelCounts();
  const transitionMap = new Map<string, UniqueIdTransition>();
  const people: UniqueIdChangedPerson[] = [];
  let held = 0;
  let changed = 0;
  const rows: UniqueIdRow[] = [];

  for (const [personId, list] of byPerson) {
    const newestFirst = [...list].sort(compareEventsNewestFirst);
    const oldestFirst = [...list].sort(compareEventsOldestFirst);
    const latest = newestFirst[0];
    const first = oldestFirst[0];
    if (!latest || !first) continue;

    const didChange = first.family !== latest.family;
    if (didChange) {
      changed += 1;
      const key = `${first.family}|${latest.family}`;
      const existing = transitionMap.get(key);
      if (existing) {
        existing.count += 1;
        existing.personIds.push(personId);
      } else {
        transitionMap.set(key, {
          from: first.family,
          to: latest.family,
          count: 1,
          personIds: [personId],
        });
      }
      people.push({
        personId,
        from: first.family,
        to: latest.family,
        events: oldestFirst,
      });
    } else {
      held += 1;
    }

    addFamily(combined, latest.family);

    const latestByChannel = new Map<UniqueIdChannel, UniqueIdContactEvent>();
    for (const event of newestFirst) {
      if (!latestByChannel.has(event.channel)) latestByChannel.set(event.channel, event);
    }
    for (const [channel, event] of latestByChannel) {
      addFamily(byChannel[channel], event.family);
    }

    const channels = UNIQUE_ID_CHANNELS.filter((channel) => latestByChannel.has(channel));
    rows.push({
      personId,
      family: latest.family,
      occurredOn: latest.occurredOn,
      occurredAt: latest.occurredAt,
      channel: latest.channel,
      channels,
      campaignName: latest.campaignName,
      actorName: latest.actorName,
      priorFamily: didChange ? first.family : null,
      changed: didChange,
    });
  }

  const matched = rows
    .filter((row) => matchesRowFilters(row, options))
    .sort((a, b) => a.personId.localeCompare(b.personId));
  const start = (page - 1) * pageSize;

  const transitions = [...transitionMap.values()]
    .map((row) => ({
      ...row,
      personIds: [...row.personIds].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      const fromCmp = a.from.localeCompare(b.from);
      if (fromCmp !== 0) return fromCmp;
      return a.to.localeCompare(b.to);
    });
  people.sort((a, b) => a.personId.localeCompare(b.personId));

  return {
    eventCount: filtered.length,
    uniqueIdCount: rows.length,
    minDate: bounds.minDate,
    maxDate: bounds.maxDate,
    combined,
    byChannel,
    changes: { held, changed, transitions, people },
    ids: {
      total: matched.length,
      page,
      pageSize,
      rows: matched.slice(start, start + pageSize),
    },
    matchedRows: matched,
  };
}

export function uniqueIdRowsToCsv(rows: readonly UniqueIdRow[]): string {
  const headers = [
    "PDI / PRIMARYID",
    "Latest label",
    "Latest date",
    "Latest time",
    "Latest channel",
    "Channels",
    "List / assignment",
    "Actor",
    "Prior label",
    "Changed",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    const cells = [
      row.personId,
      familyDisplayLabel(row.family),
      row.occurredOn,
      row.occurredAt,
      channelDisplayLabel(row.channel),
      row.channels.map(channelDisplayLabel).join("; "),
      row.campaignName,
      row.actorName,
      row.priorFamily ? familyDisplayLabel(row.priorFamily) : "",
      row.changed ? "Yes" : "No",
    ];
    lines.push(cells.map(csvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
