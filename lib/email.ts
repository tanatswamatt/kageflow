import "server-only";

/**
 * Sends one email through Resend. Needs RESEND_API_KEY in Vercel.
 * Returns false (never throws) so callers can fall back, for example by showing a link to copy.
 */
export async function sendEmail(input: { to: string; subject: string; html: string; text: string; replyTo?: string | null }): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.NOTIFY_FROM ?? "Kageflow <no-reply@kageflow.co.za>",
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

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
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.55;color:#1a1d2e;max-width:520px">
<p style="font-size:20px;font-weight:600;margin:0 0 12px">Join ${company} on Kageflow</p>
<p style="margin:0 0 16px">${inviter} has invited you to join <strong>${company}</strong> as ${role}. Kageflow is where the dealership runs its leads, stock, deals and books.</p>
<p style="margin:0 0 20px"><a href="${link}" style="display:inline-block;background:#1e2346;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Accept the invitation</a></p>
<p style="margin:0 0 8px;color:#4a4f66;font-size:13px">The link works once and expires in 7 days. If the button doesn't work, paste this into your browser:<br>${link}</p>
<p style="margin:0;color:#6f748b;font-size:13px">If you weren't expecting this, you can ignore this email.</p>
</div>`,
  };
}
