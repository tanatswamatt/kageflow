import type { Metadata } from "next";
import Link from "next/link";
import { Button, Empty, Field, Input, Notice, PageHeader, Panel, Select, Table, Td, Th } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { getContext } from "@/lib/context";
import { date, label, money, today } from "@/lib/format";
import { CURRENCIES, PAYMENT_METHODS, type SalesDoc } from "@/lib/types";
import { recordPayment } from "../../actions";

export const metadata: Metadata = { title: "Record payment" };

export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<{ account?: string; order?: string; invoice?: string; error?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const base = ctx.company.base_currency;
  const { data: accounts } = await ctx.supabase.from("crm_accounts").select("id, name").eq("company_id", ctx.companyId).order("name").limit(1000);

  if (!ctx.can("payments.write")) {
    return <Panel><p className="text-ink-soft">Only owners, admins and accountants can record payments.</p></Panel>;
  }

  if (!sp.account) {
    return (
      <>
        <PageHeader title="Record payment" back={{ href: "/sales/payments", label: "Payments" }} />
        <Notice params={sp} />
        <Panel className="max-w-lg">
          <form className="flex flex-col gap-4">
            <Field label="Who paid?">
              <Select name="account" required defaultValue="">
                <option value="" disabled>Choose a customer</option>
                {((accounts ?? []) as { id: string; name: string }[]).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </Field>
            <div><Button type="submit" tone="primary">Continue</Button></div>
          </form>
        </Panel>
      </>
    );
  }

  const [{ data: invoices }, { data: orders }, { data: banks }] = await Promise.all([
    ctx.supabase.from("sales_docs").select("*").eq("company_id", ctx.companyId).eq("account_id", sp.account).eq("doc_type", "invoice").eq("status", "issued").gt("amount_due", 0).order("due_date"),
    ctx.supabase.from("sales_docs").select("id, number, currency, total, reference").eq("company_id", ctx.companyId).eq("account_id", sp.account).eq("doc_type", "order").eq("status", "open").order("created_at", { ascending: false }),
    ctx.supabase.from("accounts").select("id, code, name, system_key").eq("company_id", ctx.companyId).eq("type", "asset").eq("is_active", true).order("code"),
  ]);
  const open = (invoices ?? []) as SalesDoc[];
  const orderList = (orders ?? []) as { id: string; number: string; currency: string; total: number; reference: string | null }[];
  const preInvoice = open.find((i) => i.id === sp.invoice);
  const preOrder = orderList.find((o) => o.id === sp.order);
  const currency = preInvoice?.currency ?? preOrder?.currency ?? open[0]?.currency ?? base;
  const accountName = ((accounts ?? []) as { id: string; name: string }[]).find((a) => a.id === sp.account)?.name;
  const bankList = (banks ?? []) as { id: string; code: string; name: string; system_key: string | null }[];

  return (
    <>
      <PageHeader title="Record payment" description={<>From <Link className="font-medium text-ink hover:underline" href={`/crm/accounts/${sp.account}`}>{accountName}</Link></>} back={{ href: "/sales/payments", label: "Payments" }} />
      <Notice params={sp} />
      <form action={recordPayment} className="flex flex-col gap-6">
        <input type="hidden" name="account_id" value={sp.account} />
        <Panel title="Money received">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Amount"><Input name="amount" inputMode="decimal" required defaultValue={preInvoice ? Number(preInvoice.amount_due) : ""} /></Field>
            <Field label="Currency">
              <Select name="currency" defaultValue={currency}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>
            </Field>
            <Field label={`Rate the bank used (${base} per 1)`} hint={`Blank for ${base}`}><Input name="fx_rate" inputMode="decimal" /></Field>
            <Field label="Date received"><Input name="payment_date" type="date" defaultValue={today()} required /></Field>
            <Field label="Into account">
              <Select name="bank_account_id" defaultValue={bankList.find((b) => b.system_key === "bank")?.id}>
                {bankList.map((b) => <option key={b.id} value={b.id}>{b.code} {b.name}</option>)}
              </Select>
            </Field>
            <Field label="Method">
              <Select name="method" defaultValue="eft">{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m === "eft" ? "EFT" : label(m)}</option>)}</Select>
            </Field>
            <Field label="Bank reference" className="sm:col-span-2"><Input name="reference" /></Field>
            <Field label="Deposit for order" hint="Applied to that order's invoice automatically">
              <Select name="order_id" defaultValue={preOrder?.id ?? ""}>
                <option value="">Not a deposit</option>
                {orderList.map((o) => <option key={o.id} value={o.id}>{o.number}{o.reference ? ` (${o.reference})` : ""}: {money(o.total, o.currency)}</option>)}
              </Select>
            </Field>
          </div>
        </Panel>

        <Panel title="Apply to invoices" flush>
          {open.length === 0 ? (
            <Empty title="No unpaid invoices">The payment is held as a deposit until you apply it.</Empty>
          ) : (
            <Table>
              <thead><tr><Th>Invoice</Th><Th>Due</Th><Th className="text-right">Outstanding</Th><Th className="w-44 text-right">Apply</Th></tr></thead>
              <tbody>
                {open.map((i) => (
                  <tr key={i.id}>
                    <Td><Link className="font-medium hover:underline" href={`/sales/doc/${i.id}`}>{i.number}</Link></Td>
                    <Td>{date(i.due_date)}</Td>
                    <Td className="num">{money(i.amount_due, i.currency)}</Td>
                    <Td className="text-right">
                      <Input name={`alloc_${i.id}`} inputMode="decimal" aria-label={`Apply to ${i.number}`} className="text-right" defaultValue={i.id === sp.invoice ? Number(i.amount_due) : ""} placeholder={i.currency} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <p className="border-t border-line px-5 py-3 text-[13px] text-ink-faint">Only invoices in the payment&apos;s currency can be paid from it. Exchange differences post automatically.</p>
        </Panel>
        <div><SubmitButton pendingText="Recording…">Record payment</SubmitButton></div>
      </form>
    </>
  );
}
