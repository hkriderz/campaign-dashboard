/**
 * Named canvasser and phonebanker groups shared by the QC table and both overviews.
 * Stored in localStorage. Create, add, and delete are pure so tests skip the browser.
 */

export type ActorGroupRole = "canvasser" | "phonebanker";

export type ActorGroup = {
  id: string;
  name: string;
  members: string[];
};

export const CANVASSER_ACTOR_GROUPS_STORAGE_KEY = "campaign-dashboard:actor-groups:canvasser:v1";
export const PHONEBANKER_ACTOR_GROUPS_STORAGE_KEY = "campaign-dashboard:actor-groups:phonebanker:v1";

export function actorGroupStorageKey(role: ActorGroupRole): string {
  return role === "canvasser" ? CANVASSER_ACTOR_GROUPS_STORAGE_KEY : PHONEBANKER_ACTOR_GROUPS_STORAGE_KEY;
}

function uniqueMembers(members: readonly string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const member of members) {
    const trimmed = member.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(trimmed);
  }
  return next;
}

function isActorGroup(value: unknown): value is ActorGroup {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<ActorGroup>;
  return typeof row.id === "string" && typeof row.name === "string" && Array.isArray(row.members);
}

export function parseActorGroups(raw: string | null): ActorGroup[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isActorGroup).map((group) => ({
      id: group.id,
      name: group.name.trim(),
      members: uniqueMembers(group.members.filter((member) => typeof member === "string")),
    })).filter((group) => group.id && group.name);
  } catch {
    return [];
  }
}

export function createActorGroup(
  groups: readonly ActorGroup[],
  name: string,
  members: readonly string[],
  id = `g-${groups.length + 1}`
): ActorGroup[] {
  const trimmed = name.trim();
  const people = uniqueMembers(members);
  if (!trimmed || people.length === 0) return [...groups];
  return [...groups, { id, name: trimmed, members: people }];
}

export function addMembersToActorGroup(
  groups: readonly ActorGroup[],
  groupId: string,
  members: readonly string[]
): ActorGroup[] {
  return groups.map((group) =>
    group.id === groupId ? { ...group, members: uniqueMembers([...group.members, ...members]) } : group
  );
}

export function deleteActorGroup(groups: readonly ActorGroup[], groupId: string): ActorGroup[] {
  return groups.filter((group) => group.id !== groupId);
}

export function loadActorGroups(role: ActorGroupRole): ActorGroup[] {
  if (typeof window === "undefined") return [];
  try {
    return parseActorGroups(window.localStorage.getItem(actorGroupStorageKey(role)));
  } catch {
    return [];
  }
}

export function saveActorGroups(role: ActorGroupRole, groups: readonly ActorGroup[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(actorGroupStorageKey(role), JSON.stringify(groups));
  } catch {
    // Private mode or a full quota should not break the filter.
  }
}
