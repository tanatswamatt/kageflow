import type { Metadata } from "next";
import { Badge, ButtonLink, buttonClass, Field, Input, Notice, PageHeader, Panel, Select, Table, Td, Th } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { getContext } from "@/lib/context";
import { date, dateTime, today } from "@/lib/format";
import { xeroConfigured } from "@/lib/xero";
import type { Connection } from "@/lib/accounting-sync";
import { autoMatch, chooseTenant, disconnectXero, refreshAccountsAction, saveMapping, saveSyncSettings, syncNowAction, togglePause } from "./actions";

export const metadata: Metadata = { title: "Accounting software" };

type Account = { id: string; code: string; name: string; type: string };
type Map = { account_id: string; external_id: string | null; external_name: string | null; external_code: string | null };
type Sent = { journal_id: string; sent_at: string; external_id: string | null };

const STATUS: Record<Connection["status"], [string, "jade" | "amber" | "neutral" | "ember"]> = {
  active: ["Sending every hour", "jade"], paused: ["Paused", "neutral"], pending: ["Not finished", "amber"], needs_reconnect: ["Connect again", "ember"],
};

export default async function AccountingSyncPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  if (!ctx.can("ledger.write")) return <Panel><p className="text-ink-soft">Only owners, admins and accountants can manage the link to your accounting software.</p></Panel>;
  const manage = ctx.can("company.manage");

  const { data: cd } = await ctx.supabase.from("accounting_connections").select("*").eq("company_id", ctx.companyId).eq("provider", "xero").maybeSingle();
  const c = cd as Connection | null;
  const [{ data: accs }, { data: maps }, { data: sent }, { data: used }] = await Promise.all([
    ctx.supabase.from("accounts").select("id, code, name, type").eq("company_id", ctx.companyId).eq("is_active", true).order("code"),
    c ? ctx.supabase.from("accounting_account_map").select("account_id, external_id, external_name, external_code").eq("connection_id", c.id) : Promise.resolve({ data: [] }),
    c ? ctx.supabase.from("accounting_sync_log").select("journal_id, sent_at, external_id").eq("connection_id", c.id).order("sent_at", { ascending: false }).limit(15) : Promise.resolve({ data: [] }),
    c ? ctx.supabase.rpc("accounting_unsent_journals", { p_connection: c.id, p_limit: 1000 }) : Promise.resolve({ data: [] }),
  ]);
  const accounts = (accs ?? []) as Account[];
  const mapping = new Map(((maps ?? []) as Map[]).map((m) => [m.account_id, m]));
  const waiting = ((used ?? []) as { id: string }[]).length;
  const sentRows = (sent ?? []) as Sent[];
  const { data: sentJ } = sentRows.length
    ? await ctx.supabase.from("journals").select("id, number, journal_date, description").in("id", sentRows.map((s) => s.journal_id))
    : { data: [] };
  const jinfo = new Map(((sentJ ?? []) as { id: string; number: string | null; journal_date: string; description: string }[]).map((j) => [j.id, j]));

  // accounts used by journals still to send must be matched before anything goes
  let needed = new Set<string>();
  if (c && waiting) {
    const ids = ((used ?? []) as { id: string }[]).map((j) => j.id).slice(0, 300);
    const { data: ls } = await ctx.supabase.from("journal_lines").select("account_id").in("journal_id", ids);
    needed = new Set(((ls ?? []) as { account_id: string }[]).map((l) => l.account_id));
  }
  const unmatched = [...needed].filter((a) => !mapping.get(a)?.external_id);
  const ext = c?.external_accounts ?? [];
  const configured = xeroConfigured();

  return (
    <>
      <PageHeader
        title="Accounting software"
        description="Keep your accountant's books in step with Kageflow. Every posted entry (invoices, payments, bills, stock costs, commission) goes to Xero as a journal. Sage, Pastel and others take a journal file."
      />
      <Notice params={sp} />
      <div className="flex flex-col gap-6">
        <Panel
          title={<span className="flex items-center gap-2">Xero {c && <Badge tone={STATUS[c.status][1]}>{STATUS[c.status][0]}</Badge>}</span>}
          action={c?.tenant_id && c.status !== "needs_reconnect" ? (
            <form action={syncNowAction}><SubmitButton size="sm" pendingText="Sending…">Sync now</SubmitButton></form>
          ) : undefined}
        >
          {!configured ? (
            <p className="text-ink-soft">Xero isn&apos;t switched on for this Kageflow server yet. Pretan adds the Xero app keys; then owners can connect here.</p>
          ) : !c || c.status === "needs_reconnect" ? (
            <div className="flex flex-col gap-3">
              <p className="text-ink-soft">{c ? "Kageflow can't reach Xero any more. Connect again: journals already sent are remembered and never sent twice." : "Sign in to Xero and choose the organisation that holds this company's books."}</p>
              {manage ? <div><ButtonLink href="/api/xero/connect" tone="primary" prefetch={false}>{c ? "Connect Xero again" : "Connect Xero"}</ButtonLink></div> : <p className="text-[13px] text-ink-faint">An owner or admin connects Xero.</p>}
            </div>
          ) : !c.tenant_id ? (
            <form action={chooseTenant} className="flex flex-wrap items-end gap-3">
              <Field label="Which Xero organisation is this company?">
                <Select name="tenant_id" required defaultValue="">{[<option key="" value="" disabled>Choose…</option>, ...(c.tenants ?? []).map((t) => <option key={t.tenantId} value={t.tenantId}>{t.tenantName}</option>)]}</Select>
              </Field>
              <SubmitButton pendingText="Saving…">Use this organisation</SubmitButton>
            </form>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="text-sm">
                  <div><span className="text-ink-faint">Organisation</span> <strong>{c.tenant_name}</strong>{c.tenant_currency ? <span className="text-ink-faint"> · books in {c.tenant_currency}</span> : null}</div>
                  <div className="mt-1 text-ink-soft">
                    {c.last_synced_at ? <>Last run {dateTime(c.last_synced_at)}: {c.last_status === "ok" ? `${c.last_counts?.sent ?? 0} sent` : <span className="text-ember-700">{c.last_status}</span>}</> : "Nothing sent yet"}
                    {" · "}{waiting ? <strong>{waiting} entr{waiting === 1 ? "y" : "ies"} waiting</strong> : "Up to date"}
                  </div>
                </div>
                {manage && (
                  <div className="flex gap-1.5">
                    <form action={togglePause}><input type="hidden" name="pause" value={String(c.status !== "paused")} /><SubmitButton size="sm" tone="quiet" pendingText="…">{c.status === "paused" ? "Resume" : "Pause"}</SubmitButton></form>
                    <form action={disconnectXero}><SubmitButton size="sm" tone="quiet" confirm="Disconnect Xero? Nothing more is sent until you connect again." pendingText="…">Disconnect</SubmitButton></form>
                  </div>
                )}
              </div>
              {manage && (
                <form action={saveSyncSettings} className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
                  <Field label="Send entries dated from" hint="Usually the first day after your accountant's last closed month">
                    <Input type="date" name="sync_from" defaultValue={c.sync_from} max={today()} />
                  </Field>
                  <Field label="In Xero, show">
                    <Select name="mode" defaultValue={c.mode}>
                      <option value="each">Each entry as its own journal (best audit trail)</option>
                      <option value="daily">One journal per day (tidier, fewer lines)</option>
                    </Select>
                  </Field>
                  <SubmitButton size="sm" tone="secondary" pendingText="Saving…">Save</SubmitButton>
                </form>
              )}
            </div>
          )}
        </Panel>

        {c?.tenant_id && c.status !== "needs_reconnect" && (
          <Panel
            title="Match your accounts"
            action={
              <div className="flex gap-1.5">
                <form action={refreshAccountsAction}><SubmitButton size="sm" tone="quiet" pendingText="Reading…">Read Xero&apos;s accounts again</SubmitButton></form>
                <form action={autoMatch}><SubmitButton size="sm" tone="secondary" pendingText="Matching…">Match by code and name</SubmitButton></form>
              </div>
            }
            flush
          >
            <div className="border-b border-line px-5 py-3 text-[13px] text-ink-soft">
              {unmatched.length
                ? <span className="text-ember-700">{unmatched.length} account{unmatched.length === 1 ? "" : "s"} used by waiting entries {unmatched.length === 1 ? "has" : "have"} no Xero account yet. Nothing is sent until {unmatched.length === 1 ? "it's" : "they're"} matched.</span>
                : "Each Kageflow account posts to the Xero account you choose."}
              {" "}Xero doesn&apos;t allow journals on bank accounts, so match Kageflow&apos;s bank and cash accounts to a clearing account in Xero (for example &ldquo;Kageflow bank clearing&rdquo;) and code your Xero bank feed to it.
              {c.external_accounts_at && <span className="text-ink-faint"> Xero&apos;s accounts read {dateTime(c.external_accounts_at)}.</span>}
            </div>
            <form action={saveMapping}>
              <Table>
                <thead><tr><Th>Kageflow account</Th><Th>Type</Th><Th>Xero account</Th></tr></thead>
                <tbody>
                  {accounts.map((a) => {
                    const m = mapping.get(a.id);
                    const need = needed.has(a.id) && !m?.external_id;
                    return (
                      <tr key={a.id} className={need ? "bg-ember-50" : ""}>
                        <Td><span className="font-mono text-[12px] text-ink-faint">{a.code}</span> {a.name}{needed.has(a.id) && <span className="ml-2 text-[12px] text-ink-faint">in use</span>}</Td>
                        <Td className="capitalize text-ink-soft">{a.type}</Td>
                        <Td>
                          <Select name={`map_${a.id}`} defaultValue={m?.external_id ?? ""} className="w-full max-w-sm">
                            <option value="">Not matched</option>
                            {ext.map((e) => <option key={e.id} value={e.id}>{e.code ? `${e.code} · ` : ""}{e.name}</option>)}
                          </Select>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
              <div className="flex items-center justify-between gap-3 px-5 py-4">
                <p className="text-[13px] text-ink-faint">Kageflow works out your VAT201; Xero receives the VAT as balances, so file VAT from Kageflow.</p>
                <SubmitButton pendingText="Saving…">Save matches</SubmitButton>
              </div>
            </form>
          </Panel>
        )}

        {sentRows.length > 0 && (
          <Panel title="Recently sent to Xero" flush>
            <Table>
              <thead><tr><Th>Entry</Th><Th>Dated</Th><Th>Description</Th><Th>Sent</Th></tr></thead>
              <tbody>
                {sentRows.map((s) => {
                  const j = jinfo.get(s.journal_id);
                  return (
                    <tr key={s.journal_id}>
                      <Td className="font-mono text-[12px]">{j?.number ?? ""}</Td>
                      <Td>{j ? date(j.journal_date) : ""}</Td>
                      <Td className="text-ink-soft">{j?.description}{!s.external_id && <span className="text-ink-faint"> (nothing to post: nets to zero)</span>}</Td>
                      <Td>{dateTime(s.sent_at)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Panel>
        )}

        <Panel title="Sage, Pastel and other packages">
          <p className="mb-4 text-ink-soft">Download every posted entry for a period as a journal file (date, reference, account code and name, description, debit, credit). Import it as a journal batch in Sage Business Cloud, Sage Pastel or any package that takes a CSV. Sage live sync is next on the list.</p>
          <form action="/api/accounting/export" method="get" className="flex flex-wrap items-end gap-3">
            <Field label="From"><Input type="date" name="from" required defaultValue={today().slice(0, 8) + "01"} /></Field>
            <Field label="To"><Input type="date" name="to" required defaultValue={today()} /></Field>
            <button type="submit" className={buttonClass("secondary")}>Download journal file</button>
          </form>
        </Panel>
      </div>
    </>
  );
}
