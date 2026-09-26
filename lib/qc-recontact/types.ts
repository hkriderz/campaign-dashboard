/**
 * QC recontact pairs: a QC call matched to prior contacts for the same voter PDI.
 * Priors may be phone-bank, canvass, and/or text; channels stay separate.
 */

export type RecontactChannel = "phonebank" | "canvass" | "text";

export type QcRecontactMatchStatus = "matched" | "unmatched" | "no_pdi";

/** Prior vs QC Final Result movement. `unknown` when a side has no classified result. */
export type QcRecontactChangeKind = "held" | "strengthened" | "softened" | "flipped" | "unknown";

export type RecontactChannelFilter = RecontactChannel;
export type RecontactOutcomeFilter = "held" | "strengthened" | "softened" | "flipped" | "no_reply";
export type RecontactMatchFilter = "unmatched" | "no_pdi";

/**
 * Independent multi-select groups. Empty group = no constraint.
 * Within a group = OR; across groups = AND.
 */
export type QcRecontactSelection = {
  channels: RecontactChannelFilter[];
  outcomes: RecontactOutcomeFilter[];
  matches: RecontactMatchFilter[];
  /** Empty string = all canvassers. */
  canvasser: string;
};

export type RecontactCallSummary = {
  callId: string;
  campaignId: string;
  campaignName: string;
  callDate: string;
  /** ISO datetime when available; used to order same-day calls. */
  callAt: string;
  phonebankerName: string;
  pdiId: string;
  /** Voter display name. Empty on snapshots saved before this field existed. */
  voterName: string;
  /** One-line street / city / state / zip from the QC callee record. */
  voterAddress: string;
  finalResultLabel: string;
  pollingLabel: string;
  canvassLabel: string;
  /** Script question that matched “were you contacted”. */
  contactedQuestion: string;
  contactedAnswer: string;
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
  /** STW Text `campaign_contacts.id` — used to load the conversation in the modal. */
  campaignContactId?: string;
  finalResultLabel?: string;
  pollingLabel?: string;
  canvassLabel?: string;
  /** Text only. Missing on older snapshots — those rows do not match No Reply. */
  hasInboundReply?: boolean;
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
  /** Knock-sheet VOTER column. Missing on indexes built before this field existed. */
  voterName?: string;
};

export type QcRecontactSurveyAnswer = {
  questionName: string;
  answerValue: string;
};

export type QcRecontactTextMessage = {
  at: string;
  direction: "outbound" | "inbound";
  body: string;
  actorName: string;
};

/** Compact STW Text contact used when pairing QC calls (no thread body). */
export type QcTextContactSummary = {
  campaignContactId: string;
  campaignId: string;
  campaignName: string;
  pdiId: string;
  texterName: string;
  occurredOn: string;
  occurredAt: string;
  resultLabel: string;
  hasMessages: boolean;
  /** Voter sent at least one inbound message. */
  hasInboundReply: boolean;
};

export type QcRecontactDetailPayload = {
  pair: QcRecontactPair;
  qcAnswers: QcRecontactSurveyAnswer[];
  priorAnswers: QcRecontactSurveyAnswer[];
  textThread: QcRecontactTextMessage[];
};
