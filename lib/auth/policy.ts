import type { AssignableRole, Role } from "./roles";
import { isAssignableRole } from "./roles";

export type AccountActor = {
  id: string;
  role: Role;
};

export type AccountMutation =
  | { action: "create"; role: unknown }
  | { action: "password" }
  | { action: "role"; role: unknown }
  | { action: "disable" }
  | { action: "delete" };

/**
 * Returns an error message when the actor may not perform the change.
 * Superadmin can change their own password. Nobody else can change that account.
 */
export function accountMutationError(
  actor: AccountActor,
  target: AccountActor | null,
  mutation: AccountMutation
): string | null {
  if (actor.role !== "admin" && actor.role !== "superadmin") {
    return "Only an admin can manage accounts.";
  }

  if (mutation.action === "create") {
    if (!isAssignableRole(mutation.role)) return "Role must be viewer, editor, or admin.";
    return null;
  }

  if (!target) return "Account not found.";

  const isSelf = actor.id === target.id;
  const targetIsSuperadmin = target.role === "superadmin";

  if (targetIsSuperadmin && !isSelf) {
    return "The superadmin account cannot be changed by another admin.";
  }

  if (targetIsSuperadmin && isSelf) {
    if (mutation.action === "password") return null;
    return "The superadmin account cannot be deleted, disabled, or demoted.";
  }

  if (mutation.action === "role" && !isAssignableRole(mutation.role)) {
    return "Role must be viewer, editor, or admin.";
  }

  if (isSelf && (mutation.action === "delete" || mutation.action === "disable" || mutation.action === "role")) {
    return "You cannot delete, disable, or change the role on your own account.";
  }

  return null;
}

export function isAssignableAccountRole(role: unknown): role is AssignableRole {
  return isAssignableRole(role);
}
