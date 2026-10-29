import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Empty, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { getContext } from "@/lib/context";
import { amount, date, moneyFor } from "@/lib/format";
import type { Payment, SalesDoc } from "@/lib/types";

export const metadata: Metadata = { title: "Statement" };

type Entry = { date: string; kind: string; ref: string; href: string; debit: number; credit: number; currency: string };

export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  const money = moneyFor(ctx.company.base_currency);
  const { data: account } = await ctx.supabase.from("crm_accounts").select("id, name, billing_address, vat_no").eq("id", id).eq("company_id", ctx.companyId).maybeSingle();
  if (!account) notFound();
  const [{ data: docs }, { data: pays }] = await Promise.all([
    ctx.supabase.from("sales_docs").select("*").eq("company_id", ctx.companyId).eq("account_id", id).in("doc_type", ["invoice", "credit_note"]).eq("status", "issued"),
    ctx.supabase.from("customer_payments").select("*").eq("company_id", ctx.companyId).eq("account_id", id).is("reversal_journal_id", null),
  ]);
  const entries: Entry[] = [
    ...((docs ?? []) as SalesDoc[]).map((d) => ({
      date: d.issue_date,
      kind: d.doc_type === "invoice" ? "Invoice" : "Credit note",
      ref: d.number ?? "",
      href: `/sales/doc/${d.id}`,
      debit: d.doc_type === "invoice" ? Number(d.total) : 0,
      credit: d.doc_type === "credit_note" ? Number(d.total) : 0,
      currency: d.currency,
    })),
    ...((pays ?? []) as Payment[]).map((p) => ({
      date: p.payment_date,
      kind: "Payment",
      ref: `${p.number}${p.reference ? ` (${p.reference})` : ""}`,
      href: `/sales/payments/${p.id}`,
      debit: 0,
      credit: Number(p.amount),
      currency: p.currency,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || b.debit - a.debit);
  const currencies = [...new Set(entries.map((e) => e.currency))];
  const a = account as { id: string; name: string; billing_address: string | null; vat_no: string | null };

  return (
    <>
      <PageHeader
        title={`Statement: ${a.name}`}
        description={`From ${ctx.company.name}, as at ${date(new Date().toISOString())}`}
        back={{ href: `/crm/accounts/${id}`, label: a.name }}
        actions={<div className="print:hidden"><PrintButton /></div>}
      />
      {entries.length === 0 ? (
        <Panel><Empty title="No issued invoices or payments yet" /></Panel>
      ) : (
        currencies.map((cur) => {
          let bal = 0;
          const rows = entries.filter((e) => e.currency === cur);
          return (
            <Panel key={cur} title={`${cur} account`} flush className="mb-6">
              <Table>
                <thead><tr><Th>Date</Th><Th>Type</Th><Th>Reference</Th><Th className="text-right">Charges</Th><Th className="text-right">Credits</Th><Th className="text-right">Balance</Th></tr></thead>
                <tbody>
                  {rows.map((e, i) => {
                    bal += e.debit - e.credit;
                    return (
                      <tr key={i}>
                        <Td className="whitespace-nowrap">{date(e.date)}</Td>
                        <Td>{e.kind}</Td>
                        <Td><Link className="hover:underline" href={e.href}>{e.ref}</Link></Td>
                        <Td className="num">{amount(e.debit)}</Td>
                        <Td className="num">{amount(e.credit)}</Td>
                        <Td className="num font-medium">{money(bal, cur)}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
              <p className="border-t border-line px-4 py-3 text-right font-semibold">
                {bal > 0 ? `Balance owing ${money(bal, cur)}` : bal < 0 ? `In credit ${money(-bal, cur)}` : "Settled"}
              </p>
            </Panel>
          );
        })
      )}
    </>
  );
}
