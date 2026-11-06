"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { bool, cleanError, done, fail, str } from "@/lib/forms";
import { adminClient } from "@/lib/supabase/admin";
import { channelToken, fetchTemplates } from "@/lib/whatsapp";

const BACK = "/settings/channels";
const CHANNELS = ["autotrader", "cars_co_za", "facebook", "website", "other"];

async function admin() {
  const ctx = await getContext();
  if (!ctx.can("company.manage")) fail(BACK, "Only owners and admins can manage listings and lead channels");
  return ctx;
}

export async function addFeed(fd: FormData) {
  const ctx = await admin();
  const channel = str(fd, "channel") ?? "other";
  if (!CHANNELS.includes(channel)) fail(BACK, "Pick where the feed is for");
  const names: Record<string, string> = { autotrader: "AutoTrader", cars_co_za: "Cars.co.za", facebook: "Facebook", website: "My website", other: "Other" };
  const { error } = await ctx.supabase.from("listing_feeds").insert({ company_id: ctx.companyId, channel, name: str(fd, "name") ?? names[channel], include_reserved: bool(fd, "include_reserved") });
  if (error) fail(BACK, cleanError(error.message));
  revalidatePath(BACK);
  done(BACK, "Feed created. Copy its link below.");
}

export async function toggleFeed(fd: FormData) {
  const ctx = await admin();
  const { error } = await ctx.supabase.from("listing_feeds").update({ is_active: str(fd, "active") === "true" }).eq("id", str(fd, "id")).eq("company_id", ctx.companyId);
  if (error) fail(BACK, cleanError(error.message));
  done(BACK, str(fd, "active") === "true" ? "Feed switched on" : "Feed paused: it now returns nothing");
}

export async function removeFeed(fd: FormData) {
  const ctx = await admin();
  const { error } = await ctx.supabase.from("listing_feeds").delete().eq("id", str(fd, "id")).eq("company_id", ctx.companyId);
  if (error) fail(BACK, cleanError(error.message));
  done(BACK, "Feed removed. Its link stops working now.");
}

export async function addLeadChannel(fd: FormData) {
  const ctx = await admin();
  const kind = str(fd, "kind") === "whatsapp" ? "whatsapp" : "email";
  const { error } = await ctx.supabase.from("lead_channels").insert({ company_id: ctx.companyId, kind, name: kind === "whatsapp" ? "WhatsApp" : "Portal and email leads" });
  if (error) fail(BACK, cleanError(error.message));
  done(BACK, kind === "whatsapp" ? "WhatsApp channel created. Fill in the Meta details below." : "Lead address created. Follow the steps below.");
}

export async function saveWhatsApp(fd: FormData) {
  const ctx = await admin();
  const patch: Record<string, string | null> = {
    display_phone: str(fd, "display_phone"),
    phone_number_id: str(fd, "phone_number_id"),
    waba_id: str(fd, "waba_id"),
    auto_reply: str(fd, "auto_reply"),
    assign_mode: str(fd, "assign_mode") === "round_robin" ? "round_robin" : "none",
  };
  if (patch.waba_id && !/^\d{6,25}$/.test(patch.waba_id)) fail(BACK, "The WhatsApp Business Account ID is a long number from Meta's API setup page, digits only");
  if ((patch.auto_reply?.length ?? 0) > 1000) fail(BACK, "Keep the welcome reply under 1,000 characters");
  const token = str(fd, "access_token");
  const secret = str(fd, "app_secret");
  if (token) patch.access_token = token;
  if (secret) patch.app_secret = secret;
  if (patch.phone_number_id && !/^\d{6,20}$/.test(patch.phone_number_id)) fail(BACK, "The phone number ID is the long number from Meta's API setup page, digits only");
  const { error } = await ctx.supabase.from("lead_channels").update(patch).eq("id", str(fd, "id")).eq("company_id", ctx.companyId).eq("kind", "whatsapp");
  if (error) fail(BACK, cleanError(error.message));
  done(BACK, "WhatsApp details saved");
}

/** Read the approved message templates from Meta */
export async function loadTemplates(fd: FormData) {
  const ctx = await admin();
  const id = str(fd, "id")!;
  const sa = adminClient();
  if (!sa) fail(BACK, "Kageflow's server is missing its service key (SUPABASE_SERVICE_ROLE_KEY)");
  let count = 0;
  try {
    const ch = await channelToken(sa, id);
    if (!ch.wabaId) fail(BACK, "Save the WhatsApp Business Account ID first");
    const started = new Date().toISOString();
    const list = await fetchTemplates(ch.token, ch.wabaId);
    if (list.length) {
      const { error } = await sa.from("whatsapp_templates").upsert(
        list.map((t) => ({ company_id: ctx.companyId, channel_id: id, ...t, updated_at: new Date().toISOString() })),
        { onConflict: "channel_id,name,language" },
      );
      if (error) throw new Error(error.message);
    }
    // templates deleted in Meta go here too
    await sa.from("whatsapp_templates").delete().eq("channel_id", id).lt("updated_at", started);
    count = list.filter((t) => t.status === "APPROVED" && t.usable).length;
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    fail(BACK, (e as Error).message);
  }
  revalidatePath(BACK);
  done(BACK, `${count} approved template${count === 1 ? "" : "s"} ready to send`);
}

export async function toggleLeadChannel(fd: FormData) {
  const ctx = await admin();
  const { error } = await ctx.supabase.from("lead_channels").update({ is_active: str(fd, "active") === "true" }).eq("id", str(fd, "id")).eq("company_id", ctx.companyId);
  if (error) fail(BACK, cleanError(error.message));
  done(BACK, str(fd, "active") === "true" ? "Switched on" : "Paused");
}

export async function removeLeadChannel(fd: FormData) {
  const ctx = await admin();
  const { error } = await ctx.supabase.from("lead_channels").delete().eq("id", str(fd, "id")).eq("company_id", ctx.companyId);
  if (error) fail(BACK, cleanError(error.message));
  done(BACK, "Removed. Messages sent to it are now refused.");
}
