/** Compact SS / U / SO contact used to count unique PDI / PRIMARY IDs. */

export type UniqueIdChannel = "phone" | "text" | "canvass";

export type UniqueIdFamily = "strongSupport" | "undecided" | "strongOppose";

export type UniqueIdContactEvent = {
  personId: string;
  occurredAt: string;
  occurredOn: string;
  channel: UniqueIdChannel;
  family: UniqueIdFamily;
  campaignName: string;
  actorName: string;
};

export type UniqueIdFamilyCounts = {
  uniqueIds: number;
  strongSupport: number;
  undecided: number;
  strongOppose: number;
};

export type UniqueIdTransition = {
  from: UniqueIdFamily;
  to: UniqueIdFamily;
  count: number;
  personIds: string[];
};

export type UniqueIdChangedPerson = {
  personId: string;
  from: UniqueIdFamily;
  to: UniqueIdFamily;
  events: UniqueIdContactEvent[];
};

export type UniqueIdChangeSummary = {
  held: number;
  changed: number;
  transitions: UniqueIdTransition[];
  people: UniqueIdChangedPerson[];
};

export type UniqueIdRow = {
  personId: string;
  family: UniqueIdFamily;
  occurredOn: string;
  occurredAt: string;
  channel: UniqueIdChannel;
  channels: UniqueIdChannel[];
  campaignName: string;
  actorName: string;
  priorFamily: UniqueIdFamily | null;
  changed: boolean;
};

export type UniqueIdTallyOptions = {
  startDate?: string;
  endDate?: string;
  q?: string;
  family?: UniqueIdFamily | "";
  channel?: UniqueIdChannel | "";
  page?: number;
  pageSize?: number;
};

export type UniqueIdPagedRows = {
  total: number;
  page: number;
  pageSize: number;
  rows: UniqueIdRow[];
};

export type UniqueIdTally = {
  eventCount: number;
  uniqueIdCount: number;
  minDate: string;
  maxDate: string;
  combined: UniqueIdFamilyCounts;
  byChannel: Record<UniqueIdChannel, UniqueIdFamilyCounts>;
  changes: UniqueIdChangeSummary;
  ids: UniqueIdPagedRows;
  /** Full filtered ID list (CSV / export). Not sent on the JSON page payload. */
  matchedRows: UniqueIdRow[];
};

export type UniqueIdCandidateOption = {
  id: string;
  label: string;
};

export type UniqueIdCandidateSummary = {
  id: string;
  label: string;
  combined: UniqueIdFamilyCounts;
  byChannel: Record<UniqueIdChannel, UniqueIdFamilyCounts>;
  changes: UniqueIdChangeSummary;
};

export type UniqueIdOverviewMeta = {
  phoneUpdatedAt: string;
  textUpdatedAt: string;
  knockUpdatedAt: string;
  eventCount: number;
  uniqueIdCount: number;
  minDate: string;
  maxDate: string;
  knockRowCount: number;
  phoneError?: string;
  textError?: string;
};

export type UniqueIdOverviewPayload = {
  meta: UniqueIdOverviewMeta;
  candidates: UniqueIdCandidateOption[];
  combined: UniqueIdFamilyCounts;
  byChannel: Record<UniqueIdChannel, UniqueIdFamilyCounts>;
  changes: UniqueIdChangeSummary;
  candidateSummaries: UniqueIdCandidateSummary[];
  ids: UniqueIdPagedRows;
};
