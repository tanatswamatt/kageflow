"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { adminClient } from "@/lib/supabase/admin";
import { cleanError, done, fail, str } from "@/lib/forms";
import { moneyFor } from "@/lib/format";
import { channelToken, renderTemplate, sendMessage, templatePayload, WaError } from "@/lib/whatsapp";

type SendCtx = { channel_id: string; phone_number_id: string; to: string; last_inbound: string | null; first_name: string | null; unit_id: string | null };

const backOf = (fd: FormData) => {
  const leadId = str(fd, "lead_id")!;
  const back = str(fd, "back");
  return { leadId, back: back && /^\/crm\/(leads|whatsapp)(\/|$|\?)/.test(back) ? back : `/crm/leads/${leadId}` };
};

/** Permission, recipient and channel from the database; the token with the server's own key */
async function prepare(leadId: string, back: string) {
  const ctx = await getContext();
  if (!ctx.can("crm.write")) fail(back, "Your role can't message leads");
  const { data, error } = await ctx.supabase.rpc("whatsapp_send_context", { p_lead: leadId });
  if (error) fail(back, cleanError(error.message));
  const c = data as SendCtx;
  const admin = adminClient();
  if (!admin) fail(back, "Kageflow's server is missing its service key (SUPABASE_SERVICE_ROLE_KEY), so it can't send WhatsApp messages");
  let token: string;
  try {
    token = (await channelToken(admin, c.channel_id)).token;
  } catch (e) {
    fail(back, (e as Error).message);
  }
  const windowOpen = !!c.last_inbound && Date.now() - new Date(c.last_inbound).getTime() < 24 * 3600 * 1000;
  return { ctx, c, token, windowOpen, admin };
}

async function log(ctx: Awaited<ReturnType<typeof getContext>>, leadId: string, channel: string, to: string, body: string, waId: string, type = "text", template: string | null = null, link: string | null = null) {
  const { error } = await ctx.supabase.rpc("whatsapp_log_sent", { p_lead: leadId, p_channel: channel, p_to: to, p_body: body, p_wa_message_id: waId, p_type: type, p_template: template, p_media_link: link });
  return error ? cleanError(error.message) : null;
}

export async function sendWhatsApp(fd: FormData) {
  const { leadId, back } = backOf(fd);
  const body = str(fd, "body");
  if (!body) fail(back, "Type a message");
  const { ctx, c, token } = await prepare(leadId, back);
  let id: string;
  try {
    id = await sendMessage(token, c.phone_number_id, { to: c.to, type: "text", text: { preview_url: true, body } });
  } catch (e) {
    fail(back, (e as WaError).message);
  }
  const err = await log(ctx, leadId, c.channel_id, c.to, body, id);
  if (err) fail(back, `Sent, but not saved: ${err}`);
  revalidatePath(back);
  done(back, "Sent on WhatsApp");
}

/** An approved template: the only way to message someone first, or after 24 hours */
export async function sendTemplate(fd: FormData) {
  const { leadId, back } = backOf(fd);
  const ctx0 = await getContext();
  const { data: td } = await ctx0.supabase.from("whatsapp_templates").select("id, channel_id, name, language, body, params, usable, status").eq("id", str(fd, "template_id") ?? "").eq("company_id", ctx0.companyId).maybeSingle();
  const t = td as { id: string; channel_id: string; name: string; language: string; body: string; params: string[]; usable: boolean; status: string } | null;
  if (!t || t.status !== "APPROVED" || !t.usable) fail(back, "Choose an approved template");
  const values = t.params.map((_, i) => str(fd, `v_${i}`) ?? "");
  if (values.some((v) => !v)) fail(back, "Fill in every value in the template");
  const { ctx, c, admin } = await prepare(leadId, back);
  let id: string;
  try {
    const ch = await channelToken(admin, t.channel_id);
    id = await sendMessage(ch.token, ch.phoneNumberId ?? c.phone_number_id, templatePayload(c.to, t.name, t.language, t.params, values));
  } catch (e) {
    fail(back, (e as WaError).message);
  }
  const err = await log(ctx, leadId, t.channel_id, c.to, renderTemplate(t.body, t.params, values), id, "template", t.name);
  if (err) fail(back, `Sent, but not saved: ${err}`);
  revalidatePath(back);
  done(back, "Template sent. When they reply, you can chat freely for 24 hours.");
}

/** Photos and the details of a car from stock */
export async function sendCar(fd: FormData) {
  const { leadId, back } = backOf(fd);
  const unitId = str(fd, "unit_id");
  if (!unitId) fail(back, "Choose a car");
  const { ctx, c, token, windowOpen } = await prepare(leadId, back);
  if (!windowOpen) fail(back, "WhatsApp only allows photos within 24 hours of their last message. Send a template first, and send the car when they reply.");
  const [{ data: ud }, { data: pd }] = await Promise.all([
    ctx.supabase.from("inventory_units").select("stock_no, year, make, model, variant, mileage_km, colour, transmission, fuel_type, advert_price, list_price, list_currency, image_url, status")
      .eq("id", unitId).eq("company_id", ctx.companyId).maybeSingle(),
    ctx.supabase.from("vehicle_photos").select("url").eq("unit_id", unitId).order("position").order("created_at").limit(4),
  ]);
  const u = ud as { stock_no: string | null; year: number | null; make: string | null; model: string | null; variant: string | null; mileage_km: number | null; colour: string | null; transmission: string | null; fuel_type: string | null; advert_price: number | null; list_price: number | null; list_currency: string; image_url: string | null; status: string } | null;
  if (!u) fail(back, "That car isn't in your stock");
  if (u.status === "sold") fail(back, "That car is sold");
  const price = u.advert_price ?? u.list_price;
  const caption = [
    [u.year, u.make, u.model, u.variant].filter(Boolean).join(" "),
    [price != null ? moneyFor(ctx.company.base_currency)(price, u.list_currency) : null, u.mileage_km != null ? `${Number(u.mileage_km).toLocaleString("en-ZA")} km` : null, u.transmission, u.fuel_type, u.colour].filter(Boolean).join(" · "),
    u.stock_no ? `Stock no. ${u.stock_no}` : null,
    u.status === "reserved" ? "Currently reserved: ask us about it" : null,
  ].filter(Boolean).join("\n");
  const photos = ((pd ?? []) as { url: string }[]).map((p) => p.url).filter((x) => /^https:\/\//.test(x));
  if (photos.length === 0 && u.image_url && /^https:\/\//.test(u.image_url)) photos.push(u.image_url);

  let sent = 0;
  try {
    if (photos.length === 0) {
      const id = await sendMessage(token, c.phone_number_id, { to: c.to, type: "text", text: { body: caption } });
      await log(ctx, leadId, c.channel_id, c.to, caption, id);
      sent++;
    } else {
      for (const [i, link] of photos.entries()) {
        const body = i === 0 ? caption : "";
        const id = await sendMessage(token, c.phone_number_id, { to: c.to, type: "image", image: { link, ...(body ? { caption: body } : {}) } });
        await log(ctx, leadId, c.channel_id, c.to, body || "[photo]", id, "image", null, link);
        sent++;
      }
    }
  } catch (e) {
    revalidatePath(back);
    fail(back, sent ? `Sent ${sent}, then WhatsApp stopped: ${(e as WaError).message}` : (e as WaError).message);
  }
  revalidatePath(back);
  done(back, photos.length ? `Sent ${photos.length} photo${photos.length === 1 ? "" : "s"} with the car's details` : "Sent the car's details (it has no photos yet)");
}
