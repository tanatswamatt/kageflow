import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Dl, Field, Input, Notice, PageHeader, Panel, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { FinanceCalculator } from "@/components/finance/calculator";
import { getContext } from "@/lib/context";
import { date, dateTime, moneyFor, today } from "@/lib/format";
import { amountToFinance, banksFor, FINANCE_DOCS, FINANCE_LABEL, FINANCE_TONE, type FinanceApplication, type FinanceSubmission } from "@/lib/finance";
import { loadBankAccounts } from "@/lib/purchases-data";
import { addSubmission, recordPayout, saveApplication, setApplicationCancelled, updateSubmission } from "../actions";

export const metadata: Metadata = { title: "Finance application" };

const n = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(Number(v)));

export default async function FinanceAppPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await getContext();
  const money = moneyFor(ctx.company.base_currency);
  const cur = ctx.company.base_currency === "ZAR" ? "R" : ctx.company.base_currency;
  if (!ctx.can("sales.write")) notFound();
  const { data } = await ctx.supabase.from("finance_applications").select("*, crm_accounts(id, name), sales_docs(id, number, total), inventory_units(id, stock_no, make, model, year, serial_no)").eq("id", id).eq("company_id", ctx.companyId).maybeSingle();
  if (!data) notFound();
  const app = data as FinanceApplication & {
    crm_accounts: { id: string; name: string } | null;
    sales_docs: { id: string; number: string | null; total: number } | null;
    inventory_units: { id: string; stock_no: string | null; make: string | null; model: string | null; year: number | null; serial_no: string } | null;
  };
  const [{ data: subs }, banks] = await Promise.all([
    ctx.supabase.from("finance_submissions").select("*").eq("application_id", id).order("submitted_at"),
    ctx.can("payments.write") ? loadBankAccounts(ctx) : Promise.resolve([]),
  ]);
  const submissions = (subs ?? []) as FinanceSubmission[];
  const toFinance = amountToFinance(app);
  const cancelled = app.status === "cancelled";
  const docsDone = FINANCE_DOCS.filter(([k]) => app.documents?.[k]).length;
  const v = app.inventory_units;

  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-3">{app.number} <Badge tone={FINANCE_TONE[app.status]}>{FINANCE_LABEL[app.status]}</Badge></span>}
        description={<>{[app.first_name, app.last_name].filter(Boolean).join(" ") || app.crm_accounts?.name}{v ? ` · ${[v.year, v.make, v.model].filter(Boolean).join(" ")} (${v.stock_no})` : ""}</>}
        back={{ href: "/sales/finance", label: "Finance applications" }}
        actions={<a href={`/print/finance/${app.id}`} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-shadow-700 hover:underline">Print application</a>}
      />
      <Notice params={sp} />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <form action={saveApplication} className="flex min-w-0 flex-col gap-6">
          <input type="hidden" name="id" value={app.id} />
          <fieldset disabled={cancelled} className="contents">
            <Panel title="Buyer">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="First names"><Input name="first_name" defaultValue={app.first_name ?? ""} /></Field>
                <Field label="Surname"><Input name="last_name" defaultValue={app.last_name ?? ""} /></Field>
                <Field label={ctx.rules.idLabel} hint={`${ctx.rules.idHint}, or a passport number`}><Input name="id_number" inputMode={ctx.rules.code === "ZA" ? "numeric" : "text"} defaultValue={app.id_number ?? ""} autoComplete="off" /></Field>
                <Field label="Cellphone"><Input name="phone" defaultValue={app.phone ?? ""} /></Field>
                <Field label="Email"><Input name="email" type="email" defaultValue={app.email ?? ""} /></Field>
                <Field label="Marital status"><Select name="marital_status" defaultValue={app.marital_status ?? ""}><option value="">Not set</option>{["Single", "Married in community of property", "Married out of community of property", "Divorced", "Widowed", "Life partner"].map((o) => <option key={o}>{o}</option>)}</Select></Field>
                <Field label="Dependants"><Input name="dependants" inputMode="numeric" defaultValue={n(app.dependants)} /></Field>
                <Field label="Home"><Select name="residential_status" defaultValue={app.residential_status ?? ""}><option value="">Not set</option>{["Owner", "Renting", "Living with parents", "Company provided", "Other"].map((o) => <option key={o}>{o}</option>)}</Select></Field>
                <Field label="Home address" className="sm:col-span-2"><Textarea name="address" rows={2} defaultValue={app.address ?? ""} /></Field>
                <Field label="Years at this address"><Input name="years_at_address" inputMode="decimal" defaultValue={n(app.years_at_address)} /></Field>
              </div>
            </Panel>
            <Panel title="Work and income (monthly, R)">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Employer"><Input name="employer" defaultValue={app.employer ?? ""} /></Field>
                <Field label="Occupation"><Input name="occupation" defaultValue={app.occupation ?? ""} /></Field>
                <Field label="Employment"><Select name="employment_type" defaultValue={app.employment_type ?? ""}><option value="">Not set</option>{["Permanent", "Contract", "Self-employed", "Pensioner", "Other"].map((o) => <option key={o}>{o}</option>)}</Select></Field>
                <Field label="Employed since"><Input name="employed_since" type="date" defaultValue={app.employed_since ?? ""} /></Field>
                <Field label="Gross salary"><Input name="gross_income" inputMode="decimal" defaultValue={n(app.gross_income)} /></Field>
                <Field label="Net salary (take-home)"><Input name="net_income" inputMode="decimal" defaultValue={n(app.net_income)} /></Field>
                <Field label="Other income"><Input name="other_income" inputMode="decimal" defaultValue={n(app.other_income)} /></Field>
                <Field label="Monthly expenses"><Input name="expenses" inputMode="decimal" defaultValue={n(app.expenses)} /></Field>
              </div>
            </Panel>
            <Panel title={`The deal (${cur})`}>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Price incl. VAT"><Input name="purchase_price" inputMode="decimal" defaultValue={n(app.purchase_price)} /></Field>
                <Field label="Extras (warranty, accessories)"><Input name="extras" inputMode="decimal" defaultValue={n(app.extras)} /></Field>
                <Field label="Cash deposit"><Input name="deposit" inputMode="decimal" defaultValue={n(app.deposit)} /></Field>
                <Field label="Trade-in credit"><Input name="trade_in_credit" inputMode="decimal" defaultValue={n(app.trade_in_credit)} /></Field>
                <Field label="Term (months)"><Input name="term_months" inputMode="numeric" defaultValue={n(app.term_months)} /></Field>
                <Field label="Balloon (%)"><Input name="balloon_pct" inputMode="decimal" defaultValue={n(app.balloon_pct)} /></Field>
                <Field label="Expected rate (%)"><Input name="est_rate" inputMode="decimal" defaultValue={n(app.est_rate)} /></Field>
              </div>
              <p className="mt-3 text-sm">Amount to finance: <strong className="tabular-nums">{money(toFinance)}</strong></p>
            </Panel>
            <Panel title={`Documents (${docsDone} of ${FINANCE_DOCS.length})`}>
              <div className="grid gap-2 sm:grid-cols-2">
                {FINANCE_DOCS.map(([k, l]) => (
                  <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" name={`doc_${k}`} defaultChecked={!!app.documents?.[k]} className="size-4 accent-jade-700" />{l}</label>
                ))}
              </div>
              <label className="mt-4 flex items-start gap-2 rounded-[var(--radius-control)] bg-paper p-3 text-sm">
                <input type="checkbox" name="consent" defaultChecked={!!app.consent_at} className="mt-0.5 size-4 accent-jade-700" />
                <span>The customer consented to a credit check and to their details being shared with the banks below.{app.consent_at && <span className="block text-xs text-ink-faint">Recorded {dateTime(app.consent_at)}</span>}</span>
              </label>
              <Field label="Notes" className="mt-3"><Textarea name="notes" rows={2} defaultValue={app.notes ?? ""} /></Field>
            </Panel>
            {!cancelled && <div className="sticky bottom-0 -mx-1 border-t border-line bg-paper/95 px-1 py-3 backdrop-blur"><SubmitButton>Save application</SubmitButton></div>}
          </fieldset>
        </form>

        <div className="flex flex-col gap-6">
          <Panel title="Banks">
            {submissions.length === 0 && <p className="mb-3 text-sm text-ink-soft">Not sent to any bank yet. Submit through the bank&apos;s portal or Signio, then record it here.</p>}
            <ul className="flex flex-col gap-4">
              {submissions.map((s) => (
                <li key={s.id} className="rounded-[var(--radius-control)] border border-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{s.bank}</span>
                    <Badge tone={FINANCE_TONE[s.status]}>{FINANCE_LABEL[s.status]}</Badge>
                  </div>
                  <div className="text-xs text-ink-faint">Sent {date(s.submitted_at.slice(0, 10))}{s.reference ? ` · ref ${s.reference}` : ""}</div>
                  {s.instalment != null && <div className="mt-1 text-sm">{money(s.approved_amount)} at {Number(s.rate)}% over {s.term_months} months: <strong>{money(s.instalment)}</strong> a month</div>}
                  {s.conditions && <div className="mt-1 text-xs text-ink-soft">{s.conditions}</div>}
                  {s.dic_amount != null && Number(s.dic_amount) > 0 && <div className="mt-1 text-xs text-jade-700">Dealer commission {money(s.dic_amount)}</div>}
                  {s.status === "paid_out" ? (
                    <div className="mt-2 text-sm text-jade-700">Paid out {money(s.payout_amount)} on {date(s.payout_date)}</div>
                  ) : !cancelled && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[13px] font-medium text-shadow-700">Record their answer</summary>
                      <form action={updateSubmission} className="mt-2 grid grid-cols-2 gap-2">
                        <input type="hidden" name="id" value={s.id} /><input type="hidden" name="application_id" value={app.id} />
                        <Field label="Answer" className="col-span-2"><Select name="status" defaultValue={s.status}>{(["submitted", "approved", "counter_offer", "declined", "contracted", "withdrawn"] as const).map((x) => <option key={x} value={x}>{FINANCE_LABEL[x]}</option>)}</Select></Field>
                        <Field label="Approved amount"><Input name="approved_amount" inputMode="decimal" defaultValue={n(s.approved_amount ?? toFinance)} /></Field>
                        <Field label="Rate %"><Input name="rate" inputMode="decimal" defaultValue={n(s.rate)} /></Field>
                        <Field label="Term"><Input name="term_months" inputMode="numeric" defaultValue={n(s.term_months ?? app.term_months)} /></Field>
                        <Field label="Instalment"><Input name="instalment" inputMode="decimal" defaultValue={n(s.instalment)} /></Field>
                        <Field label={`Balloon (${cur})`}><Input name="balloon_amount" inputMode="decimal" defaultValue={n(s.balloon_amount)} /></Field>
                        <Field label="Dealer commission (DIC, R)"><Input name="dic_amount" inputMode="decimal" defaultValue={n(s.dic_amount)} /></Field>
                        <Field label="Bank ref"><Input name="reference" defaultValue={s.reference ?? ""} /></Field>
                        <Field label="Conditions" className="col-span-2"><Input name="conditions" defaultValue={s.conditions ?? ""} placeholder="e.g. proof of income, 10% deposit" /></Field>
                        <div className="col-span-2"><SubmitButton size="sm">Save answer</SubmitButton></div>
                      </form>
                    </details>
                  )}
                  {["approved", "counter_offer", "contracted"].includes(s.status) && ctx.can("payments.write") && (
                    <details className="mt-2" open={s.status === "contracted"}>
                      <summary className="cursor-pointer text-[13px] font-medium text-jade-700">Record the payout</summary>
                      <form action={recordPayout} className="mt-2 grid grid-cols-2 gap-2">
                        <input type="hidden" name="id" value={s.id} /><input type="hidden" name="application_id" value={app.id} />
                        <Field label={`Amount paid (${cur})`}><Input name="amount" inputMode="decimal" defaultValue={n(s.approved_amount ?? toFinance)} required /></Field>
                        <Field label="Date"><Input name="date" type="date" defaultValue={today()} /></Field>
                        <Field label="Into" className="col-span-2"><Select name="bank_account_id">{banks.map((b) => <option key={b.id} value={b.id}>{b.code} {b.name}</option>)}</Select></Field>
                        <div className="col-span-2"><SubmitButton size="sm">Record payout</SubmitButton></div>
                        {!app.order_id && <p className="col-span-2 text-xs text-amber-700">Not linked to an order: the payout is held as the customer&apos;s deposit until you apply it to their invoice.</p>}
                      </form>
                    </details>
                  )}
                </li>
              ))}
            </ul>
            {!cancelled && (
              <form action={addSubmission} className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-4">
                <input type="hidden" name="application_id" value={app.id} />
                <Field label="Send to"><Select name="bank" defaultValue={banksFor(ctx.rules.code)[0]}>{banksFor(ctx.rules.code).map((b) => <option key={b}>{b}</option>)}</Select></Field>
                <Field label="Bank ref (optional)"><Input name="reference" /></Field>
                <Field label="Other bank name" className="col-span-2"><Input name="bank_other" placeholder="Only if Other" /></Field>
                <div className="col-span-2"><SubmitButton size="sm">Mark as sent</SubmitButton></div>
              </form>
            )}
          </Panel>

          <Panel title="Instalment estimate">
            <FinanceCalculator amount={toFinance} rate={Number(app.est_rate ?? 12.75)} term={app.term_months ?? 72} balloonPct={Number(app.balloon_pct ?? 0)} currency={ctx.company.base_currency} />
          </Panel>

          <Panel title="Linked">
            <Dl items={[
              ["Customer", app.crm_accounts ? <Link key="c" className="hover:underline" href={`/crm/accounts/${app.crm_accounts.id}`}>{app.crm_accounts.name}</Link> : ""],
              ["Order", app.sales_docs ? <Link key="o" className="hover:underline" href={`/sales/doc/${app.sales_docs.id}`}>{app.sales_docs.number}</Link> : "None"],
              ["Vehicle", v ? <Link key="v" className="hover:underline" href={`/inventory/units/${v.id}`}>{v.stock_no} {[v.make, v.model].filter(Boolean).join(" ")}</Link> : "None"],
            ]} />
            <form action={setApplicationCancelled} className="mt-4">
              <input type="hidden" name="id" value={app.id} /><input type="hidden" name="cancel" value={String(!cancelled)} />
              <SubmitButton tone="quiet" size="sm" confirm={cancelled ? undefined : "Cancel this application?"}>{cancelled ? "Reopen application" : "Cancel application"}</SubmitButton>
            </form>
          </Panel>
        </div>
      </div>
    </>
  );
}
