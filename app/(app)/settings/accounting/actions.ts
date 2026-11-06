"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { adminClient } from "@/lib/supabase/admin";
import { cleanError, done, fail, str } from "@/lib/forms";
import { refreshExternalAccounts, syncConnection, type Connection, type ExternalAccount } from "@/lib/accounting-sync";

const BACK = "/settings/accounting";

async function load(manage: boolean) {
  const ctx = await getContext();
  if (manage ? !ctx.can("company.manage") : !ctx.can("ledger.write")) fail(BACK, manage ? "Only owners and admins can change the Xero connection" : "Only owners, admins and accountants can do this");
  const { data } = await ctx.supabase.from("accounting_connections").select("*").eq("company_id", ctx.companyId).eq("provider", "xero").maybeSingle();
  const admin = adminClient();
  if (!admin) fail(BACK, "Kageflow's server is missing its service key (SUPABASE_SERVICE_ROLE_KEY)");
  return { ctx, c: data as Connection | null, admin };
}

export async function chooseTenant(fd: FormData) {
  const { ctx, c, admin } = await load(true);
  const id = str(fd, "tenant_id");
  const t = c?.tenants?.find((x) => x.tenantId === id);
  if (!c || !t) fail(BACK, "Choose one of the organisations Xero listed");
  // a different organisation is a fresh set of books: forget what was sent to the old one
  if (c.tenant_id && c.tenant_id !== t.tenantId) {
    await admin.from("accounting_sync_log").delete().eq("connection_id", c.id);
    await admin.from("accounting_account_map").delete().eq("connection_id", c.id);
  }
  const { error } = await ctx.supabase.from("accounting_connections").update({ tenant_id: t.tenantId, tenant_name: t.tenantName, status: "active", updated_at: new Date().toISOString() }).eq("id", c.id);
  if (error) fail(BACK, cleanError(error.message));
  try {
    await refreshExternalAccounts(admin, { ...c, tenant_id: t.tenantId });
  } catch (e) {
    fail(BACK, (e as Error).message);
  }
  revalidatePath(BACK);
  done(BACK, `Using ${t.tenantName}. Now match your accounts below.`);
}

export async function saveSyncSettings(fd: FormData) {
  const { ctx, c } = await load(true);
  if (!c) fail(BACK, "Connect Xero first");
  const from = str(fd, "sync_from");
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) fail(BACK, "Choose the date to start sending from");
  const mode = str(fd, "mode") === "daily" ? "daily" : "each";
  const { error } = await ctx.supabase.from("accounting_connections").update({ sync_from: from, mode, updated_at: new Date().toISOString() }).eq("id", c.id);
  if (error) fail(BACK, cleanError(error.message));
  revalidatePath(BACK);
  done(BACK, "Saved");
}

export async function refreshAccountsAction() {
  const { c, admin } = await load(false);
  if (!c?.tenant_id) fail(BACK, "Connect Xero and choose the organisation first");
  try {
    await refreshExternalAccounts(admin, c);
  } catch (e) {
    fail(BACK, (e as Error).message);
  }
  revalidatePath(BACK);
  done(BACK, "Xero's accounts read again");
}

/** Match Kageflow accounts to Xero by account code, then by name */
export async function autoMatch() {
  const { ctx, c } = await load(false);
  if (!c?.external_accounts?.length) fail(BACK, "Read Xero's accounts first");
  const ext = c.external_accounts;
  const [{ data: accs }, { data: maps }] = await Promise.all([
    ctx.supabase.from("accounts").select("id, code, name").eq("company_id", ctx.companyId).eq("is_active", true),
    ctx.supabase.from("accounting_account_map").select("account_id").eq("connection_id", c.id),
  ]);
  const have = new Set(((maps ?? []) as { account_id: string }[]).map((m) => m.account_id));
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const rows = ((accs ?? []) as { id: string; code: string; name: string }[]).filter((a) => !have.has(a.id)).flatMap((a) => {
    const x = ext.find((e) => e.code && e.code === a.code) ?? ext.find((e) => norm(e.name) === norm(a.name));
    return x ? [{ company_id: ctx.companyId, connection_id: c.id, account_id: a.id, external_id: x.id, external_code: x.code, external_name: x.name }] : [];
  });
  if (rows.length) {
    const { error } = await ctx.supabase.from("accounting_account_map").upsert(rows, { onConflict: "connection_id,account_id" });
    if (error) fail(BACK, cleanError(error.message));
  }
  revalidatePath(BACK);
  done(BACK, rows.length ? `Matched ${rows.length} account${rows.length === 1 ? "" : "s"}. Check them, and choose the rest by hand.` : "No more matches by code or name. Choose the rest by hand.");
}

export async function saveMapping(fd: FormData) {
  const { ctx, c } = await load(false);
  if (!c?.external_accounts) fail(BACK, "Read Xero's accounts first");
  const ext = new Map<string, ExternalAccount>(c.external_accounts.map((e) => [e.id, e]));
  const set: { company_id: string; connection_id: string; account_id: string; external_id: string; external_code: string | null; external_name: string; updated_at: string }[] = [];
  const clear: string[] = [];
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith("map_") || typeof v !== "string") continue;
    const accountId = k.slice(4);
    if (!v) { clear.push(accountId); continue; }
    const x = ext.get(v);
    if (x) set.push({ company_id: ctx.companyId, connection_id: c.id, account_id: accountId, external_id: x.id, external_code: x.code, external_name: x.name, updated_at: new Date().toISOString() });
  }
  if (set.length) {
    const { error } = await ctx.supabase.from("accounting_account_map").upsert(set, { onConflict: "connection_id,account_id" });
    if (error) fail(BACK, cleanError(error.message));
  }
  if (clear.length) await ctx.supabase.from("accounting_account_map").delete().eq("connection_id", c.id).in("account_id", clear);
  revalidatePath(BACK);
  done(BACK, "Account matches saved");
}

export async function syncNowAction() {
  const { c, admin } = await load(false);
  if (!c) fail(BACK, "Connect Xero first");
  let r: { ok: boolean; message: string };
  try {
    r = await syncConnection(admin, c.id);
  } catch (e) {
    r = { ok: false, message: (e as Error).message };
  }
  revalidatePath(BACK);
  if (r.ok) done(BACK, r.message);
  fail(BACK, r.message);
}

export async function togglePause(fd: FormData) {
  const { ctx, c } = await load(true);
  if (!c) fail(BACK, "Connect Xero first");
  const pause = str(fd, "pause") === "true";
  const { error } = await ctx.supabase.from("accounting_connections").update({ status: pause ? "paused" : "active", updated_at: new Date().toISOString() }).eq("id", c.id);
  if (error) fail(BACK, cleanError(error.message));
  revalidatePath(BACK);
  done(BACK, pause ? "Paused. Nothing is sent until you resume." : "Resumed. Kageflow sends new journals every hour.");
}

/** Stops syncing and forgets the tokens. What was sent stays recorded, so reconnecting never sends twice. */
export async function disconnectXero() {
  const { ctx, c, admin } = await load(true);
  if (!c) fail(BACK, "Not connected");
  await admin.from("accounting_tokens").delete().eq("connection_id", c.id);
  const { error } = await ctx.supabase.from("accounting_connections").update({ status: "needs_reconnect", updated_at: new Date().toISOString() }).eq("id", c.id);
  if (error) fail(BACK, cleanError(error.message));
  revalidatePath(BACK);
  done(BACK, "Disconnected. Journals already sent stay in Xero. To remove Kageflow's access completely, also disconnect it in Xero under Settings, Connected apps.");
}
