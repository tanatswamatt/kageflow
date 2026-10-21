import type { Metadata } from "next";
import { Button, Empty, Field, Input, Notice, PageHeader, Panel, Select, Table, Td, Th } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { getContext } from "@/lib/context";
import { fail } from "@/lib/forms";
import { date, money, today } from "@/lib/format";
import type { Bill } from "@/lib/purchases";
import { loadBankAccounts } from "@/lib/purchases-data";
import { paySupplier } from "../../actions";

export const metadata: Metadata = { title: "Pay a supplier" };

export default async function PaySupplierPage({ searchParams }: { searchParams: Promise<{ supplier?: string; currency?: string; bill?: string; error?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  if (!ctx.can("purchases.write")) fail("/purchases/payments", "Only owners, admins and accountants can pay suppliers");
  const base = ctx.company.base_currency;

  const { data: open } = await ctx.supabase.from("purchase_bills").select("supplier_id, currency, amount_due, crm_accounts(name)")
    .eq("company_id", ctx.companyId).eq("status", "posted").gt("amount_due", 0).limit(3000);
  type O = { supplier_id: string; currency: string; amount_due: number; crm_accounts: { name: string } | null };
  const owing = new Map<string, { id: string; name: string; currency: string; total: number }>();
  for (const b of (open ?? []) as unknown as O[]) {
    const k = `${b.supplier_id}|${b.currency}`;
    const r = owing.get(k) ?? { id: b.supplier_id, name: b.crm_accounts?.name ?? "", currency: b.currency, total: 0 };
    r.total += Number(b.amount_due);
    owing.set(k, r);
  }

  if (!sp.supplier) {
    const list = [...owing.values()].sort((a, b) => a.name.localeCompare(b.name));
    return (
      <>
        <PageHeader title="Pay a supplier" description="Choose who you're paying." back={{ href: "/purchases/payments", label: "Supplier payments" }} />
        <Notice params={sp} />
        <Panel flush>
          {list.length === 0 ? <Empty title="You don't owe any supplier">Post a bill first; paid-now expenses don't need paying.</Empty> : (
            <Table>
              <thead><tr><Th>Supplier</Th><Th className="text-right">Owed</Th><Th /></tr></thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id + r.currency} className="hover:bg-paper">
                    <Td className="font-medium">{r.name}</Td>
                    <Td className="num">{money(r.total, r.currency)}</Td>
                    <Td className="text-right"><a className="font-medium text-shadow-700 hover:underline" href={`/purchases/payments/new?supplier=${r.id}&currency=${r.currency}`}>Pay</a></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      </>
    );
  }

  const currency = sp.currency ?? base;
  const [{ data: sup }, { data: billData }, banks] = await Promise.all([
    ctx.supabase.from("crm_accounts").select("id, name").eq("id", sp.supplier).eq("company_id", ctx.companyId).maybeSingle(),
    ctx.supabase.from("purchase_bills").select("*").eq("company_id", ctx.companyId).eq("supplier_id", sp.supplier).eq("status", "posted").eq("currency", currency).gt("amount_due", 0).order("due_date"),
    loadBankAccounts(ctx),
  ]);
  const bills = (billData ?? []) as Bill[];
  const otherCurrencies = [...owing.values()].filter((r) => r.id === sp.supplier && r.currency !== currency);

  return (
    <>
      <PageHeader title={`Pay ${sup?.name ?? "supplier"}`} description={`Bills in ${currency} that are still open. Change the amounts to pay part of a bill.`} back={{ href: "/purchases/bills", label: "Bills and expenses" }} />
      <Notice params={sp} />
      {otherCurrencies.length > 0 && (
        <p className="mb-4 text-sm text-ink-soft">Also owed: {otherCurrencies.map((r) => <a key={r.currency} className="font-medium text-shadow-700 hover:underline" href={`/purchases/payments/new?supplier=${r.id}&currency=${r.currency}`}>{money(r.total, r.currency)}</a>)}</p>
      )}
      {bills.length === 0 ? (
        <Panel><Empty title={`Nothing owed to ${sup?.name ?? "this supplier"} in ${currency}`} /></Panel>
      ) : (
        <form action={paySupplier} className="flex flex-col gap-6">
          <input type="hidden" name="supplier_id" value={sp.supplier} />
          <input type="hidden" name="currency" value={currency} />
          <Panel flush>
            <Table>
              <thead><tr><Th>Bill</Th><Th>Their ref</Th><Th>Due</Th><Th className="text-right">Owed</Th><Th className="text-right">Pay now ({currency})</Th></tr></thead>
              <tbody>
                {bills.map((b) => (
                  <tr key={b.id}>
                    <Td className="font-medium tabular-nums">{b.number}</Td>
                    <Td className="text-ink-soft">{b.supplier_ref}</Td>
                    <Td className="text-ink-soft">{date(b.due_date)}</Td>
                    <Td className="num">{money(b.amount_due, currency)}</Td>
                    <Td className="text-right">
                      <input name={`pay_${b.id}`} inputMode="decimal" defaultValue={!sp.bill || sp.bill === b.id ? String(Number(b.amount_due)) : ""} aria-label={`Pay ${b.number}`}
                        className="h-9 w-36 rounded-[var(--radius-control)] border border-line-strong bg-surface px-2 text-right text-sm tabular-nums" />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>
          <Panel title="Payment">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Paid from">
                <Select name="bank_account_id" required>{banks.map((b) => <option key={b.id} value={b.id}>{b.code} {b.name}</option>)}</Select>
              </Field>
              <Field label="Date paid"><Input type="date" name="payment_date" defaultValue={today()} required /></Field>
              <Field label="Reference (optional)"><Input name="reference" placeholder="e.g. EFT reference" /></Field>
              <Field label={`Bank charges (${base}, optional)`}><Input name="bank_charges" inputMode="decimal" placeholder="0.00" /></Field>
              {currency !== base && (
                <Field label={`Rate on the day: ${base} per 1 ${currency}`} hint="Differences from the bill's rate post to exchange gains or losses.">
                  <Input name="fx_rate" inputMode="decimal" required />
                </Field>
              )}
            </div>
            <div className="mt-5 flex gap-2"><SubmitButton pendingText="Recording…">Record payment</SubmitButton><Button type="reset" tone="quiet">Reset amounts</Button></div>
          </Panel>
        </form>
      )}
    </>
  );
}
