import type { Metadata } from "next";
import Link from "next/link";
import { Button, Empty, Input, PageHeader, Panel } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { getContext } from "@/lib/context";
import { date, moneyFor, today } from "@/lib/format";
import { validDate } from "@/lib/periods";

export const metadata: Metadata = { title: "Balance sheet" };

type Row = { account_id: string; code: string; name: string; type: string; balance: number };

export default async function BalanceSheetPage({ searchParams }: { searchParams: Promise<{ as_of?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const money = moneyFor(ctx.company.base_currency);
  const asOf = validDate(sp.as_of) ? sp.as_of : today();
  const { data, error } = await ctx.supabase.rpc("trial_balance", { p_company: ctx.companyId, p_as_of: asOf });
  const rows = ((data ?? []) as Row[]).map((r) => ({ ...r, balance: Number(r.balance) })).filter((r) => Math.round(r.balance * 100) !== 0).sort((a, b) => a.code.localeCompare(b.code));
  const assets = rows.filter((r) => r.type === "asset");
  const liabilities = rows.filter((r) => r.type === "liability").map((r) => ({ ...r, balance: -r.balance }));
  const equity = rows.filter((r) => r.type === "equity").map((r) => ({ ...r, balance: -r.balance }));
  const profit = -rows.filter((r) => r.type === "income" || r.type === "expense").reduce((s, r) => s + r.balance, 0);
  const sum = (xs: Row[]) => xs.reduce((s, r) => s + r.balance, 0);
  const totalAssets = sum(assets), totalLiab = sum(liabilities), totalEq = sum(equity) + profit;
  const balanced = Math.round(totalAssets * 100) === Math.round((totalLiab + totalEq) * 100);
  const base = ctx.company.base_currency;

  const Section = ({ title, items }: { title: string; items: Row[] }) => (
    <>
      <tr><td colSpan={2} className="px-4 pt-4 pb-1 text-[13px] font-semibold text-ink-soft">{title}</td></tr>
      {items.map((r) => <tr key={r.account_id}><td className="px-4 py-1"><Link href={`/accounting/accounts/${r.account_id}`} className="hover:underline">{r.code} {r.name}</Link></td><td className="num px-4 py-1">{money(r.balance, base)}</td></tr>)}
    </>
  );
  const Total = ({ label, value, strong }: { label: string; value: number; strong?: boolean }) => (
    <tr className={`border-t border-line ${strong ? "text-[15px] font-semibold" : "font-medium"}`}><td className="px-4 py-2">{label}</td><td className="num px-4 py-2">{money(value, base)}</td></tr>
  );

  return (
    <>
      <PageHeader title="Balance sheet" description={`${ctx.company.name} as at ${date(asOf)}.`}
        actions={<div className="flex items-center gap-2 print:hidden">
          <form className="flex items-center gap-2"><Input type="date" name="as_of" defaultValue={asOf} aria-label="As at" className="w-40" /><Button type="submit" size="sm">Update</Button></form>
          <PrintButton />
        </div>} />
      {error && <p className="mb-4 text-ember-700">{error.message}</p>}
      {!balanced && rows.length > 0 && <p className="mb-4 rounded-[var(--radius-control)] bg-ember-50 px-4 py-2 text-ember-700">The balance sheet doesn&apos;t balance. Check the trial balance.</p>}
      <Panel flush className="max-w-3xl">
        {rows.length === 0 ? <Empty title="Nothing posted yet" /> : (
          <table className="w-full text-sm">
            <tbody>
              <Section title="Assets" items={assets} />
              <Total label="Total assets" value={totalAssets} strong />
              <Section title="Liabilities" items={liabilities} />
              <Total label="Total liabilities" value={totalLiab} />
              <Section title="Equity" items={equity} />
              <tr><td className="px-4 py-1">Profit to date, not yet moved to retained earnings</td><td className="num px-4 py-1">{money(profit, base)}</td></tr>
              <Total label="Total equity" value={totalEq} />
              <Total label="Total liabilities and equity" value={totalLiab + totalEq} strong />
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
