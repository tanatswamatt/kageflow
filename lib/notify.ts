/**
 * Emails Pretan when something worth knowing happens (a new dealership signs up).
 * Uses Resend's API. Needs RESEND_API_KEY and ADMIN_NOTIFY_EMAIL set in Vercel; does nothing if they're missing.
 * Never throws: a failed notification must not break the user's sign-up.
 */
export async function notifyAdmin(subject: string, lines: string[]): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ADMIN_NOTIFY_EMAIL;
  if (!key || !to) return;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.NOTIFY_FROM ?? "Kageflow <no-reply@kageflow.co.za>",
        to: to.split(",").map((x) => x.trim()),
        subject,
        text: lines.join("\n"),
        html: `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">${lines.map((l) => `<p style="margin:0 0 8px">${esc(l)}</p>`).join("")}</div>`,
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    /* notification is best-effort */
  }
}
