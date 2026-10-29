import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, ButtonLink, Dl, Field, Input, Notice, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { BillEditor } from "@/components/purchases/bill-editor";
import { getContext } from "@/lib/context";
import { date, label, moneyFor } from "@/lib/format";
import { billStatus, billTitle, COST_KINDS, type Bill, type BillLine } from "@/lib/purchases";
import { loadBillOptions } from "@/lib/purchases-data";
import { discardBill, saveBill, voidBill } from "../../actions";

export const metadata: Metadata = { title: "Bill" };

type LineRow = BillLine & {
  accounts: { code: string; name: string } | null;
  products: { name: string } | null;
  inventory_units: { id: string; serial_no: string; make: string | null; model: string | null } | null;
};
type AllocRow = { amount: number; fx_difference: number; supplier_payments: { id: string; number: string | null; payment_date: string; reversal_journal_id: string | null; currency: string } | null };

export default async function BillPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await getContext();
  const money = moneyFor(ctx.company.base_currency);
  const { data } = await ctx.supabase.from("purchase_bills").select("*, crm_accounts(id, name), accounts(code, name)").eq("id", id).eq("company_id", ctx.companyId).maybeSingle();
  if (!data) notFound();
  const bill = data as Bill & { crm_accounts: { id: string; name: string } | null; accounts: { code: string; name: string } | null };
  const canWrite = ctx.can("purchases.write");
  const isExpense = !!bill.paid_from_account_id;
  const st = billStatus(bill);

  if (bill.status === "draft" && canWrite) {
    const o = await loadBillOptions(ctx);
    return (
      <>
        <PageHeader title={billTitle(bill)} description="Finish the details, then post it." back={{ href: "/purchases/bills?f=draft", label: "Drafts" }}
          actions={<form action={discardBill}><input type="hidden" name="id" value={bill.id} /><SubmitButton tone="quiet" size="sm" confirm="Discard this draft?">Discard draft</SubmitButton></form>} />
        <Notice params={sp} />
        <div className="max-w-3xl">
          <BillEditor
            mode={isExpense ? "expense" : "bill"}
            initial={{ id: bill.id, supplier_id: bill.supplier_id, supplier_ref: bill.supplier_ref, bill_date: bill.bill_date, due_date: bill.due_date, currency: bill.currency, fx_rate: Number(bill.fx_rate), paid_from_account_id: bill.paid_from_account_id, notes: bill.notes, lines: bill.draft_lines ?? [] }}
            {...o}
            baseCurrency={ctx.company.base_currency}
            vatVendor={!!ctx.company.vat_no?.trim()}
            action={saveBill}
          />
        </div>
      </>
    );
  }

  const [{ data: lineData }, { data: allocData }] = await Promise.all([
    ctx.supabase.from("purchase_bill_lines").select("*, accounts(code, name), products(name), inventory_units(id, serial_no, make, model)").eq("bill_id", bill.id).order("line_no"),
    ctx.supabase.from("supplier_payment_allocations").select("amount, fx_difference, supplier_payments(id, number, payment_date, reversal_journal_id, currency)").eq("bill_id", bill.id),
  ]);
  const lines = (lineData ?? []) as LineRow[];
  const allocs = (allocData ?? []) as unknown as AllocRow[];
  const cur = bill.currency;

  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-3">{billTitle(bill)} <Badge tone={st.tone}>{st.text}</Badge></span>}
        description={<>{isExpense ? "Expense from " : "Bill from "}<Link href={`/crm/accounts/${bill.supplier_id}`} className="font-medium hover:underline">{bill.crm_accounts?.name}</Link>{bill.supplier_ref ? `, their ref ${bill.supplier_ref}` : ""}</>}
        back={{ href: "/purchases/bills", label: "Bills and expenses" }}
        actions={canWrite && bill.status === "posted" && Number(bill.amount_due) > 0 && (
          <ButtonLink href={`/purchases/payments/new?supplier=${bill.supplier_id}&currency=${cur}&bill=${bill.id}`} tone="primary">Pay this bill</ButtonLink>
        )}
      />
      <Notice params={sp} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Panel flush>
          <Table>
            <thead><tr><Th>Item</Th><Th className="text-right">Qty</Th><Th className="text-right">Price</Th><Th className="text-right">VAT</Th><Th className="text-right">Amount</Th></tr></thead>
            <tbody>
              {(lines.length ? lines : []).map((l) => (
                <tr key={l.id}>
                  <Td>
                    <div className="font-medium">{l.description}</div>
                    <div className="text-xs text-ink-faint">
                      {l.kind === "account" && l.accounts && `${l.accounts.code} ${l.accounts.name}`}
                      {l.kind === "stock" && <>Stock: {l.products?.name}</>}
                      {l.kind === "vehicle" && l.inventory_units && <>{COST_KINDS.find((k) => k[0] === l.cost_kind)?.[1] ?? "Cost"} on <Link className="hover:underline" href={`/inventory/units/${l.inventory_units.id}`}>{[l.inventory_units.make, l.inventory_units.model].filter(Boolean).join(" ")} {l.inventory_units.serial_no}</Link></>}
                    </div>
                  </Td>
                  <Td className="num">{Number(l.quantity)}</Td>
                  <Td className="num">{money(l.unit_price, cur)}</Td>
                  <Td className="num">{money(l.line_tax, cur)}</Td>
                  <Td className="num">{money(l.line_total, cur)}</Td>
                </tr>
              ))}
              {lines.length === 0 && bill.draft_lines?.map((l, i) => (
                <tr key={i}><Td colSpan={5}>{l.description}</Td></tr>
              ))}
            </tbody>
            <tfoot className="text-sm">
              <tr><td colSpan={4} className="px-4 pt-3 text-right text-ink-soft">Excluding VAT</td><td className="num px-4 pt-3">{money(bill.subtotal, cur)}</td></tr>
              <tr><td colSpan={4} className="px-4 text-right text-ink-soft">VAT</td><td className="num px-4">{money(bill.vat_total, cur)}</td></tr>
              <tr className="font-semibold"><td colSpan={4} className="px-4 pb-3 text-right">Total</td><td className="num px-4 pb-3">{money(bill.total, cur)}</td></tr>
            </tfoot>
          </Table>
        </Panel>
        <div className="flex flex-col gap-6">
          <Panel title="Summary">
            <Dl items={[
              [isExpense ? "Paid on" : "Invoice date", date(bill.bill_date)],
              ...(!isExpense ? ([["Due", date(bill.due_date)]] as [string, string][]) : []),
              ...(isExpense && bill.accounts ? ([["Paid from", `${bill.accounts.code} ${bill.accounts.name}`]] as [string, string][]) : []),
              ...(cur !== ctx.company.base_currency ? ([["Rate", `${Number(bill.fx_rate)} ${ctx.company.base_currency} per ${cur}`]] as [string, string][]) : []),
              ["Paid", money(bill.amount_paid, cur)],
              ["Still owed", money(bill.amount_due, cur)],
              ...(bill.journal_id ? ([["Journal", <Link key="j" href={`/accounting/journals/${bill.journal_id}`} className="hover:underline">View entries</Link>]] as [string, React.ReactNode][]) : []),
              ...(bill.void_reason && bill.status === "void" ? ([["Voided", bill.void_reason]] as [string, string][]) : []),
            ]} />
            {bill.notes && <p className="mt-3 text-sm whitespace-pre-line text-ink-soft">{bill.notes}</p>}
          </Panel>
          {!isExpense && allocs.length > 0 && (
            <Panel title="Payments">
              <ul className="flex flex-col gap-2 text-sm">
                {allocs.map((a, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span>{a.supplier_payments?.number} · {date(a.supplier_payments?.payment_date)} {a.supplier_payments?.reversal_journal_id && <Badge tone="ember">Reversed</Badge>}</span>
                    <span className="tabular-nums">{money(a.amount, cur)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {canWrite && bill.status === "posted" && (
            <Panel title="Void this bill">
              <p className="mb-3 text-sm text-ink-soft">Reverses its entries, stock and vehicle costs. {!isExpense && Number(bill.amount_paid) > 0 ? "Reverse its payments first." : ""}</p>
              <form action={voidBill} className="flex flex-col gap-3">
                <input type="hidden" name="id" value={bill.id} />
                <Field label="Reason"><Input name="reason" required placeholder="e.g. Entered twice" /></Field>
                <SubmitButton tone="danger" size="sm" confirm="Void this bill? Its entries will be reversed.">Void {label(isExpense ? "expense" : "bill").toLowerCase()}</SubmitButton>
              </form>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
