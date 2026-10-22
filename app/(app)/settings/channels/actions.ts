"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { bool, cleanError, done, fail, str } from "@/lib/forms";

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
  };
  const token = str(fd, "access_token");
  const secret = str(fd, "app_secret");
  if (token) patch.access_token = token;
  if (secret) patch.app_secret = secret;
  if (patch.phone_number_id && !/^\d{6,20}$/.test(patch.phone_number_id)) fail(BACK, "The phone number ID is the long number from Meta's API setup page, digits only");
  const { error } = await ctx.supabase.from("lead_channels").update(patch).eq("id", str(fd, "id")).eq("company_id", ctx.companyId).eq("kind", "whatsapp");
  if (error) fail(BACK, cleanError(error.message));
  done(BACK, "WhatsApp details saved");
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
