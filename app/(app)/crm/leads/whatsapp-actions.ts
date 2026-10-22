"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { cleanError, done, fail, str } from "@/lib/forms";

type Ctx = { channel_id: string; phone_number_id: string; access_token: string; to: string; last_inbound: string | null };

export async function sendWhatsApp(fd: FormData) {
  const leadId = str(fd, "lead_id")!;
  const back = `/crm/leads/${leadId}`;
  const ctx = await getContext();
  if (!ctx.can("crm.write")) fail(back, "Your role can't message leads");
  const body = str(fd, "body");
  if (!body) fail(back, "Type a message");
  const { data, error } = await ctx.supabase.rpc("whatsapp_send_context", { p_lead: leadId });
  if (error) fail(back, cleanError(error.message));
  const c = data as Ctx;

  let res: Response;
  try {
    res = await fetch(`https://graph.facebook.com/v21.0/${c.phone_number_id}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${c.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: c.to, type: "text", text: { preview_url: true, body } }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    fail(back, "Couldn't reach WhatsApp. Try again in a moment.");
  }
  const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
  if (!res.ok || !json.messages?.[0]?.id) {
    const msg = json.error?.message ?? `WhatsApp returned ${res.status}`;
    const windowClosed = json.error?.code === 131047 || /24 hours|re-engagement/i.test(msg);
    fail(back, windowClosed ? "WhatsApp only allows free replies within 24 hours of their last message. Use the Open in WhatsApp button or call them." : msg);
  }
  const { error: logError } = await ctx.supabase.rpc("whatsapp_log_outbound", { p_lead: leadId, p_channel: c.channel_id, p_to: c.to, p_body: body, p_wa_message_id: json.messages[0].id });
  if (logError) fail(back, `Sent, but not saved: ${cleanError(logError.message)}`);
  revalidatePath(back);
  done(back, "Sent on WhatsApp");
}
