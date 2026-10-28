/**
 * Collision-aware display labels for dense canvassing tables.
 * Default: First + last initial (e.g. "Ashia A."). Expand last name when abbreviated keys collide.
 */

export type NameParts = {
  first: string;
  last: string;
  full: string;
};

/**
 * Collapse a doubled canvasser name.
 * "John Smith, John Smith" and "Smith, John Smith" become "John Smith".
 * "John Smith John Smith" becomes "John Smith".
 * "Davila, Dilan" stays unchanged.
 */
export function cleanCanvasserName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";

  const comma = trimmed.indexOf(",");
  if (comma >= 0) {
    const last = trimmed.slice(0, comma).trim();
    const first = trimmed.slice(comma + 1).trim();
    if (!first) return last;
    if (first.toLowerCase() === last.toLowerCase()) return first;
    if (first.toLowerCase().endsWith(` ${last.toLowerCase()}`)) {
      const stripped = first.slice(0, first.length - last.length).trim();
      return stripped ? `${stripped} ${last}` : first;
    }
    return trimmed;
  }

  const tokens = trimmed.split(/\s+/);
  if (tokens.length >= 2 && tokens.length % 2 === 0) {
    const half = tokens.length / 2;
    const left = tokens.slice(0, half).join(" ");
    const right = tokens.slice(half).join(" ");
    if (left.toLowerCase() === right.toLowerCase()) return left;
  }
  return trimmed;
}

/** Same person regardless of comma placement or first/last order. */
export function canvasserIdentityKey(name: string): string {
  return cleanCanvasserName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

export function preferredCanvasserName(names: string[]): string {
  const cleaned = names.map((name) => cleanCanvasserName(name)).filter(Boolean);
  if (!cleaned.length) return "";
  const withoutComma = cleaned.find((name) => !name.includes(","));
  if (withoutComma && cleaned.some((name) => name.includes(","))) return withoutComma;
  return cleaned[0]!;
}

export function splitDisplayName(fullName: string): NameParts {
  const original = fullName.trim().replace(/\s+/g, " ");
  const trimmed = cleanCanvasserName(original);
  if (!trimmed) return { first: "", last: "", full: "" };

  const commaIndex = trimmed.indexOf(",");
  if (commaIndex >= 0) {
    const last = trimmed.slice(0, commaIndex).trim();
    const first = trimmed.slice(commaIndex + 1).trim();
    return { first: first || last, last: last || first, full: trimmed };
  }

  const parts = trimmed.split(" ");
  if (parts.length === 1) {
    return { first: parts[0]!, last: "", full: trimmed };
  }
  const last = parts[parts.length - 1]!;
  const first = parts.slice(0, -1).join(" ");
  return { first, last, full: trimmed };
}

function abbreviate(parts: NameParts): string {
  if (!parts.first && !parts.last) return parts.full;
  if (!parts.last) return parts.first;
  const initial = parts.last[0] ? `${parts.last[0].toUpperCase()}.` : "";
  return `${parts.first} ${initial}`.trim();
}

/**
 * Build a map of full name → display label for a roster.
 * Colliding First+L. abbreviations expand to First Last for those names only.
 */
export function buildDisplayNameMap(fullNames: string[]): Map<string, string> {
  const unique = [...new Set(fullNames.map((name) => name.trim()).filter(Boolean))];
  const partsByFull = new Map(unique.map((full) => [full, splitDisplayName(full)] as const));

  const abbrevGroups = new Map<string, string[]>();
  for (const full of unique) {
    const parts = partsByFull.get(full)!;
    const key = abbreviate(parts).toLowerCase();
    const group = abbrevGroups.get(key) ?? [];
    group.push(full);
    abbrevGroups.set(key, group);
  }

  const result = new Map<string, string>();
  for (const full of unique) {
    const parts = partsByFull.get(full)!;
    const key = abbreviate(parts).toLowerCase();
    const group = abbrevGroups.get(key) ?? [full];
    if (group.length > 1) {
      result.set(full, parts.last ? `${parts.first} ${parts.last}`.trim() : parts.full);
    } else {
      result.set(full, abbreviate(parts));
    }
  }
  return result;
}

export function displayNameFor(fullName: string, map: Map<string, string>): string {
  return map.get(fullName.trim()) ?? fullName;
}
