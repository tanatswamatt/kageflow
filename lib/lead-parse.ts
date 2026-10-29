import type { LeadSource } from "./types";

export type ParsedLead = {
  source: LeadSource;
  source_detail: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  subject: string | null;
  message: string | null;
  message_id: string | null;
};

const PORTAL_DOMAINS = /(autotrader|cars\.co\.za|carsco|facebookmail|facebook|gumtree|noreply|no-reply|donotreply|mailer|notifications?)/i;

function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d)[^>]*>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function field(text: string, labels: string[]): string | null {
  for (const l of labels) {
    const re = new RegExp(`(?:^|\\n)\\s*\\**\\s*${l}\\s*\\**\\s*[:\\-]\\s*\\**\\s*(.+)`, "i");
    const m = text.match(re);
    const v = m?.[1]?.replace(/\*+/g, "").trim();
    if (v) return v.slice(0, 300);
  }
  return null;
}

function addressOf(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = v.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/);
  return m ? m[0].toLowerCase() : null;
}

/** Turns a forwarded portal or website enquiry email into lead fields */
export function parseLeadEmail(input: { from?: string | null; reply_to?: string | null; subject?: string | null; text?: string | null; html?: string | null; message_id?: string | null }): ParsedLead {
  const text = (input.text?.trim() || (input.html ? htmlToText(input.html) : "")).slice(0, 20000);
  const subject = input.subject?.trim() || null;
  const hay = `${input.from ?? ""} ${subject ?? ""} ${text.slice(0, 3000)}`.toLowerCase();
  const [source, detail]: [LeadSource, string] =
    hay.includes("autotrader") ? ["autotrader", "AutoTrader"]
    : hay.includes("cars.co.za") || hay.includes("carsco") ? ["cars_co_za", "Cars.co.za"]
    : hay.includes("facebook") ? ["facebook", "Facebook"]
    : hay.includes("gumtree") ? ["email", "Gumtree"]
    : ["email", "Email"];

  let first = field(text, ["first ?name", "name and surname", "full ?name", "customer name", "name"]);
  let last = field(text, ["surname", "last ?name"]);
  if (first && !last && /\s/.test(first) && !/first/i.test(text.match(/first ?name/i)?.[0] ?? "")) {
    const parts = first.split(/\s+/);
    first = parts[0] ?? first;
    last = parts.slice(1).join(" ") || null;
  }
  let email = addressOf(field(text, ["e-?mail(?: address)?", "email address"]));
  if (!email) {
    const reply = addressOf(input.reply_to);
    if (reply && !PORTAL_DOMAINS.test(reply)) email = reply;
  }
  if (!email) {
    const from = addressOf(input.from);
    if (from && !PORTAL_DOMAINS.test(from)) email = from;
  }
  if (!email) {
    const any = [...text.matchAll(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g)].map((m) => m[0].toLowerCase()).find((e) => !PORTAL_DOMAINS.test(e));
    email = any ?? null;
  }
  let phone = field(text, ["(?:contact|cell|mobile|phone|telephone|tel)(?: ?(?:number|no\\.?))?", "cellphone", "whatsapp"]);
  if (phone) phone = phone.replace(/[^\d+ ]/g, "").trim() || null;
  if (!phone) phone = text.match(/(?:\+27|\+263|\b0)[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/)?.[0] ?? null;
  if (!first && !last) {
    const fromName = input.from?.match(/^\s*"?([^"<@]+?)"?\s*</)?.[1]?.trim();
    if (fromName && !PORTAL_DOMAINS.test(fromName)) {
      const parts = fromName.split(/\s+/);
      first = parts[0] ?? null;
      last = parts.slice(1).join(" ") || null;
    }
  }
  const message = field(text, ["message", "comments?", "enquiry", "inquiry", "question"]) ?? text.slice(0, 4000);

  return {
    source, source_detail: detail,
    first_name: first, last_name: last, email, phone, subject,
    message: subject && message ? `${message}` : message,
    message_id: input.message_id?.trim() || null,
  };
}
