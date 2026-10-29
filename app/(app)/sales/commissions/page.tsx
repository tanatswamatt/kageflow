import type { Metadata } from "next";
import Link from "next/link";
import { Badge, buttonClass, Empty, Field, Input, Notice, PageHeader, Panel, Select, Table, Td, Th } from "@/components/ui";
import { getContext } from "@/lib/context";
import { memberNames } from "@/lib/members";
import { date, label, moneyFor, today } from "@/lib/format";
import { loadBankAccounts } from "@/lib/purchases-data";
import { cancelCommission, commissionAction } from "./actions";

export const metadata: Metadata = { title: "Commission" };

type K = { id: string; invoice_id: string; user_id: string; basis: string; rate: number; sale_amount: number; gross_profit: number; amount: number; status: string; note: string | null; created_at: string; sales_docs: { number: string | null; issue_date: string } | null };
const TONE: Record<string, "amber" | "shadow" | "jade" | "neutral"> = { pending: "amber", approved: "shadow", paid: "jade", cancelled: "neutral" };
const BASIS: Record<string, (r: number, money: (v: number) => string) => string> = {
  gross_profit_pct: (r) => `${r}% of gross profit`,
  sale_pct: (r) => `${r}% of sale`,
  flat_per_car: (r, money) => `${money(r)} per car`,
};

export default async function CommissionsPage({ searchParams }: { searchParams: Promise<{ s?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const money = moneyFor(ctx.company.base_currency);
  const status = ["pending", "approved", "paid", "cancelled", "all"].includes(sp.s ?? "") ? sp.s! : "pending";
  let q = ctx.supabase.from("commissions").select("*, sales_docs(number, issue_date)").eq("company_id", ctx.companyId).order("created_at", { ascending: false }).limit(500);
  if (status !== "all") q = q.eq("status", status);
  const [{ data }, names, banks] = await Promise.all([q, memberNames(), ctx.can("ledger.write") ? loadBankAccounts(ctx) : Promise.resolve([])]);
  const rows = (data ?? []) as unknown as K[];
  const canManage = ctx.can("ledger.write");
  const byPerson = Object.entries(rows.reduce<Record<string, number>>((m, k) => ({ ...m, [k.user_id]: (m[k.user_id] ?? 0) + Number(k.amount) }), {}));

  return (
    <>
      <PageHeader title="Commission" description={canManage ? "Worked out automatically when an invoice is issued. Approve to book it as owed, then pay." : "Your commission on issued invoices."} />
      <Notice params={sp} />
      <nav className="mb-4 flex flex-wrap gap-1">
        {["pending", "approved", "paid", "cancelled", "all"].map((k) => <Link key={k} href={`/sales/commissions?s=${k}`} className={`rounded-full px-3 py-1 text-[13px] ${status === k ? "bg-shadow-800 text-white" : "text-ink-soft hover:bg-shadow-100"}`}>{label(k)}</Link>)}
      </nav>
      {byPerson.length > 0 && <p className="mb-4 text-sm text-ink-soft">{byPerson.map(([u, v], i) => <span key={u}>{i > 0 && " · "}{names.get(u) ?? "Former member"} <strong className="text-ink">{money(v)}</strong></span>)}</p>}
      {rows.length === 0 ? <Panel><Empty title="Nothing here">Set commission plans under Settings, Team. Commission appears as invoices are issued.</Empty></Panel> : (
        <form action={commissionAction} className="flex flex-col gap-4">
          <Panel flush>
            <Table>
              <thead><tr>{canManage && <Th />}<Th>Invoice</Th><Th>Salesperson</Th><Th>Plan</Th><Th className="text-right">Sale</Th><Th className="text-right">Gross profit</Th><Th className="text-right">Commission</Th><Th>Status</Th></tr></thead>
              <tbody>
                {rows.map((k) => (
                  <tr key={k.id} className="align-top hover:bg-paper">
                    {canManage && <Td>{(k.status === "pending" || k.status === "approved") && <input type="checkbox" name="ids" value={k.id} aria-label="Select" className="size-4 accent-jade-700" />}</Td>}
                    <Td><Link className="font-medium hover:underline" href={`/sales/doc/${k.invoice_id}`}>{k.sales_docs?.number}</Link><div className="text-xs text-ink-faint">{date(k.sales_docs?.issue_date)}</div></Td>
                    <Td>{names.get(k.user_id) ?? "Former member"}</Td>
                    <Td className="text-ink-soft">{BASIS[k.basis]?.(Number(k.rate), money) ?? k.basis}</Td>
                    <Td className="num">{money(k.sale_amount)}</Td>
                    <Td className="num">{money(k.gross_profit)}</Td>
                    <Td className="num font-semibold">{money(k.amount)}</Td>
                    <Td>
                      <Badge tone={TONE[k.status]}>{label(k.status)}</Badge>
                      {k.note && <div className="text-xs text-ink-faint">{k.note}</div>}
                      {canManage && (k.status === "pending" || k.status === "approved") && (
                        <details className="mt-1"><summary className="cursor-pointer text-xs text-ink-faint">Cancel</summary>
                          <div className="mt-1 flex gap-1"><input form={`cancel-${k.id}`} name="reason" placeholder="Reason" className="h-8 w-32 rounded border border-line-strong px-2 text-xs" /><button form={`cancel-${k.id}`} className="text-xs text-ember-700">Cancel</button></div>
                        </details>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>
          {canManage && (status === "pending" || status === "approved" || status === "all") && (
            <Panel title="With the ticked ones">
              <div className="grid gap-3 sm:grid-cols-4 sm:items-end">
                <Field label="Date"><Input type="date" name="date" defaultValue={today()} /></Field>
                <Field label="Paid from (for paying)"><Select name="bank_account_id">{banks.map((b) => <option key={b.id} value={b.id}>{b.code} {b.name}</option>)}</Select></Field>
                <Field label="Reference (for paying)"><Input name="reference" placeholder="October commission" /></Field>
                <div className="flex gap-2">
                  <button type="submit" name="do" value="approve" className={buttonClass("secondary", "sm")}>Approve</button>
                  <button type="submit" name="do" value="pay" className={buttonClass("primary", "sm")}>Pay</button>
                </div>
              </div>
              <p className="mt-3 text-xs text-ink-faint">Approve books pending commission as owed (Dr Sales commission, Cr Commission payable). Pay settles approved commission from the bank in one payment.</p>
            </Panel>
          )}
        </form>
      )}
      {rows.filter((k) => k.status === "pending" || k.status === "approved").map((k) => (
        <form key={k.id} id={`cancel-${k.id}`} action={cancelCommission} className="hidden"><input type="hidden" name="id" value={k.id} /></form>
      ))}
    </>
  );
}
