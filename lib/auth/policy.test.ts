import test from "node:test";
import assert from "node:assert/strict";
import { accountMutationError } from "./policy";

const superadmin = { id: "super", role: "superadmin" as const };
const admin = { id: "admin", role: "admin" as const };
const otherAdmin = { id: "admin-2", role: "admin" as const };
const editor = { id: "editor", role: "editor" as const };

test("other admins cannot change the superadmin account", () => {
  assert.match(
    accountMutationError(admin, superadmin, { action: "password" }) ?? "",
    /superadmin/
  );
  assert.match(accountMutationError(admin, superadmin, { action: "delete" }) ?? "", /superadmin/);
  assert.match(accountMutationError(admin, superadmin, { action: "disable" }) ?? "", /superadmin/);
  assert.match(
    accountMutationError(admin, superadmin, { action: "role", role: "admin" }) ?? "",
    /superadmin/
  );
});

test("superadmin can change their own password and not their role", () => {
  assert.equal(accountMutationError(superadmin, superadmin, { action: "password" }), null);
  assert.match(
    accountMutationError(superadmin, superadmin, { action: "delete" }) ?? "",
    /cannot be deleted/
  );
  assert.match(
    accountMutationError(superadmin, superadmin, { action: "role", role: "admin" }) ?? "",
    /cannot be deleted/
  );
});

test("admins can set passwords for other staff, including themselves", () => {
  assert.equal(accountMutationError(admin, editor, { action: "password" }), null);
  assert.equal(accountMutationError(admin, otherAdmin, { action: "password" }), null);
  assert.equal(accountMutationError(admin, admin, { action: "password" }), null);
  assert.equal(accountMutationError(admin, editor, { action: "role", role: "admin" }), null);
  assert.equal(accountMutationError(superadmin, editor, { action: "delete" }), null);
});

test("nobody can create or promote another superadmin", () => {
  assert.match(accountMutationError(admin, null, { action: "create", role: "superadmin" }) ?? "", /viewer, editor, or admin/);
  assert.match(
    accountMutationError(superadmin, editor, { action: "role", role: "superadmin" }) ?? "",
    /viewer, editor, or admin/
  );
});

test("an admin cannot delete or demote their own account", () => {
  assert.match(accountMutationError(admin, admin, { action: "delete" }) ?? "", /own account/);
  assert.match(accountMutationError(admin, admin, { action: "disable" }) ?? "", /own account/);
  assert.match(accountMutationError(admin, admin, { action: "role", role: "viewer" }) ?? "", /own account/);
});
