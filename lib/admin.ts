// Who may run the demo's shared operations: reset the demo for everyone and approve a supplier's claim.
//
// On a server that saves its state (DATABASE_URL set), only confirmed accounts whose email is listed in
// AGORA_ADMIN_EMAILS (comma-separated) may. On one that saves nothing, such as a local build or the rehearsal,
// any signed-in account may, since nothing it does outlives the process.

import type { User } from "./auth";

const admins = () =>
  (process.env.AGORA_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

export const savesState = () => Boolean(process.env.DATABASE_URL);

export function isAdmin(user: Pick<User, "email" | "verified"> | null | undefined): boolean {
  if (!user) return false;
  if (!savesState()) return true;
  return user.verified && admins().includes(user.email.toLowerCase());
}
