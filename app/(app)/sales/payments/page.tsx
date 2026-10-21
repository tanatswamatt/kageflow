import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ButtonLink, Empty, Notice, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { getContext } from "@/lib/context";
import { date, label, money } from "@/lib/format";
import type { Payment } from "@/lib/types";

export const metadata: Metadata = { title: "Payments" };

type Row = Payment & { crm_accounts: { name: string } | null };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ f?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const { data } = await ctx.supabase.from("customer_payments").select("*, crm_accounts(name)").eq("company_id", ctx.companyId)
    .order("payment_date", { ascending: false }).order("created_at", { ascending: false }).limit(300);
  let rows = (data ?? []) as Row[];
  if (sp.f === "unallocated") rows = rows.filter((p) => !p.reversal_journal_id && Number(p.amount) > Number(p.amount_allocated));

  return (
    <>
      <PageHeader
        title="Payments received"
        description="Money in from customers. Unallocated money is held as a customer deposit until it's applied to an invoice."
        actions={ctx.can("payments.write") && <ButtonLink href="/sales/payments/new" tone="primary">Record payment</ButtonLink>}
      />
      <Notice params={sp} />
      <nav className="mb-4 flex gap-1">
        {[["all", "All"], ["unallocated", "With unallocated money"]].map(([k, l]) => (
          <Link key={k} href={k === "all" ? "/sales/payments" : `/sales/payments?f=${k}`} className={`rounded-full px-3 py-1 text-[13px] ${(sp.f ?? "all") === k ? "bg-shadow-800 text-white" : "text-ink-soft hover:bg-shadow-100"}`}>{l}</Link>
        ))}
      </nav>
      <Panel flush>
        {rows.length === 0 ? (
          <Empty title="No payments here" />
        ) : (
          <Table>
            <thead><tr><Th>Number</Th><Th>Date</Th><Th>Customer</Th><Th>Method</Th><Th>Reference</Th><Th className="text-right">Amount</Th><Th className="text-right">Unallocated</Th></tr></thead>
            <tbody>
              {rows.map((p) => {
                const free = Number(p.amount) - Number(p.amount_allocated);
                return (
                  <tr key={p.id} className="hover:bg-paper">
                    <Td className="whitespace-nowrap"><Link href={`/sales/payments/${p.id}`} className="font-medium tabular-nums hover:underline">{p.number}</Link></Td>
                    <Td className="whitespace-nowrap text-ink-soft">{date(p.payment_date)}</Td>
                    <Td>{p.crm_accounts?.name}</Td>
                    <Td className="text-ink-soft">{label(p.method).toUpperCase() === "EFT" ? "EFT" : label(p.method)}</Td>
                    <Td className="text-ink-soft">{p.reference}</Td>
                    <Td className="num">{money(p.amount, p.currency)}</Td>
                    <Td className="num">{p.reversal_journal_id ? <Badge tone="ember">Reversed</Badge> : free > 0 ? money(free, p.currency) : ""}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
