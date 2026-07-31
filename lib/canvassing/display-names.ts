/**
 * Collision-aware display labels for dense canvassing tables.
 * Default: First + last initial (e.g. "Ashia A."). Expand last name when abbreviated keys collide.
 */

export type NameParts = {
  first: string;
  last: string;
  full: string;
};

export function splitDisplayName(fullName: string): NameParts {
  const trimmed = fullName.trim().replace(/\s+/g, " ");
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
