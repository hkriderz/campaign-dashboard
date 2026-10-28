import { canvasserIdentityKey, preferredCanvasserName } from "./display-names";
import { answerMatches, canonical, flagCountThreshold, shortDispositionLabel } from "./doorknocks-results/helpers";
import type { CanvassingKnockEvent } from "./types";

export type KnockDispositionFlag = {
  canvasserName: string;
  label: string;
  count: number;
};

export type KnockSupportCount = {
  canvasserName: string;
  strongSupport: number;
  undecided: number;
  strongOppose: number;
  answered: number;
};

export function isKnockNonContactQuestion(question: string): boolean {
  return canonical(question).includes("non contact");
}

/** A gap ends in a contact only when the next row is not the non-contact question. */
export function isLikelyContactKnock(question: string, response: string): boolean {
  if (isKnockNonContactQuestion(question)) return false;
  const normalized = response.trim().toLowerCase();
  if (!normalized) return false;
  return !/(not home|no answer|answering machine|voicemail|wrong number|moved|deceased|refused|declined|dnc|do not contact|language)/i.test(
    normalized
  );
}

function personKey(name: string): string {
  return canvasserIdentityKey(name) || name.trim().toLowerCase();
}

export function buildKnockDispositionFlags(events: CanvassingKnockEvent[]): KnockDispositionFlag[] {
  const counts = new Map<string, Map<string, number>>();
  const names = new Map<string, string[]>();

  for (const event of events) {
    if (!isKnockNonContactQuestion(event.question)) continue;
    const label = shortDispositionLabel(event.response);
    if (canonical(label).includes("not home")) continue;
    const key = personKey(event.canvasserName);
    const nameList = names.get(key) ?? [];
    nameList.push(event.canvasserName);
    names.set(key, nameList);
    const byLabel = counts.get(key) ?? new Map<string, number>();
    byLabel.set(label, (byLabel.get(label) ?? 0) + 1);
    counts.set(key, byLabel);
  }

  const flags: KnockDispositionFlag[] = [];
  for (const [key, byLabel] of counts) {
    const canvasserName = preferredCanvasserName(names.get(key) ?? []);
    for (const [label, count] of byLabel) {
      if (count < flagCountThreshold(label)) continue;
      flags.push({ canvasserName, label, count });
    }
  }

  return flags.sort(
    (a, b) => a.canvasserName.localeCompare(b.canvasserName) || a.label.localeCompare(b.label)
  );
}

/**
 * First script question that has a Strong Support response anywhere in the file.
 * Lit observation and flyer questions stay out because they never record Strong Support.
 */
export function firstKnockSupportQuestion(events: CanvassingKnockEvent[]): string | null {
  const seen = new Set<string>();
  const order: string[] = [];
  const chronological = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  for (const event of chronological) {
    const question = event.question.trim();
    if (!question || isKnockNonContactQuestion(question) || seen.has(question)) continue;
    seen.add(question);
    order.push(question);
  }
  return (
    order.find((question) =>
      events.some(
        (event) => event.question.trim() === question && answerMatches(event.response, ["strong support"])
      )
    ) ?? null
  );
}

export function buildKnockSupportCounts(
  events: CanvassingKnockEvent[],
  question: string | null
): KnockSupportCount[] {
  if (!question) return [];
  const byPerson = new Map<string, KnockSupportCount>();
  const seenDoor = new Set<string>();
  const chronological = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  for (const event of chronological) {
    if (event.question.trim() !== question) continue;
    const key = personKey(event.canvasserName);
    const door = `${key}|${event.primaryId || event.voter || String(event.sourceRowNumber)}`;
    if (seenDoor.has(door)) continue;
    seenDoor.add(door);

    const current = byPerson.get(key) ?? {
      canvasserName: event.canvasserName,
      strongSupport: 0,
      undecided: 0,
      strongOppose: 0,
      answered: 0,
    };
    current.canvasserName = preferredCanvasserName([current.canvasserName, event.canvasserName]);
    current.answered += 1;
    if (answerMatches(event.response, ["strong support"])) current.strongSupport += 1;
    else if (answerMatches(event.response, ["undecided"])) current.undecided += 1;
    else if (answerMatches(event.response, ["strong oppose"])) current.strongOppose += 1;
    byPerson.set(key, current);
  }

  return [...byPerson.values()].sort((a, b) => a.canvasserName.localeCompare(b.canvasserName));
}
