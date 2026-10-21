import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Empty, Notice, PageHeader, Panel, Stat, Table, Td, Th } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { StatementImport } from "@/components/banking/statement-import";
import { getContext } from "@/lib/context";
import { fail } from "@/lib/forms";
import { date, money, today } from "@/lib/format";
import { autoMatch, ignoreLine, importStatement, matchLine, postLine, unmatchLine } from "../actions";

export const metadata: Metadata = { title: "Reconcile" };

type Line = { id: string; txn_date: string; description: string; amount: number; balance: number | null; status: string; journal_line_id: string | null; created_at: string };
type Open = { journal_line_id: string; journal_id: string; journal_number: string | null; journal_date: string; description: string; amount: number };
const MANAGED = ["receivables", "payables", "vat_input", "vat_output", "inventory", "customer_deposits"];
const dayDiff = (a: string, b: string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 864e5;

export default async function ReconcilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string; show?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await getContext();
  if (!ctx.can("banking.write")) fail("/dashboard", "Only owners, admins and accountants can reconcile the bank");
  const { data: bank } = await ctx.supabase.from("accounts").select("id, code, name, type").eq("id", id).eq("company_id", ctx.companyId).maybeSingle();
  if (!bank) notFound();
  const base = ctx.company.base_currency;

  const [{ data: lineData }, { data: openData }, { data: tb }, { data: accts }, { data: taxes }] = await Promise.all([
    ctx.supabase.from("bank_statement_lines").select("*").eq("bank_account_id", id).order("txn_date", { ascending: false }).order("created_at", { ascending: false }).limit(3000),
    ctx.supabase.rpc("bank_open_entries", { p_bank: id }),
    ctx.supabase.rpc("trial_balance", { p_company: ctx.companyId, p_as_of: today() }),
    ctx.supabase.from("accounts").select("id, code, name, type, system_key").eq("company_id", ctx.companyId).eq("is_active", true).order("code"),
    ctx.supabase.from("tax_rates").select("id, name, code").eq("company_id", ctx.companyId).eq("is_active", true),
  ]);
  const lines = (lineData ?? []) as Line[];
  const open = ((openData ?? []) as Open[]).map((o) => ({ ...o, amount: Number(o.amount) }));
  const unmatched = lines.filter((l) => l.status === "unmatched");
  const matched = lines.filter((l) => l.status === "matched");
  const ignored = lines.filter((l) => l.status === "ignored");
  const kfBalance = Number(((tb ?? []) as { account_id: string; balance: number }[]).find((r) => r.account_id === id)?.balance ?? 0);
  const withBal = lines.find((l) => l.balance !== null);
  const earliest = lines.length ? lines[lines.length - 1]!.txn_date : null;
  const notOnStatement = earliest ? open.filter((o) => o.journal_date >= earliest) : [];
  const postable = ((accts ?? []) as { id: string; code: string; name: string; type: string; system_key: string | null }[]).filter((a) => a.id !== id && !MANAGED.includes(a.system_key ?? ""));
  const vatStd = ((taxes ?? []) as { id: string; name: string; code: string }[]).find((t) => t.code === "STD");
  const vatVendor = !!ctx.company.vat_no?.trim();

  return (
    <>
      <PageHeader title={`${bank.code} ${bank.name}`} description="Import a statement, then clear every line: match it, post it, or ignore it." back={{ href: "/banking", label: "Bank" }}
        actions={unmatched.length > 0 && (
          <form action={autoMatch}><input type="hidden" name="bank_id" value={id} /><SubmitButton tone="secondary" pendingText="Matching…">Match automatically</SubmitButton></form>
        )} />
      <Notice params={sp} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Balance in Kageflow" value={money(kfBalance, base)} />
        <Stat label="Last statement balance" value={withBal ? money(withBal.balance, base) : "Not in file"} sub={withBal ? date(withBal.txn_date) : undefined} />
        <Stat label="Statement lines to clear" value={String(unmatched.length)} />
        <Stat label="In Kageflow, not on statement" value={String(notOnStatement.length)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-6">
          <Panel title={`To reconcile (${unmatched.length})`} flush>
            {unmatched.length === 0 ? <Empty title={lines.length ? "Everything is matched" : "No statement imported yet"}>{lines.length ? null : "Import a CSV statement on the right."}</Empty> : (
              <ul className="divide-y divide-line">
                {unmatched.map((l) => {
                  const amt = Number(l.amount);
                  const cands = open.filter((o) => o.amount === amt && dayDiff(o.journal_date, l.txn_date) <= 14).sort((a, b) => dayDiff(a.journal_date, l.txn_date) - dayDiff(b.journal_date, l.txn_date)).slice(0, 3);
                  return (
                    <li key={l.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div><span className="text-[13px] text-ink-faint">{date(l.txn_date)}</span> <span className="font-medium">{l.description}</span></div>
                        <span className={`font-semibold tabular-nums ${amt < 0 ? "text-ember-700" : "text-jade-700"}`}>{money(amt, base)}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-start gap-2">
                        {cands.map((c) => (
                          <form key={c.journal_line_id} action={matchLine}>
                            <input type="hidden" name="bank_id" value={id} /><input type="hidden" name="line_id" value={l.id} /><input type="hidden" name="journal_line_id" value={c.journal_line_id} />
                            <SubmitButton tone="secondary" size="sm" pendingText="Matching…">Match: {c.journal_number} {date(c.journal_date)} · {c.description.slice(0, 40)}</SubmitButton>
                          </form>
                        ))}
                        <details className="w-full sm:w-auto">
                          <summary className="cursor-pointer py-1 text-[13px] font-medium text-shadow-700">{amt < 0 ? "Post as an expense or transfer" : "Post as income or transfer"}</summary>
                          <form action={postLine} className="mt-2 grid gap-2 rounded-[var(--radius-control)] bg-paper p-3 sm:grid-cols-2">
                            <input type="hidden" name="bank_id" value={id} /><input type="hidden" name="line_id" value={l.id} />
                            <select name="account_id" required defaultValue="" aria-label="Account" className="h-9 rounded-[var(--radius-control)] border border-line-strong bg-surface px-2 text-sm sm:col-span-2">
                              <option value="" disabled>Choose account…</option>
                              {(["expense", "income", "asset", "liability", "equity"] as const).map((t) => (
                                <optgroup key={t} label={t[0]!.toUpperCase() + t.slice(1)}>
                                  {postable.filter((a) => a.type === t).map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                                </optgroup>
                              ))}
                            </select>
                            {vatVendor && vatStd ? (
                              <select name="tax_rate_id" defaultValue="" aria-label="VAT" className="h-9 rounded-[var(--radius-control)] border border-line-strong bg-surface px-2 text-sm">
                                <option value="">No VAT</option>
                                <option value={vatStd.id}>Includes 15% VAT</option>
                              </select>
                            ) : <span />}
                            <input name="description" defaultValue={l.description} aria-label="Description" className="h-9 rounded-[var(--radius-control)] border border-line-strong bg-surface px-2 text-sm" />
                            <div className="sm:col-span-2"><SubmitButton size="sm" pendingText="Posting…">Post and match</SubmitButton></div>
                            <p className="text-xs text-ink-faint sm:col-span-2">Customer payments and supplier bills: record them in Sales or Bills instead, then press Match automatically.</p>
                          </form>
                        </details>
                        <form action={ignoreLine} className="ml-auto">
                          <input type="hidden" name="bank_id" value={id} /><input type="hidden" name="line_id" value={l.id} />
                          <SubmitButton tone="quiet" size="sm" pendingText="…">Ignore</SubmitButton>
                        </form>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          {notOnStatement.length > 0 && (
            <Panel title="In Kageflow but not on the statement" flush>
              <p className="px-4 pt-3 text-[13px] text-ink-soft">Usually payments that haven&apos;t cleared yet, or entries posted to the wrong bank account.</p>
              <Table>
                <thead><tr><Th>Date</Th><Th>Entry</Th><Th className="text-right">Amount</Th></tr></thead>
                <tbody>
                  {notOnStatement.slice(0, 100).map((o) => (
                    <tr key={o.journal_line_id}><Td className="whitespace-nowrap text-ink-soft">{date(o.journal_date)}</Td><Td><Link className="hover:underline" href={`/accounting/journals/${o.journal_id}`}>{o.journal_number}</Link> {o.description}</Td><Td className="num">{money(o.amount, base)}</Td></tr>
                  ))}
                </tbody>
              </Table>
            </Panel>
          )}

          {(matched.length > 0 || ignored.length > 0) && (
            <Panel title="Cleared" flush>
              <details open={sp.show === "cleared"}>
                <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium text-shadow-700">Show {matched.length} matched and {ignored.length} ignored lines</summary>
                <Table>
                  <tbody>
                    {[...matched.slice(0, 200), ...ignored].map((l) => (
                      <tr key={l.id}>
                        <Td className="whitespace-nowrap text-ink-soft">{date(l.txn_date)}</Td>
                        <Td>{l.description}{l.status === "ignored" && <span className="ml-2 text-xs text-ink-faint">ignored</span>}</Td>
                        <Td className="num">{money(l.amount, base)}</Td>
                        <Td className="text-right">
                          {l.status === "matched" ? (
                            <form action={unmatchLine}><input type="hidden" name="bank_id" value={id} /><input type="hidden" name="line_id" value={l.id} /><SubmitButton tone="quiet" size="sm" pendingText="…">Unmatch</SubmitButton></form>
                          ) : (
                            <form action={ignoreLine}><input type="hidden" name="bank_id" value={id} /><input type="hidden" name="line_id" value={l.id} /><input type="hidden" name="ignore" value="false" /><SubmitButton tone="quiet" size="sm" pendingText="…">Restore</SubmitButton></form>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </details>
            </Panel>
          )}
        </div>

        <Panel title="Import a statement">
          <StatementImport bankId={id} action={importStatement} />
          <p className="mt-4 text-xs text-ink-faint">Importing the same statement twice is safe: lines already imported are skipped.</p>
        </Panel>
      </div>
    </>
  );
}
