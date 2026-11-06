import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** WhatsApp Cloud API (Meta Graph). The access token never leaves the server. */
const GRAPH = "https://graph.facebook.com/v21.0";

export class WaError extends Error {
  constructor(message: string, public code?: number) {
    super(message);
  }
}

/** The channel's token, read with the service key (row-level security hides it from everyone else) */
export async function channelToken(admin: SupabaseClient, channelId: string): Promise<{ token: string; wabaId: string | null; phoneNumberId: string | null }> {
  const { data } = await admin.from("lead_channels").select("access_token, waba_id, phone_number_id").eq("id", channelId).eq("kind", "whatsapp").maybeSingle();
  const c = data as { access_token: string | null; waba_id: string | null; phone_number_id: string | null } | null;
  if (!c?.access_token) throw new WaError("Add the WhatsApp access token under Settings, Listings and leads");
  return { token: c.access_token, wabaId: c.waba_id, phoneNumberId: c.phone_number_id };
}

function friendly(json: { error?: { message?: string; code?: number; error_data?: { details?: string } } }, status: number) {
  const e = json.error;
  const code = e?.code;
  if (code === 131047 || /24 hours|re-engagement/i.test(e?.message ?? "")) return new WaError("WhatsApp only allows free messages within 24 hours of their last message. Send a template instead.", code);
  if (code === 131026) return new WaError("This number isn't on WhatsApp, or can't receive messages.", code);
  if (code === 132001) return new WaError("That template isn't approved in this language yet.", code);
  if (code === 190) return new WaError("The WhatsApp access token has expired or was revoked. An admin must paste a new one in Settings.", code);
  return new WaError(e?.error_data?.details ?? e?.message ?? `WhatsApp returned ${status}`, code);
}

export async function sendMessage(token: string, phoneNumberId: string, payload: Record<string, unknown>): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new WaError("Couldn't reach WhatsApp. Try again in a moment.");
  }
  const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
  if (!res.ok || !json.messages?.[0]?.id) throw friendly(json, res.status);
  return json.messages[0].id;
}

type RawTemplate = {
  name: string; language: string; status: string; category?: string;
  components?: { type: string; format?: string; text?: string; example?: unknown; buttons?: { type: string; url?: string }[] }[];
};

const placeholders = (text: string) => [...text.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map((m) => m[1]!).filter((v, i, a) => a.indexOf(v) === i);

/** Approved templates on the WhatsApp Business Account, in the shape Kageflow stores */
export async function fetchTemplates(token: string, wabaId: string) {
  const out: { name: string; language: string; category: string | null; status: string; body: string; params: string[]; usable: boolean }[] = [];
  let url: string | null = `${GRAPH}/${wabaId}/message_templates?fields=name,language,status,category,components&limit=100`;
  for (let page = 0; url && page < 10; page++) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    const json = (await res.json().catch(() => ({}))) as { data?: RawTemplate[]; paging?: { next?: string }; error?: { message?: string; code?: number } };
    if (!res.ok) throw friendly(json, res.status);
    for (const t of json.data ?? []) {
      const comps = t.components ?? [];
      const body = comps.find((c) => c.type === "BODY")?.text ?? "";
      const header = comps.find((c) => c.type === "HEADER");
      const buttons = comps.find((c) => c.type === "BUTTONS")?.buttons ?? [];
      // Kageflow fills body values; templates that also need a header photo/document, header values or a link value aren't sendable yet
      const usable = (!header || (header.format === "TEXT" && placeholders(header.text ?? "").length === 0))
        && !buttons.some((b) => b.type === "URL" && /\{\{/.test(b.url ?? ""));
      out.push({ name: t.name, language: t.language, category: t.category ?? null, status: t.status, body, params: placeholders(body), usable });
    }
    url = json.paging?.next ?? null;
  }
  return out;
}

/** Payload for a template with body values */
export function templatePayload(to: string, name: string, language: string, params: string[], values: string[]) {
  const named = params.some((p) => !/^\d+$/.test(p));
  return {
    to, type: "template",
    template: {
      name, language: { code: language },
      ...(params.length ? { components: [{ type: "body", parameters: params.map((p, i) => ({ type: "text", text: values[i] ?? "", ...(named ? { parameter_name: p } : {}) })) }] } : {}),
    },
  };
}

export function renderTemplate(body: string, params: string[], values: string[]) {
  return params.reduce((s, p, i) => s.replace(new RegExp(`\\{\\{\\s*${p}\\s*\\}\\}`, "g"), values[i] ?? ""), body);
}

/** A received photo, voice note or document: Meta keeps it about 30 days */
export async function downloadMedia(token: string, mediaId: string): Promise<{ body: ArrayBuffer; type: string }> {
  const meta = await fetch(`${GRAPH}/${mediaId}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
  const info = (await meta.json().catch(() => ({}))) as { url?: string; mime_type?: string; error?: { message?: string } };
  if (!meta.ok || !info.url) throw new WaError(info.error?.message ?? "WhatsApp no longer has this file (they keep media about 30 days)");
  const file = await fetch(info.url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
  if (!file.ok) throw new WaError("Couldn't download the file from WhatsApp");
  return { body: await file.arrayBuffer(), type: info.mime_type ?? file.headers.get("content-type") ?? "application/octet-stream" };
}
