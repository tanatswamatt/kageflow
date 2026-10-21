import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Dl, Field, Input, Notice, PageHeader, Panel, Select, Table, Td, Th } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { getContext } from "@/lib/context";
import { amount, date, label, money } from "@/lib/format";
import type { Allocation, Payment, SalesDoc } from "@/lib/types";
import { allocate, reversePayment } from "../../actions";

export const metadata: Metadata = { title: "Payment" };

type Row = Payment & { crm_accounts: { id: string; name: string } | null; accounts: { code: string; name: string } | null };

export default async function PaymentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const notice = await searchParams;
  const ctx = await getContext();
  const { data } = await ctx.supabase.from("customer_payments").select("*, crm_accounts(id, name), accounts!customer_payments_company_id_bank_account_id_fkey(code, name)").eq("id", id).eq("company_id", ctx.companyId).maybeSingle();
  if (!data) notFound();
  const p = data as Row;
  const base = ctx.company.base_currency;
  const free = Number(p.amount) - Number(p.amount_allocated);
  const reversed = !!p.reversal_journal_id;

  const [{ data: allocs }, { data: open }, { data: order }] = await Promise.all([
    ctx.supabase.from("payment_allocations").select("*, sales_docs(id, number)").eq("payment_id", id).order("created_at"),
    free > 0 && !reversed
      ? ctx.supabase.from("sales_docs").select("*").eq("company_id", ctx.companyId).eq("account_id", p.account_id).eq("doc_type", "invoice").eq("status", "issued").eq("currency", p.currency).gt("amount_due", 0).order("due_date")
      : Promise.resolve({ data: [] }),
    p.order_id ? ctx.supabase.from("sales_docs").select("id, number").eq("id", p.order_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const canPay = ctx.can("payments.write");

  return (
    <>
      <PageHeader
        title={p.number ?? "Payment"}
        description={<>From <Link className="font-medium text-ink hover:underline" href={`/crm/accounts/${p.account_id}`}>{p.crm_accounts?.name}</Link></>}
        back={{ href: "/sales/payments", label: "Payments" }}
        actions={reversed ? <Badge tone="ember">Reversed</Badge> : free > 0 ? <Badge tone="amber">{money(free, p.currency)} unallocated</Badge> : <Badge tone="jade">Fully applied</Badge>}
      />
      <Notice params={notice} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Applied to" flush>
            {(allocs ?? []).length === 0 ? (
              <p className="px-5 py-4 text-ink-soft">Not applied yet. The money is held as a customer deposit.</p>
            ) : (
              <Table>
                <thead><tr><Th>Invoice</Th><Th>Applied on</Th><Th className="text-right">Amount ({p.currency})</Th><Th className="text-right">FX ({base})</Th></tr></thead>
                <tbody>
                  {((allocs ?? []) as (Allocation & { sales_docs: { id: string; number: string } })[]).map((a) => (
                    <tr key={a.id}>
                      <Td><Link className="hover:underline" href={`/sales/doc/${a.sales_docs.id}`}>{a.sales_docs.number}</Link></Td>
                      <Td>{date(a.created_at)}</Td>
                      <Td className="num">{amount(a.amount)}</Td>
                      <Td className={`num ${Number(a.fx_difference) < 0 ? "text-ember-700" : "text-jade-700"}`}>{Number(a.fx_difference) ? `${Number(a.fx_difference) > 0 ? "gain" : "loss"} ${amount(Math.abs(Number(a.fx_difference)))}` : ""}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>

          {canPay && !reversed && free > 0 && (open ?? []).length > 0 && (
            <Panel title="Apply unallocated money">
              <form action={allocate} className="grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
                <input type="hidden" name="payment_id" value={id} />
                <Field label="Invoice">
                  <Select name="invoice_id">
                    {((open ?? []) as SalesDoc[]).map((i) => <option key={i.id} value={i.id}>{i.number}: {money(i.amount_due, i.currency)} due</option>)}
                  </Select>
                </Field>
                <Field label={`Amount (${p.currency})`}><Input name="amount" inputMode="decimal" defaultValue={free} /></Field>
                <SubmitButton size="sm">Apply</SubmitButton>
              </form>
            </Panel>
          )}
        </div>
        <div className="flex flex-col gap-6">
          <Panel title="Details">
            <Dl
              items={[
                ["Amount", <span key="a" className="font-semibold tabular-nums">{money(p.amount, p.currency)}</span>],
                ...(p.currency !== base ? ([["At rate", `${Number(p.fx_rate)} = ${money(Number(p.amount) * Number(p.fx_rate), base)}`]] as [string, string][]) : []),
                ["Received", date(p.payment_date)],
                ["Into", p.accounts ? `${p.accounts.code} ${p.accounts.name}` : ""],
                ["Method", p.method === "eft" ? "EFT" : label(p.method)],
                ["Reference", p.reference],
                ...(order ? ([["Deposit for", <Link key="o" className="text-shadow-700 hover:underline" href={`/sales/doc/${(order as { id: string }).id}`}>{(order as { number: string }).number}</Link>]] as [string, React.ReactNode][]) : []),
                ...(p.journal_id ? ([["Ledger", <Link key="j" className="text-shadow-700 hover:underline" href={`/accounting/journals/${p.journal_id}`}>View journal</Link>]] as [string, React.ReactNode][]) : []),
              ]}
            />
          </Panel>
          {canPay && !reversed && Number(p.amount_allocated) === 0 && (
            <Panel title="Reverse">
              <p className="mb-3 text-ink-soft">For a payment recorded by mistake or a bounced EFT. Posts a reversal; both stay in the ledger.</p>
              <form action={reversePayment} className="flex flex-col gap-2">
                <input type="hidden" name="payment_id" value={id} />
                <Input name="reason" placeholder="Reason" aria-label="Reason" />
                <div><SubmitButton size="sm" tone="danger" confirm="Reverse this payment?">Reverse payment</SubmitButton></div>
              </form>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
