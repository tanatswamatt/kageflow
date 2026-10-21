"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { cleanError, done, fail, str } from "@/lib/forms";

const BACK = "/settings/integrations";

export async function createKey(_prev: { key?: string; error?: string } | null, fd: FormData): Promise<{ key?: string; error?: string }> {
  const ctx = await getContext();
  if (!ctx.can("company.manage")) return { error: "Only owners and admins can create API keys" };
  const name = str(fd, "name");
  if (!name) return { error: "Name the key after where it's used, e.g. Kalali website" };
  const { data, error } = await ctx.supabase.rpc("create_api_key", { p_company: ctx.companyId, p_name: name });
  if (error) return { error: cleanError(error.message) };
  revalidatePath(BACK);
  return { key: data as string };
}

export async function revokeKey(fd: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("revoke_api_key", { p_key_id: str(fd, "id") });
  if (error) fail(BACK, cleanError(error.message));
  done(BACK, "Key revoked. Anything using it stops working now.");
}

export async function addEndpoint(fd: FormData) {
  const ctx = await getContext();
  if (!ctx.can("company.manage")) fail(BACK, "Only owners and admins can add webhooks");
  const url = str(fd, "url");
  if (!url || !/^https:\/\/\S+$/.test(url)) fail(BACK, "The webhook address must start with https://");
  const events = fd.getAll("events").filter((e): e is string => typeof e === "string");
  if (events.length === 0) fail(BACK, "Pick at least one event");
  const { error } = await ctx.supabase.from("webhook_endpoints").insert({ company_id: ctx.companyId, url, description: str(fd, "description"), events });
  if (error) fail(BACK, cleanError(error.message));
  done(BACK, "Webhook added. Copy its signing secret into the receiving system.");
}

export async function toggleEndpoint(fd: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.from("webhook_endpoints").update({ is_active: str(fd, "active") === "true" }).eq("id", str(fd, "id")!).eq("company_id", ctx.companyId);
  if (error) fail(BACK, cleanError(error.message));
  done(BACK, "Webhook updated");
}

export async function removeEndpoint(fd: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.from("webhook_endpoints").delete().eq("id", str(fd, "id")!).eq("company_id", ctx.companyId);
  if (error) fail(BACK, cleanError(error.message));
  done(BACK, "Webhook removed");
}

export async function testEndpoint(fd: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("send_test_webhook", { p_endpoint: str(fd, "id") });
  if (error) fail(BACK, cleanError(error.message));
  done(BACK, "Test sent. Refresh in a few seconds to see the response below.");
}

// ---------- website stock sync ----------

type Source = { id: string; kind: "supabase_vehicles" | "json_feed"; base_url: string; api_key: string | null; table_name: string; include_images: boolean };

function sourceUrl(s: Source, images: boolean): string {
  if (s.kind === "json_feed") return s.base_url;
  return `${s.base_url}/rest/v1/${s.table_name}?select=${images ? "*,vehicle_images(storage_path,is_primary,position)" : "*"}&limit=2000`;
}

export async function addStockSource(fd: FormData) {
  const ctx = await getContext();
  if (!ctx.can("company.manage")) fail(BACK, "Only owners and admins can connect a website");
  const kind = str(fd, "kind") === "json_feed" ? "json_feed" : "supabase_vehicles";
  let url = str(fd, "base_url")?.replace(/\/+$/, "") ?? "";
  if (kind === "supabase_vehicles") url = url.replace(/\/rest\/v1.*$/, "");
  if (!/^https:\/\/\S+$/.test(url)) fail(BACK, "The website address must start with https://");
  const { error } = await ctx.supabase.from("stock_sources").insert({
    company_id: ctx.companyId,
    name: str(fd, "name") ?? "Website",
    kind,
    base_url: url,
    api_key: str(fd, "api_key"),
    table_name: str(fd, "table_name") ?? "vehicles",
    image_bucket: str(fd, "image_bucket") ?? "vehicle-images",
  });
  if (error) fail(BACK, cleanError(error.message));
  done(BACK, "Website connected. Press Sync now to pull its stock; after that it syncs every 15 minutes.");
}

export async function syncNow(fd: FormData) {
  const ctx = await getContext();
  if (!ctx.can("company.manage")) fail(BACK, "Only owners and admins can sync stock");
  const id = str(fd, "id")!;
  const { data } = await ctx.supabase.from("stock_sources").select("id, kind, base_url, api_key, table_name, include_images").eq("id", id).eq("company_id", ctx.companyId).single();
  if (!data) fail(BACK, "Unknown source");
  const s = data as Source;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (s.api_key) {
    headers.Authorization = `Bearer ${s.api_key}`;
    if (s.kind === "supabase_vehicles") headers.apikey = s.api_key;
  }

  const get = async (images: boolean) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      return await fetch(sourceUrl(s, images), { headers, cache: "no-store", signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  let message: string | null = null;
  let items: unknown = null;
  try {
    let res = await get(s.include_images);
    if (!res.ok && res.status >= 400 && res.status < 500 && s.kind === "supabase_vehicles" && s.include_images) {
      res = await get(false);
      if (res.ok) await ctx.supabase.from("stock_sources").update({ include_images: false }).eq("id", id);
    }
    if (!res.ok) {
      message = res.status === 401 || res.status === 403
        ? `The website refused access (${res.status}). Check the key, and that its vehicles are publicly readable.`
        : res.status === 404 ? "Nothing found at that address. Check the URL and table name." : `The website answered ${res.status}.`;
    } else {
      items = await res.json();
      if (!Array.isArray(items)) message = "The website didn't return a list of items.";
    }
  } catch (e) {
    message = (e as Error).name === "AbortError" ? "The website took too long to answer." : "Couldn't reach the website. Check the address.";
  }
  if (message) {
    await ctx.supabase.rpc("record_stock_sync_error", { p_source: id, p_message: message });
    fail(BACK, message);
  }
  const { data: counts, error } = await ctx.supabase.rpc("apply_stock_sync", { p_source: id, p_items: items });
  if (error) fail(BACK, cleanError(error.message));
  const c = counts as { created: number; updated: number; skipped: number; products: number };
  revalidatePath("/inventory", "layout");
  done(BACK, `Synced: ${c.created} new, ${c.updated} updated${c.products ? `, ${c.products} products` : ""}${c.skipped ? `, ${c.skipped} skipped (sold or incomplete)` : ""}.`);
}

export async function toggleStockSource(fd: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.from("stock_sources").update({ is_active: str(fd, "active") === "true" }).eq("id", str(fd, "id")!).eq("company_id", ctx.companyId);
  if (error) fail(BACK, cleanError(error.message));
  done(BACK, "Updated");
}

export async function removeStockSource(fd: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.from("stock_sources").delete().eq("id", str(fd, "id")!).eq("company_id", ctx.companyId);
  if (error) fail(BACK, cleanError(error.message));
  done(BACK, "Website disconnected. Vehicles already imported stay in Kageflow.");
}
