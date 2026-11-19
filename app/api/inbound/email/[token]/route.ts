import { anonClient, apiError } from "@/lib/supabase/anon";
import { parseLeadEmail } from "@/lib/lead-parse";
import { readBoundedBody, RequestBodyTooLargeError } from "@/lib/bounded-body";

const MAX_BODY_BYTES = 1024 * 1024;

// Accepts forwarded emails from common inbound email services (Postmark, CloudMailin, Mailgun, SendGrid, Resend)
// as JSON or form data, and turns each into a lead.
type Inbound = Record<string, unknown>;

const pick = (o: Inbound, ...keys: string[]) => {
  for (const k of keys) {
    const parts = k.split(".");
    let v: unknown = o;
    for (const p of parts) v = v && typeof v === "object" ? (v as Inbound)[p] : undefined;
    if (typeof v === "string" && v.trim()) return v;
    if (v && typeof v === "object" && !Array.isArray(v) && typeof (v as Inbound).text === "string") return (v as Inbound).text as string;
  }
  return null;
};

function header(o: Inbound, name: string): string | null {
  const h = o.Headers ?? o.headers;
  if (Array.isArray(h)) {
    const f = h.find((x) => typeof x === "object" && x && String((x as Inbound).Name ?? (x as Inbound).name ?? "").toLowerCase() === name.toLowerCase()) as Inbound | undefined;
    if (f) return String(f.Value ?? f.value ?? "");
  }
  if (h && typeof h === "object") {
    const entry = Object.entries(h as Inbound).find(([k]) => k.toLowerCase() === name.toLowerCase());
    if (entry && typeof entry[1] === "string") return entry[1];
  }
  if (typeof h === "string") return h.match(new RegExp(`^${name}:\\s*(.+)$`, "im"))?.[1]?.trim() ?? null;
  return null;
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // A null prototype keeps user-controlled form keys such as "__proto__" inert.
  let body: Inbound = Object.create(null) as Inbound;
  const type = request.headers.get("content-type") ?? "";
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBody(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return Response.json({ error: "Email payload is too large" }, { status: 413 });
    return Response.json({ error: "Could not read the email" }, { status: 400 });
  }

  try {
    if (/^application\/json(?:\s*;|$)/i.test(type)) {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return Response.json({ error: "Email payload must be a JSON object" }, { status: 400 });
      }
      body = Object.assign(Object.create(null) as Inbound, parsed);
      if (body.data && typeof body.data === "object" && !Array.isArray(body.data)) {
        body = Object.assign(Object.create(null) as Inbound, body, body.data);
      }
    } else if (/^(multipart\/form-data|application\/x-www-form-urlencoded)(?:;|$)/i.test(type)) {
      const formBody = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(formBody).set(bytes);
      const fd = await new Response(formBody, { headers: { "Content-Type": type } }).formData();
      fd.forEach((v, k) => { if (typeof v === "string") body[k] = v; });
    } else {
      return Response.json({ error: "Content-Type must be JSON or form data" }, { status: 415 });
    }
  } catch {
    return Response.json({ error: "Could not read the email" }, { status: 400 });
  }

  const lead = parseLeadEmail({
    from: pick(body, "From", "from", "envelope.from", "sender", "headers.from"),
    reply_to: pick(body, "ReplyTo", "reply_to", "Reply-To") ?? header(body, "Reply-To"),
    subject: pick(body, "Subject", "subject", "headers.subject"),
    text: pick(body, "TextBody", "text", "plain", "body-plain", "stripped-text", "body"),
    html: pick(body, "HtmlBody", "html", "body-html"),
    message_id: pick(body, "MessageID", "message_id", "Message-Id", "headers.message_id") ?? header(body, "Message-ID"),
  });
  const { data, error } = await anonClient().rpc("inbound_email_lead", { p_token: token, p_lead: lead });
  if (error) {
    // 2xx for unreadable emails so the email service doesn't retry forever
    if (error.code === "22023") return Response.json({ skipped: error.message }, { status: 200 });
    return apiError(error.code, error.message);
  }
  return Response.json(data, { status: 200 });
}
