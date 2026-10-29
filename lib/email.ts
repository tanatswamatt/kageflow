import "server-only";

/** Sender for every Kageflow email. The domain must be verified in Resend. Override with NOTIFY_FROM in Vercel. */
const DEFAULT_FROM = "Kageflow <no-reply@kageflow.co.za>";

type Mail = { to: string; subject: string; html: string; text: string; replyTo?: string | null; fromName?: string | null };

/** Turns "Kageflow <no-reply@kageflow.co.za>" into "Test Motors via Kageflow <no-reply@kageflow.co.za>" */
function fromAddress(fromName?: string | null) {
  const from = process.env.NOTIFY_FROM || process.env.EMAIL_FROM || DEFAULT_FROM;
  if (!fromName) return from;
  const address = from.match(/<([^>]+)>/)?.[1] ?? from;
  const name = fromName.replace(/[<>"\r\n]/g, "").slice(0, 60);
  return `"${name} via Kageflow" <${address}>`;
}

/**
 * Sends one email through Resend. Needs RESEND_API_KEY in Vercel.
 * Never throws: returns what went wrong in plain words so the screen can say it.
 */
export async function deliverEmail(input: Mail): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "Email isn't set up: RESEND_API_KEY is missing in Vercel" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromAddress(input.fromName),
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    console.error("Resend refused an email", res.status, body?.message);
    return { ok: false, error: `The email service said: ${body?.message ?? `error ${res.status}`}` };
  } catch (e) {
    console.error("Email send failed", e);
    return { ok: false, error: "Couldn't reach the email service. Try again in a minute" };
  }
}

/** Same as deliverEmail, as a yes/no, for callers that fall back to showing a link */
export async function sendEmail(input: Mail): Promise<boolean> {
  return (await deliverEmail(input)).ok;
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const shell = (body: string) => `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.55;color:#1a1d2e;max-width:520px">${body}</div>`;
const button = (href: string, label: string) =>
  `<p style="margin:0 0 20px"><a href="${href}" style="display:inline-block;background:#1e2346;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${label}</a></p>`;

/** An invoice, quote, order or credit note sent to a customer */
export function documentEmail(o: { company: string; label: string; number: string; message: string | null; link: string; total: string; due: string | null; companyEmail: string | null; companyPhone: string | null }) {
  const company = escapeHtml(o.company), link = escapeHtml(o.link), label = escapeHtml(o.label), number = escapeHtml(o.number);
  const intro = o.message?.trim() || `Please find ${o.label.toLowerCase()} ${o.number} from ${o.company}.`;
  const contact = [o.companyEmail, o.companyPhone].filter(Boolean).join(" · ");
  return {
    subject: `${o.label} ${o.number} from ${o.company}`,
    text: [intro, "", `${o.label} ${o.number}: ${o.total}${o.due ? `, due ${o.due}` : ""}`, `View, print or download: ${o.link}`, "", o.company, contact].filter((l) => l !== undefined).join("\n"),
    html: shell(`
<p style="font-size:20px;font-weight:600;margin:0 0 12px">${label} ${number}</p>
<p style="margin:0 0 16px;white-space:pre-line">${escapeHtml(intro)}</p>
<table style="border-collapse:collapse;margin:0 0 20px;font-size:15px"><tr><td style="padding:2px 16px 2px 0;color:#6f748b">Total</td><td style="padding:2px 0;font-weight:600">${escapeHtml(o.total)}</td></tr>${o.due ? `<tr><td style="padding:2px 16px 2px 0;color:#6f748b">Due</td><td style="padding:2px 0">${escapeHtml(o.due)}</td></tr>` : ""}</table>
${button(link, `View ${label.toLowerCase()}`)}
<p style="margin:0 0 8px;color:#4a4f66;font-size:13px">If the button doesn't work, paste this into your browser:<br>${link}</p>
<p style="margin:16px 0 0">${company}${contact ? `<br><span style="color:#6f748b;font-size:13px">${escapeHtml(contact)}</span>` : ""}</p>
<p style="margin:16px 0 0;color:#6f748b;font-size:12px">Reply to this email to reach ${company} directly.</p>`),
  };
}

const ROLE_WORDS: Record<string, string> = {
  owner: "an owner", admin: "an admin", accountant: "the accountant", sales: "a salesperson", viewer: "a viewer",
};

/** The team invitation email */
export function invitationEmail(o: { company: string; inviter: string; role: string; link: string }) {
  const company = escapeHtml(o.company), inviter = escapeHtml(o.inviter), link = escapeHtml(o.link);
  const role = ROLE_WORDS[o.role] ?? "a team member";
  return {
    subject: `${o.inviter} invited you to join ${o.company} on Kageflow`,
    text: `${o.inviter} has invited you to join ${o.company} on Kageflow as ${role}.\n\nAccept the invitation: ${o.link}\n\nThe link works once and expires in 7 days. If you weren't expecting this, you can ignore this email.`,
    html: shell(`
<p style="font-size:20px;font-weight:600;margin:0 0 12px">Join ${company} on Kageflow</p>
<p style="margin:0 0 16px">${inviter} has invited you to join <strong>${company}</strong> as ${role}. Kageflow is where the dealership runs its leads, stock, deals and books.</p>
${button(link, "Accept the invitation")}
<p style="margin:0 0 8px;color:#4a4f66;font-size:13px">The link works once and expires in 7 days. If the button doesn't work, paste this into your browser:<br>${link}</p>
<p style="margin:0;color:#6f748b;font-size:13px">If you weren't expecting this, you can ignore this email.</p>`),
  };
}
