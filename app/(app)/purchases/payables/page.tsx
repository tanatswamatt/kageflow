import type { Metadata } from "next";
import Link from "next/link";
import { Empty, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { getContext } from "@/lib/context";
import { moneyFor } from "@/lib/format";
import { daysOverdue } from "@/lib/sales";
import type { Bill } from "@/lib/purchases";

export const metadata: Metadata = { title: "Payables" };

const BUCKETS = ["Not yet due", "1 to 30 days", "31 to 60 days", "61 to 90 days", "Over 90 days"] as const;
const bucket = (days: number) => (days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4);

export default async function PayablesPage() {
  const ctx = await getContext();
  const money = moneyFor(ctx.company.base_currency);
  const { data } = await ctx.supabase.from("purchase_bills").select("*, crm_accounts(name)").eq("company_id", ctx.companyId).eq("status", "posted").gt("amount_due", 0).limit(3000);
  const bills = (data ?? []) as (Bill & { crm_accounts: { name: string } | null })[];
  type Agg = { id: string; name: string; currency: string; b: number[]; total: number };
  const rows = new Map<string, Agg>();
  for (const x of bills) {
    const k = `${x.supplier_id}|${x.currency}`;
    const r = rows.get(k) ?? { id: x.supplier_id, name: x.crm_accounts?.name ?? "", currency: x.currency, b: [0, 0, 0, 0, 0], total: 0 };
    r.b[bucket(daysOverdue(x.due_date))]! += Number(x.amount_due);
    r.total += Number(x.amount_due);
    rows.set(k, r);
  }
  const list = [...rows.values()].sort((a, b) => a.currency.localeCompare(b.currency) || b.total - a.total);
  const currencies = [...new Set(list.map((r) => r.currency))];

  return (
    <>
      <PageHeader title="Payables" description="What you owe suppliers, by how late it is." />
      {list.length === 0 ? <Panel><Empty title="You don't owe any supplier">Posted bills with a balance appear here.</Empty></Panel> : currencies.map((cur) => {
        const group = list.filter((r) => r.currency === cur);
        const totals = BUCKETS.map((_, i) => group.reduce((s, r) => s + r.b[i]!, 0));
        return (
          <Panel key={cur} title={`Owed in ${cur}`} flush className="mb-6">
            <Table>
              <thead><tr><Th>Supplier</Th>{BUCKETS.map((b) => <Th key={b} className="text-right">{b}</Th>)}<Th className="text-right">Total</Th><Th /></tr></thead>
              <tbody>
                {group.map((r) => (
                  <tr key={r.id + cur} className="hover:bg-paper">
                    <Td className="font-medium">{r.name}</Td>
                    {r.b.map((v, i) => <Td key={i} className={`num ${i >= 2 && v > 0 ? "font-medium text-ember-700" : ""}`}>{v ? money(v, cur) : ""}</Td>)}
                    <Td className="num font-semibold">{money(r.total, cur)}</Td>
                    <Td className="text-right"><Link className="text-[13px] font-medium text-shadow-700 hover:underline" href={`/purchases/payments/new?supplier=${r.id}&currency=${cur}`}>Pay</Link></Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold"><td className="px-4 py-3">Total</td>{totals.map((v, i) => <td key={i} className="num px-4 py-3">{v ? money(v, cur) : ""}</td>)}<td className="num px-4 py-3">{money(totals.reduce((s, v) => s + v, 0), cur)}</td><td /></tr>
              </tfoot>
            </Table>
          </Panel>
        );
      })}
    </>
  );
}
