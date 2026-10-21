import type { Metadata } from "next";
import Link from "next/link";
import { Empty, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { getContext } from "@/lib/context";
import { money } from "@/lib/format";
import { daysOverdue } from "@/lib/sales";
import type { SalesDoc } from "@/lib/types";

export const metadata: Metadata = { title: "Receivables" };

type Row = SalesDoc & { crm_accounts: { id: string; name: string } | null };
const BUCKETS = ["Current", "1 to 30", "31 to 60", "61 to 90", "Over 90"] as const;
const bucket = (days: number) => (days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4);

export default async function ReceivablesPage() {
  const ctx = await getContext();
  const [{ data }, { data: pays }] = await Promise.all([
    ctx.supabase.from("sales_docs").select("*, crm_accounts(id, name)").eq("company_id", ctx.companyId).eq("doc_type", "invoice").eq("status", "issued").gt("amount_due", 0).limit(2000),
    ctx.supabase.from("customer_payments").select("account_id, currency, amount, amount_allocated, reversal_journal_id").eq("company_id", ctx.companyId).is("reversal_journal_id", null),
  ]);
  const invoices = (data ?? []) as Row[];
  type Agg = { id: string; name: string; currency: string; b: number[]; total: number; unapplied: number };
  const rows = new Map<string, Agg>();
  for (const i of invoices) {
    const k = `${i.account_id}|${i.currency}`;
    const r = rows.get(k) ?? { id: i.account_id, name: i.crm_accounts?.name ?? "", currency: i.currency, b: [0, 0, 0, 0, 0], total: 0, unapplied: 0 };
    const amt = Number(i.amount_due);
    r.b[bucket(daysOverdue(i.due_date))]! += amt;
    r.total += amt;
    rows.set(k, r);
  }
  for (const p of (pays ?? []) as { account_id: string; currency: string; amount: number; amount_allocated: number }[]) {
    const r = rows.get(`${p.account_id}|${p.currency}`);
    if (r) r.unapplied += Number(p.amount) - Number(p.amount_allocated);
  }
  const list = [...rows.values()].sort((a, b) => a.currency.localeCompare(b.currency) || b.total - a.total);
  const currencies = [...new Set(list.map((r) => r.currency))];

  return (
    <>
      <PageHeader title="Receivables" description="What customers owe on issued invoices, by how late it is. Click a customer for their statement." />
      {list.length === 0 ? (
        <Panel><Empty title="Nobody owes you anything">Issued invoices with a balance appear here.</Empty></Panel>
      ) : (
        currencies.map((cur) => {
          const group = list.filter((r) => r.currency === cur);
          const totals = BUCKETS.map((_, i) => group.reduce((s, r) => s + r.b[i]!, 0));
          return (
            <Panel key={cur} title={`Owed in ${cur}`} flush className="mb-6">
              <Table>
                <thead>
                  <tr><Th>Customer</Th>{BUCKETS.map((b) => <Th key={b} className="text-right">{b === "Current" ? "Not yet due" : `${b} days`}</Th>)}<Th className="text-right">Total</Th></tr>
                </thead>
                <tbody>
                  {group.map((r) => (
                    <tr key={r.id + r.currency} className="hover:bg-paper">
                      <Td>
                        <Link className="font-medium hover:underline" href={`/crm/accounts/${r.id}/statement`}>{r.name}</Link>
                        {r.unapplied > 0 && <div className="text-xs text-amber-700">{money(r.unapplied, cur)} received but not applied</div>}
                      </Td>
                      {r.b.map((v, i) => <Td key={i} className={`num ${i >= 2 && v > 0 ? "font-medium text-ember-700" : ""}`}>{v ? money(v, cur) : ""}</Td>)}
                      <Td className="num font-semibold">{money(r.total, cur)}</Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td className="px-4 py-3">Total</td>
                    {totals.map((v, i) => <td key={i} className="num px-4 py-3">{v ? money(v, cur) : ""}</td>)}
                    <td className="num px-4 py-3">{money(totals.reduce((s, v) => s + v, 0), cur)}</td>
                  </tr>
                </tfoot>
              </Table>
            </Panel>
          );
        })
      )}
    </>
  );
}
