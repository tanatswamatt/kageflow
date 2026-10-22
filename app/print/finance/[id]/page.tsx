import type { Metadata } from "next";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { getContext } from "@/lib/context";
import { date, money } from "@/lib/format";
import { amountToFinance, FINANCE_DOCS, type FinanceApplication } from "@/lib/finance";

export const metadata: Metadata = { title: "Finance application" };

export default async function PrintFinancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!ctx.can("sales.write")) notFound();
  const { data } = await ctx.supabase.from("finance_applications").select("*, inventory_units(stock_no, serial_no, make, model, variant, year, mileage_km, colour, is_second_hand)").eq("id", id).eq("company_id", ctx.companyId).maybeSingle();
  if (!data) notFound();
  const a = data as FinanceApplication & { inventory_units: { stock_no: string | null; serial_no: string; make: string | null; model: string | null; variant: string | null; year: number | null; mileage_km: number | null; colour: string | null; is_second_hand: boolean } | null };
  const v = a.inventory_units;
  const c = ctx.company;
  const rows = (items: [string, string | number | null | undefined][]) => (
    <dl className="grid grid-cols-[180px_1fr] gap-x-4 gap-y-1 text-[13px]">
      {items.map(([k, val]) => <Fragment key={k}><dt className="text-[#5b6472]">{k}</dt><dd>{val === null || val === undefined || val === "" ? "" : String(val)}</dd></Fragment>)}
    </dl>
  );
  const h = "mt-6 mb-2 border-b border-[#d9dde3] pb-1 text-[14px] font-semibold";

  return (
    <main className="min-h-dvh bg-paper py-8 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[820px] justify-end px-4 print:hidden"><PrintButton /></div>
      <article className="mx-auto max-w-[820px] bg-white p-10 text-[#16181d] shadow-sm print:p-0 print:shadow-none">
        <header className="flex items-start justify-between">
          <div>
            <h1 className="text-[22px] font-semibold">Vehicle finance application</h1>
            <p className="text-[13px] text-[#5b6472]">{a.number} · {date(a.created_at.slice(0, 10))}</p>
          </div>
          <div className="text-right text-[13px]">
            <div className="font-semibold">{c.legal_name ?? c.name}</div>
            {c.phone && <div>{c.phone}</div>}
            {c.email && <div>{c.email}</div>}
          </div>
        </header>
        <h2 className={h}>Applicant</h2>
        {rows([
          ["Name", [a.first_name, a.last_name].filter(Boolean).join(" ")], ["ID number", a.id_number], ["Cellphone", a.phone], ["Email", a.email],
          ["Marital status", a.marital_status], ["Dependants", a.dependants], ["Home", a.residential_status], ["Address", a.address], ["Years at address", a.years_at_address],
        ])}
        <h2 className={h}>Employment and monthly income</h2>
        {rows([
          ["Employer", a.employer], ["Occupation", a.occupation], ["Employment", a.employment_type], ["Employed since", a.employed_since ? date(a.employed_since) : null],
          ["Gross salary", a.gross_income != null ? money(a.gross_income) : null], ["Net salary", a.net_income != null ? money(a.net_income) : null],
          ["Other income", a.other_income != null ? money(a.other_income) : null], ["Monthly expenses", a.expenses != null ? money(a.expenses) : null],
        ])}
        <h2 className={h}>Vehicle</h2>
        {v ? rows([
          ["Vehicle", [v.year, v.make, v.model, v.variant].filter(Boolean).join(" ")], ["VIN", v.serial_no], ["Stock number", v.stock_no],
          ["Mileage", v.mileage_km != null ? `${v.mileage_km.toLocaleString("en-US")} km` : null], ["Colour", v.colour], ["Condition", v.is_second_hand ? "Used" : "New"],
        ]) : <p className="text-[13px] text-[#5b6472]">Not chosen yet.</p>}
        <h2 className={h}>Deal structure</h2>
        {rows([
          ["Price incl. VAT", a.purchase_price != null ? money(a.purchase_price) : null], ["Extras", money(a.extras)], ["Cash deposit", money(a.deposit)], ["Trade-in credit", money(a.trade_in_credit)],
          ["Amount to finance", money(amountToFinance(a))], ["Term", a.term_months ? `${a.term_months} months` : null], ["Balloon", `${Number(a.balloon_pct)}%`],
        ])}
        <h2 className={h}>Documents attached</h2>
        <p className="text-[13px]">{FINANCE_DOCS.map(([k, l]) => `${a.documents?.[k] ? "☑" : "☐"} ${l}`).join("    ")}</p>
        <h2 className={h}>Consent</h2>
        <p className="text-[13px]">{a.consent_at ? `The applicant consented on ${date(a.consent_at.slice(0, 10))} to a credit check and to their details being shared with the selected finance providers.` : "Consent not yet recorded."}</p>
        <div className="mt-10 grid grid-cols-2 gap-10 text-[13px]">
          <div className="border-t border-[#16181d] pt-1">Applicant signature and date</div>
          <div className="border-t border-[#16181d] pt-1">Dealer representative</div>
        </div>
      </article>
    </main>
  );
}
