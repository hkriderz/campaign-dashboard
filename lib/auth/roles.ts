export const ROLES = ["viewer", "editor", "admin", "superadmin"] as const;

export type Role = (typeof ROLES)[number];

export const ASSIGNABLE_ROLES = ["viewer", "editor", "admin"] as const;

export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function isAssignableRole(value: unknown): value is AssignableRole {
  return typeof value === "string" && (ASSIGNABLE_ROLES as readonly string[]).includes(value);
}

const ROLE_LABELS: Record<Role, string> = {
  viewer: "Viewer",
  editor: "Editor",
  admin: "Admin",
  superadmin: "Superadmin",
};

export function roleLabel(role: Role): string {
  return ROLE_LABELS[role];
}

/** Campaign tags and PDI mapper / syncer. */
export function canEdit(role: Role): boolean {
  return role === "editor" || role === "admin" || role === "superadmin";
}

/** Settings and account management. */
export function canAdmin(role: Role): boolean {
  return role === "admin" || role === "superadmin";
}
