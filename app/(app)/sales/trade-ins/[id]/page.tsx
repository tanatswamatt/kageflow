import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Dl, Field, Input, Notice, PageHeader, Panel, Select } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { TradeInFields } from "@/components/finance/trade-in-fields";
import { getContext } from "@/lib/context";
import { date, money, today } from "@/lib/format";
import type { TradeIn } from "@/lib/finance";
import { acceptTradeIn, saveTradeIn, undoTradeIn } from "../actions";

export const metadata: Metadata = { title: "Trade-in" };

export default async function TradeInPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await getContext();
  const { data } = await ctx.supabase.from("trade_ins").select("*, crm_accounts(id, name)").eq("id", id).eq("company_id", ctx.companyId).maybeSingle();
  if (!data) notFound();
  const t = data as TradeIn & { crm_accounts: { id: string; name: string } | null };
  const vatVendor = !!ctx.company.vat_no?.trim();
  const allowance = Number(t.allowance ?? 0);
  const vat = vatVendor ? Math.round(allowance * 15 / 115 * 100) / 100 : 0;
  const credit = allowance - Number(t.settlement_amount);
  const draft = t.status === "draft";
  const canWrite = ctx.can("sales.write");
  const { data: orders } = draft
    ? await ctx.supabase.from("sales_docs").select("id, number").eq("company_id", ctx.companyId).eq("doc_type", "order").eq("account_id", t.account_id).neq("status", "draft").order("created_at", { ascending: false }).limit(50)
    : { data: [] };

  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-3">{t.number} <Badge tone={t.status === "accepted" ? "jade" : t.status === "cancelled" ? "neutral" : "amber"}>{draft ? "Offer" : t.status === "accepted" ? "Accepted" : "Undone"}</Badge></span>}
        description={<>{[t.year, t.make, t.model, t.variant].filter(Boolean).join(" ")} from <Link className="hover:underline" href={`/crm/accounts/${t.account_id}`}>{t.crm_accounts?.name}</Link></>}
        back={{ href: "/sales/trade-ins", label: "Trade-ins" }}
      />
      <Notice params={sp} />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Panel title="Vehicle and offer">
          <form action={saveTradeIn} className="flex flex-col gap-5">
            <input type="hidden" name="id" value={t.id} />
            <fieldset disabled={!draft || !canWrite} className="contents">
              <Field label="Against order">
                <Select name="order_id" defaultValue={t.order_id ?? ""}>
                  <option value="">None</option>
                  {((orders ?? []) as { id: string; number: string | null }[]).map((o) => <option key={o.id} value={o.id}>{o.number}</option>)}
                  {!draft && t.order_id && <option value={t.order_id}>Linked order</option>}
                </Select>
              </Field>
              <TradeInFields t={t} vatVendor={vatVendor} />
              {draft && canWrite && <div><SubmitButton tone="secondary">Save changes</SubmitButton></div>}
            </fieldset>
          </form>
        </Panel>
        <div className="flex flex-col gap-6">
          <Panel title="What accepting does">
            <Dl items={[
              ["Allowance", money(allowance)],
              ["Settlement to their bank", money(t.settlement_amount)],
              ["Credit to the customer", <strong key="c" className={credit < 0 ? "text-ember-700" : ""}>{money(credit)}</strong>],
              ["Stock value (excl. VAT)", money(allowance - vat)],
              ...(vatVendor ? ([[t.seller_is_vendor ? "Input VAT" : "Notional input VAT", money(vat)]] as [string, string][]) : []),
            ]} />
            {credit < 0 && <p className="mt-3 text-[13px] text-ember-700">Negative equity: the settlement is more than the allowance. Add the {money(-credit)} shortfall as a line on the invoice, and enter a settlement no bigger than the allowance.</p>}
            {vatVendor && !t.seller_is_vendor && <p className="mt-3 text-xs text-ink-faint">Notional input tax applies to second-hand goods bought from non-vendors. Keep a copy of the seller&apos;s ID and a signed declaration for SARS. Check with your accountant.</p>}
            {draft && canWrite && (
              <form action={acceptTradeIn} className="mt-4 flex flex-col gap-2">
                <input type="hidden" name="id" value={t.id} />
                <Field label="Date taken in"><Input type="date" name="date" defaultValue={today()} /></Field>
                <SubmitButton confirm="Accept this trade-in? The car goes into stock and the customer is credited." pendingText="Accepting…">Accept trade-in</SubmitButton>
              </form>
            )}
          </Panel>
          {t.status === "accepted" && (
            <Panel title="Done">
              <Dl items={[
                ["Accepted", date(t.accepted_at?.slice(0, 10))],
                ["In stock as", t.unit_id ? <Link key="u" className="hover:underline" href={`/inventory/units/${t.unit_id}`}>Open vehicle</Link> : ""],
                ["Customer credit", t.payment_id ? <Link key="p" className="hover:underline" href={`/sales/payments/${t.payment_id}`}>Open credit</Link> : "None"],
                ["Journal", t.journal_id ? <Link key="j" className="hover:underline" href={`/accounting/journals/${t.journal_id}`}>View entries</Link> : ""],
              ]} />
              {ctx.can("payments.write") && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-[13px] text-ink-faint hover:text-ink">Undo trade-in</summary>
                  <form action={undoTradeIn} className="mt-2 flex flex-col gap-2">
                    <input type="hidden" name="id" value={t.id} />
                    <Input name="reason" placeholder="Reason" required />
                    <SubmitButton tone="danger" size="sm" confirm="Undo this trade-in? Its entries are reversed and the vehicle written off.">Undo</SubmitButton>
                  </form>
                </details>
              )}
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
