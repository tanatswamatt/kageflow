import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Empty, Field, Input, Notice, PageHeader, Panel, Select, Stat, Table, Td, Th } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { getContext } from "@/lib/context";
import { date, moneyFor, today } from "@/lib/format";
import { fail } from "@/lib/forms";
import { loadBankAccounts } from "@/lib/purchases-data";
import { postDic, receiveDic } from "../actions";

export const metadata: Metadata = { title: "Finance commission" };

type Row = {
  id: string; bank: string; status: string; dic_amount: number | null; dic_vat: number | null; payout_date: string | null;
  dic_journal_id: string | null; dic_received_journal_id: string | null; dic_received_on: string | null; dic_reference: string | null;
  finance_applications: { id: string; number: string | null; first_name: string | null; last_name: string | null; inventory_units: { stock_no: string | null; year: number | null; make: string | null; model: string | null } | null } | null;
};

export default async function FinanceCommissionPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  if (!ctx.can("payments.write")) fail("/sales/finance", "Only owners, admins and accountants can see finance commission");
  const money = moneyFor(ctx.company.base_currency);
  const [{ data }, banks] = await Promise.all([
    ctx.supabase.from("finance_submissions")
      .select("id, bank, status, dic_amount, dic_vat, payout_date, dic_journal_id, dic_received_journal_id, dic_received_on, dic_reference, finance_applications(id, number, first_name, last_name, inventory_units(stock_no, year, make, model))")
      .eq("company_id", ctx.companyId).gt("dic_amount", 0).in("status", ["paid_out", "contracted"])
      .order("payout_date", { ascending: false, nullsFirst: false }).limit(500),
    loadBankAccounts(ctx),
  ]);
  const rows = (data ?? []) as unknown as Row[];
  const notPosted = rows.filter((r) => !r.dic_journal_id);
  const due = rows.filter((r) => r.dic_journal_id && !r.dic_received_journal_id).sort((a, b) => a.bank.localeCompare(b.bank));
  const received = rows.filter((r) => r.dic_received_journal_id).slice(0, 50);
  const total = (r: Row) => Number(r.dic_amount ?? 0) + Number(r.dic_vat ?? 0);
  const dueTotal = due.reduce((s, r) => s + total(r), 0);
  const car = (r: Row) => { const u = r.finance_applications?.inventory_units; return u ? `${u.stock_no ?? ""} ${[u.year, u.make, u.model].filter(Boolean).join(" ")}`.trim() : ""; };
  const who = (r: Row) => [r.finance_applications?.first_name, r.finance_applications?.last_name].filter(Boolean).join(" ");
  const appLink = (r: Row) => r.finance_applications ? <Link className="text-shadow-700 hover:underline" href={`/sales/finance/${r.finance_applications.id}`}>{r.finance_applications.number}</Link> : null;
  const bankAccounts = banks.filter((b) => b.type === "asset");

  return (
    <>
      <PageHeader title="Finance commission (DIC)" description="What the banks owe you for the deals they financed. It's income when the bank pays out the car, and stays owed until the bank pays it, usually on a monthly statement." back={{ href: "/sales/finance", label: "Finance applications" }} />
      <Notice params={sp} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Owed by banks, incl. VAT" value={money(dueTotal)} sub={`${due.length} deal${due.length === 1 ? "" : "s"}`} />
        <Stat label="Not in the books yet" value={String(notPosted.length)} sub={notPosted.length ? "Post them below" : "All posted"} />
        <Stat label="Received, last 50" value={money(received.reduce((s, r) => s + total(r), 0))} />
      </div>

      {notPosted.length > 0 && (
        <Panel title="Not in the books yet" className="mb-6" flush>
          <Table>
            <thead><tr><Th>Application</Th><Th>Bank</Th><Th>Customer and car</Th><Th className="text-right">DIC excl. VAT</Th><Th /></tr></thead>
            <tbody>
              {notPosted.map((r) => (
                <tr key={r.id}>
                  <Td>{appLink(r)}</Td><Td>{r.bank}</Td><Td>{who(r)}<div className="text-[12px] text-ink-faint">{car(r)}</div></Td>
                  <Td className="num">{money(r.dic_amount)}</Td>
                  <Td className="text-right"><form action={postDic}><input type="hidden" name="id" value={r.id} /><SubmitButton size="sm" tone="secondary" pendingText="Posting…">Post DIC</SubmitButton></form></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}

      <Panel title="Waiting for the banks" className="mb-6" flush>
        {due.length === 0 ? <Empty title="Nothing owed">When a bank pays out a deal with a DIC, it appears here until the bank pays you.</Empty> : (
          <form action={receiveDic}>
            <Table>
              <thead><tr><Th /><Th>Bank</Th><Th>Application</Th><Th>Customer and car</Th><Th>Paid out</Th><Th className="text-right">DIC</Th><Th className="text-right">VAT</Th><Th className="text-right">Total</Th></tr></thead>
              <tbody>
                {due.map((r) => (
                  <tr key={r.id}>
                    <Td><input type="checkbox" name="ids" value={r.id} className="size-4 accent-jade-700" aria-label={`Received from ${r.bank}`} /></Td>
                    <Td className="font-medium">{r.bank}</Td><Td>{appLink(r)}</Td>
                    <Td>{who(r)}<div className="text-[12px] text-ink-faint">{car(r)}</div></Td>
                    <Td>{date(r.payout_date)}</Td>
                    <Td className="num">{money(r.dic_amount)}</Td><Td className="num">{money(r.dic_vat ?? 0)}</Td><Td className="num font-medium">{money(total(r))}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="grid gap-3 border-t border-line px-5 py-4 sm:grid-cols-[1fr_160px_1fr_auto] sm:items-end">
              <Field label="Paid into"><Select name="bank_account_id">{bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.code} {b.name}</option>)}</Select></Field>
              <Field label="Date"><Input name="date" type="date" defaultValue={today()} /></Field>
              <Field label="Reference (statement or payment)"><Input name="reference" placeholder="WesBank DIC statement October" /></Field>
              <SubmitButton pendingText="Recording…">Record bank payment</SubmitButton>
            </div>
            <p className="px-5 pb-4 text-[13px] text-ink-faint">Tick the deals on the bank&apos;s statement. The total of the ticked lines is recorded as one payment, so it matches your bank statement.</p>
          </form>
        )}
      </Panel>

      {received.length > 0 && (
        <Panel title="Received" flush>
          <Table>
            <thead><tr><Th>Bank</Th><Th>Application</Th><Th>Customer and car</Th><Th>Received</Th><Th>Reference</Th><Th className="text-right">Total</Th></tr></thead>
            <tbody>
              {received.map((r) => (
                <tr key={r.id}>
                  <Td>{r.bank}</Td><Td>{appLink(r)}</Td><Td>{who(r)}<div className="text-[12px] text-ink-faint">{car(r)}</div></Td>
                  <Td>{date(r.dic_received_on)}</Td><Td className="text-ink-soft">{r.dic_reference ?? ""}</Td>
                  <Td className="num"><Badge tone="jade">{money(total(r))}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}
    </>
  );
}
