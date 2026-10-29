import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Field, Input, Notice, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { SubmitButton } from "@/components/submit-button";
import { getContext } from "@/lib/context";
import { date, dateTime, moneyFor } from "@/lib/format";
import { month, periodLabel, validDate, vatPeriods } from "@/lib/periods";
import { fileVatReturn, undoVatReturn } from "../actions";

export const metadata: Metadata = { title: "VAT return" };

type V = Record<string, number> & { filed: { id: string; period_from: string; period_to: string; filed_at: string; sars_reference: string | null } | null };
type Ret = { id: string; period_from: string; period_to: string; output_tax: number; input_tax: number; net_payable: number; sars_reference: string | null; filed_at: string; reversal_journal_id: string | null; journal_id: string | null };

export default async function VatPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; cat?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const money = moneyFor(ctx.company.base_currency);
  const monthly = sp.cat === "m";
  const even = sp.cat !== "a";
  const periods = monthly ? [0, -1, -2, -3, -4, -5].map((o) => month(o)) : vatPeriods(even, 6);
  const last = periods[1] ?? periods[0]!;
  const from = validDate(sp.from) ? sp.from : last.from;
  const to = validDate(sp.to) ? sp.to : last.to;
  const base = ctx.company.base_currency;
  const [{ data, error }, { data: rets }] = await Promise.all([
    ctx.supabase.rpc("vat201", { p_company: ctx.companyId, p_from: from, p_to: to }),
    ctx.supabase.from("vat_returns").select("*").eq("company_id", ctx.companyId).order("period_to", { ascending: false }).limit(24),
  ]);
  const v = (data ?? {}) as V;
  const n = (k: string) => Number(v[k] ?? 0);
  const other = n("output_from_other_entries");
  const canFile = ctx.can("ledger.write");
  const vatVendor = !!ctx.company.vat_no?.trim();
  const r = ctx.rules;
  const za = r.code === "ZA";
  const tax = r.taxAuthority;
  const cat = monthly ? "m" : even ? "b" : "a";

  const Row = ({ field, label, value, tax, taxField }: { field: string; label: string; value?: number; tax?: number; taxField?: string }) => (
    <tr className="border-t border-line">
      <td className="px-4 py-2 text-ink-soft">{label}</td>
      <td className="w-14 px-2 py-2 text-center text-xs font-semibold text-ink-faint">{za ? field : ""}</td>
      <td className="num px-4 py-2">{value !== undefined ? money(value, base) : ""}</td>
      <td className="w-14 px-2 py-2 text-center text-xs font-semibold text-ink-faint">{za ? (taxField ?? "") : ""}</td>
      <td className="num px-4 py-2">{tax !== undefined ? money(tax, base) : ""}</td>
    </tr>
  );

  return (
    <>
      <PageHeader title={r.vatReturnName} description={`${periodLabel(from, to)} on the invoice basis. ${r.vatReturnWhere}`} actions={<div className="print:hidden"><PrintButton /></div>} />
      <Notice params={sp} />
      {!vatVendor && <p className="mb-4 rounded-[var(--radius-control)] bg-amber-50 px-4 py-2 text-amber-700">Your company has no VAT number in Settings, Company. Add it if you are a registered VAT vendor.</p>}
      <div className="mb-4 flex flex-wrap items-end gap-3 print:hidden">
        <nav className="flex flex-wrap gap-1">
          {periods.map((p) => (
            <Link key={p.from} href={`?from=${p.from}&to=${p.to}&cat=${cat}`} className={`rounded-full px-3 py-1 text-[13px] ${p.from === from && p.to === to ? "bg-shadow-800 text-white" : "text-ink-soft hover:bg-shadow-100"}`}>{periodLabel(p.from, p.to)}</Link>
          ))}
        </nav>
        <span className="flex gap-3 text-[13px]">
          {cat !== "b" && <Link href="?cat=b" className="text-shadow-700 hover:underline">Two months, ending in even months</Link>}
          {cat !== "a" && <Link href="?cat=a" className="text-shadow-700 hover:underline">Two months, ending in odd months</Link>}
          {cat !== "m" && <Link href="?cat=m" className="text-shadow-700 hover:underline">Monthly</Link>}
        </span>
        <form className="ml-auto flex items-center gap-2">
          <Input type="date" name="from" defaultValue={from} aria-label="From" className="w-40" />
          <Input type="date" name="to" defaultValue={to} aria-label="To" className="w-40" />
          <Button type="submit" size="sm">Update</Button>
        </form>
      </div>
      {error && <p className="mb-4 text-ember-700">{error.message}</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-6">
          <Panel title="Output tax" flush>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-ink-faint"><th className="px-4 py-2 font-medium">Supplies</th><th /><th className="px-4 py-2 text-right font-medium">Consideration incl. VAT</th><th /><th className="px-4 py-2 text-right font-medium">VAT</th></tr></thead>
              <tbody>
                <Row field="1" label="Standard rate (excluding capital goods)" value={n("field_1")} taxField="4" tax={n("field_4")} />
                {za && <Row field="1A" label="Standard rate (capital goods)" value={0} taxField="4A" tax={0} />}
                <Row field="2" label={za ? "Zero rate (excluding exported goods)" : "Zero-rated supplies (local)"} value={n("field_2")} />
                <Row field="2A" label={za ? "Zero rate (exported goods)" : "Zero-rated supplies (exports)"} value={n("field_2a")} />
                <Row field="3" label="Exempt and non-supplies" value={n("field_3")} />
                <tr className="border-t border-line font-semibold"><td className="px-4 py-2">Total output tax</td><td /><td /><td className="px-2 py-2 text-center text-xs text-ink-faint">{za ? "13" : ""}</td><td className="num px-4 py-2">{money(n("field_13"), base)}</td></tr>
              </tbody>
            </table>
            {Math.abs(other) >= 0.01 && <p className="border-t border-line px-4 py-2 text-[13px] text-amber-700">{money(other, base)} of output VAT came from journals or bank entries, not invoices. Check it belongs in output tax before filing.</p>}
          </Panel>
          <Panel title="Input tax" flush>
            <table className="w-full text-sm">
              <tbody>
                <Row field="14" label="Capital goods and services supplied to you" value={n("field_14")} taxField="14A" tax={n("field_14a")} />
                <Row field="15" label="Other goods and services supplied to you" value={n("field_15")} taxField="15A" tax={n("field_15a")} />
                <tr className="border-t border-line font-semibold"><td className="px-4 py-2">Total input tax</td><td /><td /><td className="px-2 py-2 text-center text-xs text-ink-faint">{za ? "19" : ""}</td><td className="num px-4 py-2">{money(n("field_19"), base)}</td></tr>
              </tbody>
            </table>
            <p className="border-t border-line px-4 py-2 text-[13px] text-ink-faint">{za ? "Field 15" : "The amount for other goods and services"} is worked back from the VAT at {r.vatRateLabel}. Capital goods are purchases posted to accounts 1500 and 1600.</p>
          </Panel>
          <div className="rounded-[var(--radius-panel)] border border-line bg-surface px-5 py-4">
            <div className="flex items-baseline justify-between">
              <span className="font-semibold">{n("field_20") >= 0 ? `VAT payable to ${tax}` : `VAT refund due from ${tax}`} {za && <span className="text-xs text-ink-faint">field 20</span>}</span>
              <span className={`text-[22px] font-semibold tabular-nums ${n("field_20") >= 0 ? "" : "text-jade-700"}`}>{money(Math.abs(n("field_20")), base)}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6 print:hidden">
          <Panel title="File this period">
            {v.filed ? (
              <p className="text-sm text-ink-soft"><Badge tone="jade">Filed</Badge> {periodLabel(v.filed.period_from, v.filed.period_to)} was recorded on {dateTime(v.filed.filed_at)}{v.filed.sars_reference ? `, ${tax} ref ${v.filed.sars_reference}` : ""}. Entries posted into this period afterwards are not in that return.</p>
            ) : canFile ? (
              <form action={fileVatReturn} className="flex flex-col gap-3">
                <input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} />
                <p className="text-sm text-ink-soft">After you submit your return to {tax}, record it here. Kageflow moves this period&apos;s VAT into VAT control, so the next period starts clean.</p>
                <Field label={`${tax} reference (optional)`}><Input name="reference" /></Field>
                <SubmitButton confirm={`Record the VAT return for ${periodLabel(from, to)}?`} pendingText="Recording…">Mark as filed</SubmitButton>
              </form>
            ) : <p className="text-sm text-ink-soft">An accountant, admin or owner records filed returns.</p>}
          </Panel>
          <Panel title="Filed returns" flush>
            {((rets ?? []) as Ret[]).length === 0 ? <p className="px-4 py-3 text-sm text-ink-faint">None yet.</p> : (
              <Table>
                <thead><tr><Th>Period</Th><Th className="text-right">Net</Th><Th /></tr></thead>
                <tbody>
                  {((rets ?? []) as Ret[]).map((r) => (
                    <tr key={r.id} className="align-top">
                      <Td><Link className="hover:underline" href={`?from=${r.period_from}&to=${r.period_to}`}>{periodLabel(r.period_from, r.period_to)}</Link><div className="text-xs text-ink-faint">{date(r.filed_at.slice(0, 10))}</div></Td>
                      <Td className="num">{money(r.net_payable, base)}</Td>
                      <Td className="text-right">
                        {r.reversal_journal_id ? <Badge>Undone</Badge> : canFile && (
                          <form action={undoVatReturn}>
                            <input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={`/reports/vat?from=${from}&to=${to}`} />
                            <SubmitButton tone="quiet" size="sm" confirm="Undo this VAT return? Its transfer entry will be reversed.">Undo</SubmitButton>
                          </form>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
