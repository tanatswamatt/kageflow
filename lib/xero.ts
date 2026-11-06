import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Xero connection: OAuth 2.0 and the few Accounting API calls Kageflow needs.
 * Env: XERO_CLIENT_ID, XERO_CLIENT_SECRET, optional XERO_REDIRECT_URI.
 * Scopes: apps created after 2 March 2026 must ask for granular scopes, so manual journals use
 * accounting.manualjournals rather than the old accounting.transactions.
 */
export const XERO_SCOPES = "openid profile email offline_access accounting.manualjournals accounting.settings.read";
const API = "https://api.xero.com/api.xro/2.0";

export const xeroConfigured = () => Boolean(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET);

export function redirectUri(origin: string) {
  return process.env.XERO_REDIRECT_URI ?? `${origin}/api/xero/callback`;
}

export function authorizeUrl(origin: string, state: string) {
  const u = new URL("https://login.xero.com/identity/connect/authorize");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", process.env.XERO_CLIENT_ID!);
  u.searchParams.set("redirect_uri", redirectUri(origin));
  u.searchParams.set("scope", XERO_SCOPES);
  u.searchParams.set("state", state);
  return u.toString();
}

export type Tokens = { access_token: string; refresh_token: string; expires_in: number };

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const basic = Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const json = (await res.json().catch(() => ({}))) as Partial<Tokens> & { error?: string };
  if (!res.ok || !json.access_token || !json.refresh_token) throw new XeroError(json.error === "invalid_grant" ? "reconnect" : "token", `Xero sign-in failed${json.error ? ` (${json.error})` : ""}`);
  return json as Tokens;
}

export const exchangeCode = (code: string, origin: string) =>
  tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri(origin) });

export class XeroError extends Error {
  constructor(public kind: "reconnect" | "token" | "busy" | "api", message: string) {
    super(message);
  }
}

export type Tenant = { tenantId: string; tenantName: string; tenantType: string };

export async function listTenants(accessToken: string): Promise<Tenant[]> {
  const res = await fetch("https://api.xero.com/connections", { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!res.ok) throw new XeroError("api", `Xero didn't list your organisations (${res.status})`);
  return ((await res.json()) as Tenant[]).filter((t) => t.tenantType === "ORGANISATION");
}

export async function saveTokens(admin: SupabaseClient, connectionId: string, t: Tokens) {
  const { error } = await admin.from("accounting_tokens").upsert({
    connection_id: connectionId, access_token: t.access_token, refresh_token: t.refresh_token,
    expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(), updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

/** A working access token, refreshed when it's about to run out. Xero rotates the refresh token each time. */
export async function accessToken(admin: SupabaseClient, connectionId: string): Promise<string> {
  const { data } = await admin.from("accounting_tokens").select("access_token, refresh_token, expires_at").eq("connection_id", connectionId).maybeSingle();
  const row = data as { access_token: string; refresh_token: string; expires_at: string } | null;
  if (!row) throw new XeroError("reconnect", "Connect Xero again");
  if (new Date(row.expires_at).getTime() > Date.now() + 60_000) return row.access_token;
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: row.refresh_token });
  await saveTokens(admin, connectionId, t);
  return t.access_token;
}

async function call<T>(token: string, tenantId: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "xero-tenant-id": tenantId, Accept: "application/json", "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 429) throw new XeroError("busy", "Xero's limit for this hour was reached. Kageflow tries again on the next run.");
  if (res.status === 401) throw new XeroError("reconnect", "Xero stopped accepting Kageflow's access. Connect Xero again.");
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const msg = (json as { Elements?: { ValidationErrors?: { Message: string }[] }[]; Message?: string; Detail?: string }).Elements?.[0]?.ValidationErrors?.map((v) => v.Message).join("; ")
      ?? (json as { Message?: string }).Message ?? (json as { Detail?: string }).Detail ?? `Xero answered ${res.status}`;
    throw new XeroError("api", msg);
  }
  return json as T;
}

export type XeroAccount = { AccountID: string; Code?: string; Name: string; Type: string; Status: string; Class?: string };

export async function organisation(token: string, tenantId: string) {
  const r = await call<{ Organisations: { Name: string; BaseCurrency: string }[] }>(token, tenantId, "/Organisation");
  return r.Organisations[0];
}

/** Active accounts a manual journal can use. Xero doesn't allow manual journals on bank accounts. */
export async function journalAccounts(token: string, tenantId: string) {
  const r = await call<{ Accounts: XeroAccount[] }>(token, tenantId, "/Accounts");
  return r.Accounts.filter((a) => a.Status === "ACTIVE" && a.Type !== "BANK")
    .map((a) => ({ id: a.AccountID, code: a.Code ?? null, name: a.Name, type: a.Type }))
    .sort((a, b) => (a.code ?? "zz").localeCompare(b.code ?? "zz") || a.name.localeCompare(b.name));
}

export type JournalLine = { LineAmount: number; AccountCode?: string; AccountID?: string; Description?: string };
export type ManualJournal = { Narration: string; Date: string; Status: "POSTED"; LineAmountTypes: "NoTax"; JournalLines: JournalLine[] };
type Result = { ManualJournalID?: string; StatusAttributeString?: string; ValidationErrors?: { Message: string }[] };

/** Create journals; each comes back with its id or its own validation errors */
export async function createJournals(token: string, tenantId: string, journals: ManualJournal[]) {
  const r = await call<{ ManualJournals: Result[] }>(token, tenantId, "/ManualJournals?summarizeErrors=false", {
    method: "PUT",
    body: JSON.stringify({ ManualJournals: journals }),
  });
  return r.ManualJournals.map((m) => ({
    id: m.StatusAttributeString === "ERROR" ? null : m.ManualJournalID ?? null,
    error: m.ValidationErrors?.length ? m.ValidationErrors.map((v) => v.Message).join("; ") : m.StatusAttributeString === "ERROR" ? "Xero refused this journal" : null,
  }));
}
