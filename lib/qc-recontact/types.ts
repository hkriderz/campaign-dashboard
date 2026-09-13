/**
 * QC recontact pairs: a QC call matched to prior contacts for the same voter PDI.
 * Priors may be phone-bank and/or canvass; channels stay separate.
 */

export type RecontactChannel = "phonebank" | "canvass";

export type QcRecontactMatchStatus = "matched" | "unmatched" | "no_pdi";

/** Prior vs QC Final Result movement. `unknown` when a side has no classified result. */
export type QcRecontactChangeKind = "held" | "strengthened" | "softened" | "flipped" | "unknown";

/**
 * Filter chips on Overview. Flip-strip cells use held / strengthened / softened / flipped.
 * `phonebank` / `canvass` keep rows that have that channel in `priors`.
 */
export type QcRecontactFilter =
  | "all"
  | "phonebank"
  | "canvass"
  | "changed"
  | "held"
  | "strengthened"
  | "softened"
  | "flipped"
  | "unmatched"
  | "no_pdi";

export type RecontactCallSummary = {
  callId: string;
  campaignId: string;
  campaignName: string;
  callDate: string;
  /** ISO datetime when available; used to order same-day calls. */
  callAt: string;
  phonebankerName: string;
  pdiId: string;
  finalResultLabel: string;
  pollingLabel: string;
  canvassLabel: string;
};

export type PriorContactSummary = {
  channel: RecontactChannel;
  pdiId: string;
  actorName: string;
  occurredOn: string;
  listOrAssignment: string;
  resultLabel: string;
  callId?: string;
  campaignId?: string;
  callAt?: string;
  finalResultLabel?: string;
  pollingLabel?: string;
  canvassLabel?: string;
};

export type QcRecontactPair = {
  pairId: string;
  qc: RecontactCallSummary;
  priors: PriorContactSummary[];
  matchStatus: QcRecontactMatchStatus;
  changeKind: QcRecontactChangeKind;
};

export type QcRecontactStats = {
  total: number;
  matched: number;
  unmatched: number;
  noPdi: number;
  held: number;
  strengthened: number;
  softened: number;
  flipped: number;
};

/** Compact knock row persisted in `data/canvassing-reports/knock-index.json`. */
export type QcCanvassKnockIndexRow = {
  primaryId: string;
  canvasserName: string;
  assignmentName: string;
  occurredAt: string;
  question: string;
  response: string;
  reportId: string;
  sourceFileName?: string;
};

export type QcRecontactSurveyAnswer = {
  questionName: string;
  answerValue: string;
};

export type QcRecontactDetailPayload = {
  pair: QcRecontactPair;
  qcAnswers: QcRecontactSurveyAnswer[];
  priorAnswers: QcRecontactSurveyAnswer[];
};
