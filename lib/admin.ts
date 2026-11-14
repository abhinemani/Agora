// Who may run the site: reset the demo, approve supplier claims, and manage accounts at /admin.
//
// On a server that saves its state (DATABASE_URL set), an admin is a confirmed, unsuspended account that is either
// listed in AGORA_ADMIN_EMAILS (comma-separated) or was made an admin by another admin at /admin. The listed ones
// are the root admins: the admin pages can't demote, suspend or delete them, so the site can't lose its last admin.
// On a server that saves nothing, such as a local build or the rehearsal, any signed-in account is an admin, since
// nothing it does outlives the process.

import type { User } from "./auth";

const admins = () =>
  (process.env.AGORA_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

export const savesState = () => Boolean(process.env.DATABASE_URL);

/** How many root admins are named on this server. */
export const rootAdminCount = () => admins().length;

export function isRootAdmin(user: Pick<User, "email"> | null | undefined): boolean {
  return Boolean(user && admins().includes(user.email.toLowerCase()));
}

export function isAdmin(user: (Pick<User, "email" | "verified"> & Partial<Pick<User, "granted_admin" | "disabled">>) | null | undefined): boolean {
  if (!user || user.disabled) return false;
  if (!savesState()) return true;
  return user.verified && (isRootAdmin(user) || Boolean(user.granted_admin));
}
