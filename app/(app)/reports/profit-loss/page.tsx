import type { Metadata } from "next";
import Link from "next/link";
import { Button, Empty, Input, PageHeader, Panel } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { getContext } from "@/lib/context";
import { date, money } from "@/lib/format";
import { month, taxYear, validDate } from "@/lib/periods";

export const metadata: Metadata = { title: "Profit and loss" };

type Mv = { account_id: string; code: string; name: string; type: string; system_key: string | null; debit: number; credit: number };

export default async function ProfitLossPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const def = taxYear();
  const from = validDate(sp.from) ? sp.from : def.from;
  const to = validDate(sp.to) ? sp.to : def.to;
  const { data, error } = await ctx.supabase.rpc("account_movements", { p_company: ctx.companyId, p_from: from, p_to: to });
  const rows = ((data ?? []) as Mv[]).filter((r) => r.type === "income" || r.type === "expense")
    .map((r) => ({ ...r, value: r.type === "income" ? Number(r.credit) - Number(r.debit) : Number(r.debit) - Number(r.credit) }))
    .filter((r) => Math.round(r.value * 100) !== 0)
    .sort((a, b) => a.code.localeCompare(b.code));
  const income = rows.filter((r) => r.type === "income" && !["fx_gain"].includes(r.system_key ?? ""));
  const cos = rows.filter((r) => r.type === "expense" && r.code.startsWith("5"));
  const opex = rows.filter((r) => r.type === "expense" && !r.code.startsWith("5") && r.system_key !== "fx_loss");
  const fx = rows.filter((r) => ["fx_gain", "fx_loss"].includes(r.system_key ?? ""));
  const sum = (xs: typeof rows) => xs.reduce((s, r) => s + r.value, 0);
  const revenue = sum(income);
  const gross = revenue - sum(cos);
  const fxNet = fx.reduce((s, r) => s + (r.type === "income" ? r.value : -r.value), 0);
  const net = gross - sum(opex) + fxNet;
  const base = ctx.company.base_currency;
  const presets = [["This tax year", taxYear()], ["Last tax year", taxYear(-1)], ["This month", month()], ["Last month", month(-1)]] as const;

  const Section = ({ title, items, sign = 1 }: { title: string; items: typeof rows; sign?: number }) => items.length ? (
    <>
      <tr><td colSpan={2} className="px-4 pt-4 pb-1 text-[13px] font-semibold text-ink-soft">{title}</td></tr>
      {items.map((r) => (
        <tr key={r.account_id}><td className="px-4 py-1"><Link href={`/accounting/accounts/${r.account_id}`} className="hover:underline">{r.code} {r.name}</Link></td><td className="num px-4 py-1">{money(sign * r.value, base)}</td></tr>
      ))}
    </>
  ) : null;
  const Total = ({ label, value, strong }: { label: string; value: number; strong?: boolean }) => (
    <tr className={`border-t border-line ${strong ? "text-[15px] font-semibold" : "font-medium"}`}><td className="px-4 py-2">{label}</td><td className={`num px-4 py-2 ${value < 0 ? "text-ember-700" : ""}`}>{money(value, base)}</td></tr>
  );

  return (
    <>
      <PageHeader title="Profit and loss" description={`${ctx.company.name}, ${date(from)} to ${date(to)}. Posted entries only.`}
        actions={<div className="print:hidden"><PrintButton /></div>} />
      <div className="mb-4 flex flex-wrap items-end gap-3 print:hidden">
        <nav className="flex flex-wrap gap-1">
          {presets.map(([l, p]) => (
            <Link key={l} href={`?from=${p.from}&to=${p.to}`} className={`rounded-full px-3 py-1 text-[13px] ${p.from === from && p.to === to ? "bg-shadow-800 text-white" : "text-ink-soft hover:bg-shadow-100"}`}>{l}</Link>
          ))}
        </nav>
        <form className="ml-auto flex items-center gap-2">
          <Input type="date" name="from" defaultValue={from} aria-label="From" className="w-40" />
          <Input type="date" name="to" defaultValue={to} aria-label="To" className="w-40" />
          <Button type="submit" size="sm">Update</Button>
        </form>
      </div>
      {error && <p className="mb-4 text-ember-700">{error.message}</p>}
      <Panel flush className="max-w-3xl">
        {rows.length === 0 ? <Empty title="Nothing posted in this period" /> : (
          <table className="w-full text-sm">
            <tbody>
              <Section title="Income" items={income} />
              <Total label="Total income" value={revenue} />
              <Section title="Cost of sales" items={cos} />
              <Total label="Gross profit" value={gross} />
              <Section title="Operating expenses" items={opex} />
              <Total label="Total operating expenses" value={sum(opex)} />
              {fx.length > 0 && <Section title="Exchange differences" items={fx} sign={1} />}
              {fx.length > 0 && <Total label="Net exchange gain (loss)" value={fxNet} />}
              <Total label={net >= 0 ? "Net profit before tax" : "Net loss before tax"} value={net} strong />
            </tbody>
          </table>
        )}
      </Panel>
      {revenue > 0 && <p className="mt-3 text-[13px] text-ink-faint">Gross margin {((gross / revenue) * 100).toFixed(1)}%. Net margin {((net / revenue) * 100).toFixed(1)}%.</p>}
    </>
  );
}
