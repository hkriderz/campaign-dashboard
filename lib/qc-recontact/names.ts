/**
 * QC recontact name grouping.
 * Drops parentheticals and punctuation, treats "Last, First" as "First Last",
 * and keeps single-letter initials. No edit-distance matching.
 */

const PARENTHETICAL_RE = /\([^)]*\)/g;

export function recontactNameTokens(raw: string): string[] {
  const withoutParens = raw.replace(PARENTHETICAL_RE, " ");
  const cleaned = withoutParens.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const comma = cleaned.indexOf(",");
  const ordered = comma >= 0 ? `${cleaned.slice(comma + 1)} ${cleaned.slice(0, comma)}` : cleaned;
  return ordered
    .split(/\s+/)
    .map((part) => part.toLowerCase().replace(/[^a-z]/g, ""))
    .filter((token) => token.length > 0);
}

function hasInitial(tokens: readonly string[]): boolean {
  return tokens.some((token) => token.length === 1);
}

function tokenKey(tokens: readonly string[]): string {
  return [...tokens].sort().join("\0");
}

/** Same person for the Prior and QC caller filters. Initials stay distinct. */
export function recontactNamesMatch(leftRaw: string, rightRaw: string): boolean {
  const left = recontactNameTokens(leftRaw);
  const right = recontactNameTokens(rightRaw);
  if (!left.length || !right.length) return false;
  if (hasInitial(left) || hasInitial(right)) {
    return tokenKey(left) === tokenKey(right);
  }
  const glue = (tokens: readonly string[]) => tokens.join("");
  const glueSorted = (tokens: readonly string[]) => [...tokens].sort().join("");
  return glue(left) === glue(right) || glueSorted(left) === glueSorted(right);
}

/**
 * One dropdown label per matching cluster. The label is the longest original spelling.
 */
export function groupRecontactDisplayNames(names: readonly string[]): string[] {
  const groups: { display: string; members: string[] }[] = [];
  for (const name of names) {
    const trimmed = name.trim().replace(/\s+/g, " ");
    if (!trimmed) continue;
    const existing = groups.find((group) =>
      group.members.some((member) => recontactNamesMatch(member, trimmed))
    );
    if (!existing) {
      groups.push({ display: trimmed, members: [trimmed] });
      continue;
    }
    if (!existing.members.some((member) => member.toLowerCase() === trimmed.toLowerCase())) {
      existing.members.push(trimmed);
    }
    if (trimmed.length > existing.display.length) existing.display = trimmed;
  }
  return groups
    .map((group) => group.display)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
