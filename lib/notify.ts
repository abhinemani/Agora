// The emails Agora sends: confirming an address, resetting a password, and
// the notices that move an approval along. Notices go only to people who have
// confirmed their address, and never hold up the action that triggered them.
// Server-only.

import { issueToken, mayEmail, staffAt, userById, type User } from "./auth";
import { appUrl, sendEmail } from "./email";

/** Send the "confirm your email" link. False when it wasn't sent (no email service, or too many in the last hour). */
export async function sendVerification(user: User, req?: Request): Promise<boolean> {
  if (user.verified || !mayEmail(user.email)) return false;
  const token = await issueToken(user.id, "verify");
  return sendEmail({
    to: user.email,
    subject: "Confirm your email for Agora",
    lines: [`Hello ${user.name},`, "Thanks for creating an Agora account. Confirm this is your email address, so we can send you approval notices and help you back in if you forget your password.", "The link works once and lasts three days."],
    action: { label: "Confirm my email", url: `${appUrl(req)}/verify?token=${token}` },
  });
}

/** Send a password-reset link. Says nothing to the caller about whether the account exists. */
export async function sendReset(user: User | null, req?: Request): Promise<void> {
  if (!user || !mayEmail(user.email)) return;
  const token = await issueToken(user.id, "reset");
  await sendEmail({
    to: user.email,
    subject: "Reset your Agora password",
    lines: [`Hello ${user.name},`, "Someone asked to reset the password for this Agora account. If it was you, choose a new password with the link below.", "The link works once and lasts one hour. If you didn't ask for this, you can ignore this message and your password stays as it is."],
    action: { label: "Choose a new password", url: `${appUrl(req)}/reset?token=${token}` },
  });
}

const later = (work: () => Promise<unknown>) => void work().catch((e) => console.error("[notify]", (e as Error).message));

/** Tell an agency's purchasing staff that something is waiting on them. */
export function tellPurchasing(agency: string | null | undefined, from: User | null | undefined, n: { subject: string; lines: string[]; path: string; label: string }) {
  if (!agency) return;
  later(async () => {
    for (const u of await staffAt(agency, "procurement")) {
      if (u.id === from?.id) continue;
      await sendEmail({ to: u.email, subject: n.subject, lines: [`Hello ${u.name},`, ...n.lines], action: { label: n.label, url: `${appUrl()}${n.path}` } });
    }
  });
}

/** Tell the person who started something what was decided. */
export function tellRequester(userId: string | null | undefined, by: User | null | undefined, n: { subject: string; lines: string[]; path: string; label: string }) {
  if (!userId || userId === by?.id) return;
  later(async () => {
    const u = await userById(userId);
    if (!u?.verified) return;
    await sendEmail({ to: u.email, subject: n.subject, lines: [`Hello ${u.name},`, ...n.lines], action: { label: n.label, url: `${appUrl()}${n.path}` } });
  });
}
