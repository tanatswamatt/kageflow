import type { Metadata } from "next";
import { Badge, ButtonLink, Empty, Notice, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { getContext } from "@/lib/context";
import { date, money } from "@/lib/format";
import type { SupplierPayment } from "@/lib/purchases";
import { reverseSupplierPayment } from "../actions";

export const metadata: Metadata = { title: "Supplier payments" };

type Row = SupplierPayment & { crm_accounts: { name: string } | null; accounts: { code: string; name: string } | null; supplier_payment_allocations: { purchase_bills: { id: string; number: string | null } | null }[] };

export default async function SupplierPaymentsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const { data } = await ctx.supabase.from("supplier_payments")
    .select("*, crm_accounts(name), accounts(code, name), supplier_payment_allocations(purchase_bills(id, number))")
    .eq("company_id", ctx.companyId).order("payment_date", { ascending: false }).order("created_at", { ascending: false }).limit(300);
  const rows = (data ?? []) as unknown as Row[];
  const canWrite = ctx.can("purchases.write");

  return (
    <>
      <PageHeader title="Supplier payments" description="Money paid to suppliers against their bills."
        actions={canWrite && <ButtonLink href="/purchases/payments/new" tone="primary">Pay a supplier</ButtonLink>} />
      <Notice params={sp} />
      <Panel flush>
        {rows.length === 0 ? <Empty title="No supplier payments yet" /> : (
          <Table>
            <thead><tr><Th>Number</Th><Th>Date</Th><Th>Supplier</Th><Th>Bills</Th><Th>From</Th><Th className="text-right">Amount</Th><Th /></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="align-top hover:bg-paper">
                  <Td className="font-medium tabular-nums">{p.number}</Td>
                  <Td className="whitespace-nowrap text-ink-soft">{date(p.payment_date)}</Td>
                  <Td>{p.crm_accounts?.name}{p.reference && <div className="text-xs text-ink-faint">{p.reference}</div>}</Td>
                  <Td className="text-[13px]">
                    {p.supplier_payment_allocations.map((a) => a.purchase_bills && (
                      <a key={a.purchase_bills.id} href={`/purchases/bills/${a.purchase_bills.id}`} className="mr-2 hover:underline">{a.purchase_bills.number}</a>
                    ))}
                  </Td>
                  <Td className="text-ink-soft">{p.accounts?.name}</Td>
                  <Td className="num">{money(p.amount, p.currency)}{Number(p.bank_charges) > 0 && <div className="text-xs text-ink-faint">+ {money(p.bank_charges, ctx.company.base_currency)} charges</div>}</Td>
                  <Td className="text-right">
                    {p.reversal_journal_id ? <Badge tone="ember">Reversed</Badge> : canWrite && (
                      <details className="text-left">
                        <summary className="cursor-pointer text-[13px] text-ink-faint hover:text-ink">Reverse</summary>
                        <form action={reverseSupplierPayment} className="mt-2 flex w-56 flex-col gap-2">
                          <input type="hidden" name="id" value={p.id} />
                          <input name="reason" placeholder="Reason" required className="h-9 rounded-[var(--radius-control)] border border-line-strong bg-surface px-2 text-sm" />
                          <SubmitButton tone="danger" size="sm" confirm="Reverse this payment? The bills will be open again.">Reverse payment</SubmitButton>
                        </form>
                      </details>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
