// Sending email, through Resend. With no RESEND_API_KEY nothing is sent, and
// the app carries on: accounts still work, and people simply don't get the
// confirmation, reset or approval messages. Server-only.

const FROM = () => process.env.EMAIL_FROM || "Agora <no-reply@agora.ethoslabs.us>";

export const canSendEmail = () => Boolean(process.env.RESEND_API_KEY);

/** Where links in an email point: APP_URL when set, the live site on Railway, else the address the request came in on. */
export function appUrl(req?: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.RAILWAY_ENVIRONMENT) return "https://agora.ethoslabs.us";
  try {
    return req ? new URL(req.url).origin : "http://localhost:3000";
  } catch {
    return "http://localhost:3000";
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface Email {
  to: string;
  subject: string;
  /** Plain paragraphs. The HTML version is built from them. */
  lines: string[];
  /** One button, with its link also written out in the text version. */
  action?: { label: string; url: string };
}

function html(e: Email) {
  const p = e.lines.map((l) => `<p style="margin:0 0 14px;font:16px/1.5 'Public Sans',Arial,sans-serif;color:#1b1b1b">${esc(l)}</p>`).join("");
  const button = e.action
    ? `<p style="margin:22px 0"><a href="${esc(e.action.url)}" style="display:inline-block;background:#005ea2;color:#ffffff;font:bold 15px Arial,sans-serif;text-decoration:none;padding:12px 20px;border-radius:4px">${esc(e.action.label)}</a></p>` +
      `<p style="margin:0 0 14px;font:13px/1.5 Arial,sans-serif;color:#565c65">Or paste this link into your browser:<br>${esc(e.action.url)}</p>`
    : "";
  return `<div style="max-width:560px;margin:0 auto;padding:24px"><div style="border-top:4px solid #73b3e7;padding-top:20px"><p style="margin:0 0 18px;font:bold 20px Arial,sans-serif;color:#162e51">Agora</p>${p}${button}<p style="margin:24px 0 0;font:12px/1.5 Arial,sans-serif;color:#565c65">You're getting this because of an account at agora.ethoslabs.us. If that wasn't you, you can ignore this message.</p></div></div>`;
}

/** Send one message. Never throws: a failure is logged and reported as false. */
export async function sendEmail(e: Email): Promise<boolean> {
  const text = [...e.lines, ...(e.action ? [`${e.action.label}: ${e.action.url}`] : [])].join("\n\n");
  if (!canSendEmail()) {
    // Local runs and tests: say what would have gone out. The body, which holds sign-in links, is printed only when asked for.
    console.log(`[email] not sent (no RESEND_API_KEY): "${e.subject}" to ${e.to}${process.env.EMAIL_LOG === "1" ? `\n${text}` : ""}`);
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: FROM(), to: [e.to], subject: e.subject, text, html: html(e) }),
    });
    if (!res.ok) {
      console.error(`[email] Resend answered ${res.status} for "${e.subject}": ${(await res.text()).slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[email] couldn't send "${e.subject}":`, (err as Error).message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
