import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accessToken, createJournals, journalAccounts, organisation, XeroError, type ManualJournal } from "./xero";

export type Connection = {
  id: string; company_id: string; provider: "xero" | "file"; tenant_id: string | null; tenant_name: string | null; tenant_currency: string | null;
  tenants: { tenantId: string; tenantName: string }[] | null; status: "pending" | "active" | "paused" | "needs_reconnect";
  sync_from: string; mode: "each" | "daily"; last_synced_at: string | null; last_status: string | null;
  last_counts: { sent?: number; journals?: number; failed?: number } | null;
  external_accounts: ExternalAccount[] | null; external_accounts_at: string | null;
};
export type ExternalAccount = { id: string; code: string | null; name: string; type: string };
type Line = { journal_id: string; account_id: string; description: string | null; debit: number; credit: number; line_no: number };
type Journal = { id: string; number: string | null; journal_date: string; description: string; source_type: string };
type Mapping = { account_id: string; external_id: string | null; external_code: string | null };

const r2 = (n: number) => Math.round(n * 100) / 100;
const BATCH = 25;

async function finish(admin: SupabaseClient, id: string, status: string, counts: Record<string, number> | null, extra: Record<string, unknown> = {}) {
  await admin.from("accounting_connections").update({ last_synced_at: new Date().toISOString(), last_status: status.slice(0, 500), last_counts: counts, updated_at: new Date().toISOString(), ...extra }).eq("id", id);
}

/** Read the package's chart of accounts again (for the mapping screen) */
export async function refreshExternalAccounts(admin: SupabaseClient, c: Connection) {
  if (c.provider !== "xero" || !c.tenant_id) return;
  const token = await accessToken(admin, c.id);
  const [accounts, org] = await Promise.all([journalAccounts(token, c.tenant_id), organisation(token, c.tenant_id)]);
  await admin.from("accounting_connections").update({ external_accounts: accounts, external_accounts_at: new Date().toISOString(), tenant_currency: org?.BaseCurrency ?? null }).eq("id", c.id);
}

/**
 * Send posted Kageflow journals that haven't been sent yet. Runs with the service-role client:
 * callers check the user's permission first (or are the scheduled job).
 */
export async function syncConnection(admin: SupabaseClient, connectionId: string, limit = 200): Promise<{ ok: boolean; message: string }> {
  const { data: cd } = await admin.from("accounting_connections").select("*").eq("id", connectionId).single();
  const c = cd as Connection | null;
  if (!c) return { ok: false, message: "Unknown connection" };
  if (c.provider !== "xero") return { ok: false, message: "Only Xero syncs automatically. Use the journal file for other packages." };
  if (!c.tenant_id) return { ok: false, message: "Choose the Xero organisation first" };
  if (c.status === "paused") return { ok: false, message: "Sync is paused" };

  const { data: company } = await admin.from("companies").select("base_currency").eq("id", c.company_id).single();
  const base = (company as { base_currency: string } | null)?.base_currency;
  if (c.tenant_currency && base && c.tenant_currency !== base) {
    const m = `Xero's base currency is ${c.tenant_currency} but Kageflow's is ${base}. Connect the Xero organisation that keeps its books in ${base}.`;
    await finish(admin, c.id, m, null);
    return { ok: false, message: m };
  }

  // one run at a time per connection
  const now = new Date().toISOString();
  const { data: locked } = await admin.from("accounting_connections")
    .update({ sync_lock_until: new Date(Date.now() + 5 * 60_000).toISOString() })
    .eq("id", c.id).or(`sync_lock_until.is.null,sync_lock_until.lt.${now}`).select("id");
  if (!locked?.length) return { ok: false, message: "A sync is already running. Try again in a few minutes." };
  try {
    return await run(admin, c, limit);
  } finally {
    await admin.from("accounting_connections").update({ sync_lock_until: null }).eq("id", c.id);
  }
}

async function run(admin: SupabaseClient, c: Connection, limit: number): Promise<{ ok: boolean; message: string }> {
  const tenantId = c.tenant_id!;
  const { data: jd, error: je } = await admin.rpc("accounting_unsent_journals", { p_connection: c.id, p_limit: limit });
  if (je) return { ok: false, message: je.message };
  const journals = (jd ?? []) as Journal[];
  if (journals.length === 0) {
    await finish(admin, c.id, "ok", { sent: 0, journals: 0, failed: 0 });
    return { ok: true, message: "Nothing new to send. Xero is up to date." };
  }

  const { data: ld } = await admin.from("journal_lines").select("journal_id, account_id, description, debit, credit, line_no").in("journal_id", journals.map((j) => j.id)).order("line_no");
  const lines = ((ld ?? []) as Line[]).map((l) => ({ ...l, debit: Number(l.debit), credit: Number(l.credit) }));
  const { data: md } = await admin.from("accounting_account_map").select("account_id, external_id, external_code").eq("connection_id", c.id);
  const map = new Map(((md ?? []) as Mapping[]).filter((m) => m.external_id || m.external_code).map((m) => [m.account_id, m]));

  const missing = [...new Set(lines.filter((l) => !map.has(l.account_id)).map((l) => l.account_id))];
  if (missing.length) {
    const { data: names } = await admin.from("accounts").select("code, name").in("id", missing);
    const list = ((names ?? []) as { code: string; name: string }[]).map((a) => `${a.code} ${a.name}`).join(", ");
    const m = `Choose the Xero account for: ${list}. Nothing was sent.`;
    await finish(admin, c.id, m, { sent: 0, journals: journals.length, failed: 0 });
    return { ok: false, message: m };
  }

  const target = (accountId: string) => {
    const m = map.get(accountId)!;
    return m.external_code ? { AccountCode: m.external_code } : { AccountID: m.external_id! };
  };
  const byJournal = new Map<string, Line[]>();
  for (const l of lines) byJournal.set(l.journal_id, [...(byJournal.get(l.journal_id) ?? []), l]);

  // what we send: one Xero journal per Kageflow journal, or one per day
  type Unit = { journalIds: string[]; mj: ManualJournal };
  const units: Unit[] = [];
  if (c.mode === "daily") {
    const days = new Map<string, Journal[]>();
    for (const j of journals) days.set(j.journal_date, [...(days.get(j.journal_date) ?? []), j]);
    for (const [day, js] of days) {
      const net = new Map<string, number>();
      for (const j of js) for (const l of byJournal.get(j.id) ?? []) net.set(l.account_id, (net.get(l.account_id) ?? 0) + l.debit - l.credit);
      const jl = [...net].map(([a, v]) => ({ LineAmount: r2(v), ...target(a), Description: "Kageflow daily total" })).filter((l) => l.LineAmount !== 0);
      const nums = js.map((j) => j.number).filter(Boolean);
      const narration = `Kageflow ${day}: ${js.length} entr${js.length === 1 ? "y" : "ies"}${nums.length ? ` (${nums[0]} to ${nums[nums.length - 1]})` : ""}`;
      units.push({ journalIds: js.map((j) => j.id), mj: { Narration: narration, Date: day, Status: "POSTED", LineAmountTypes: "NoTax", JournalLines: jl } });
    }
  } else {
    for (const j of journals) {
      const jl = (byJournal.get(j.id) ?? []).map((l) => ({ LineAmount: r2(l.debit - l.credit), ...target(l.account_id), Description: (l.description ?? j.description).slice(0, 400) })).filter((l) => l.LineAmount !== 0);
      units.push({ journalIds: [j.id], mj: { Narration: `${j.number ? `${j.number} · ` : ""}${j.description}`.slice(0, 500), Date: j.journal_date, Status: "POSTED", LineAmountTypes: "NoTax", JournalLines: jl } });
    }
  }

  let sent = 0, failed = 0;
  const errors: string[] = [];
  const empty = units.filter((u) => u.mj.JournalLines.length === 0);
  // a journal whose lines net to nothing (e.g. moving money within one mapped account) has nothing to send
  if (empty.length) {
    await admin.from("accounting_sync_log").insert(empty.flatMap((u) => u.journalIds.map((jid) => ({ company_id: c.company_id, connection_id: c.id, journal_id: jid, external_id: null }))));
    sent += empty.length;
  }
  const todo = units.filter((u) => u.mj.JournalLines.length > 0);
  try {
    const token = await accessToken(admin, c.id);
    for (let i = 0; i < todo.length; i += BATCH) {
      const chunk = todo.slice(i, i + BATCH);
      const results = await createJournals(token, tenantId, chunk.map((u) => u.mj));
      const rows: { company_id: string; connection_id: string; journal_id: string; external_id: string }[] = [];
      results.forEach((r, k) => {
        const u = chunk[k]!;
        if (r.id) { sent++; for (const jid of u.journalIds) rows.push({ company_id: c.company_id, connection_id: c.id, journal_id: jid, external_id: r.id }); }
        else { failed++; if (errors.length < 3) errors.push(`${u.mj.Narration.slice(0, 60)}: ${r.error}`); }
      });
      if (rows.length) {
        const { error } = await admin.from("accounting_sync_log").insert(rows);
        if (error) throw new Error(`Sent to Xero but couldn't record it: ${error.message}`);
      }
    }
  } catch (e) {
    const err = e as Error;
    const reconnect = e instanceof XeroError && e.kind === "reconnect";
    const m = reconnect ? "Xero needs to be connected again (access expired or was removed)." : err.message;
    await finish(admin, c.id, m, { sent, journals: journals.length, failed }, reconnect ? { status: "needs_reconnect" } : {});
    return { ok: false, message: m };
  }

  const more = journals.length >= limit ? " More are waiting and go on the next run." : "";
  const status = failed ? `${failed} not accepted by Xero. ${errors.join(" | ")}` : "ok";
  await finish(admin, c.id, status, { sent, journals: journals.length, failed });
  return { ok: failed === 0, message: failed ? status : `Sent ${sent} journal${sent === 1 ? "" : "s"} to Xero.${more}` };
}

/** Kageflow journals as a CSV for Sage, Pastel or any package that imports journals */
export function journalCsv(rows: { date: string; reference: string; code: string; name: string; description: string; debit: number; credit: number }[]) {
  const cell = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  return ["Date,Reference,Account Code,Account Name,Description,Debit,Credit",
    ...rows.map((r) => [dmy(r.date), r.reference, r.code, r.name, r.description, r.debit ? r.debit.toFixed(2) : "", r.credit ? r.credit.toFixed(2) : ""].map(cell).join(","))].join("\r\n");
}
