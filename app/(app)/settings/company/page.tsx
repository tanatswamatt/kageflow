import type { Metadata } from "next";
import { Dl, Field, Input, Notice, PageHeader, Panel, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { getContext } from "@/lib/context";
import { updateCompany } from "../actions";

export const metadata: Metadata = { title: "Company" };

export default async function CompanyPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const c = ctx.company;
  const canEdit = ctx.can("company.manage");
  return (
    <>
      <PageHeader title="Company" description="These details appear on documents you send." />
      <Notice params={params} />
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <Panel>
          <form action={updateCompany} className="grid gap-4 sm:grid-cols-2">
            <fieldset disabled={!canEdit} className="contents">
              <Field label="Trading name" className="sm:col-span-2"><Input name="name" defaultValue={c.name} required /></Field>
              <Field label="Registered name" className="sm:col-span-2"><Input name="legal_name" defaultValue={c.legal_name ?? ""} /></Field>
              <Field label={ctx.rules.registrationLabel}><Input name="registration_no" defaultValue={c.registration_no ?? ""} /></Field>
              <Field label="VAT number" hint={ctx.rules.fiscalInvoices ? `Set this if VAT registered with ${ctx.rules.taxAuthority}. Tax invoices still come from your fiscal device` : "Set this if VAT registered: invoices then print as Tax Invoice"}><Input name="vat_no" defaultValue={c.vat_no ?? ""} /></Field>
              <Field label="Address" hint={`Printed on invoices (${ctx.rules.taxAuthority} requires it)`} className="sm:col-span-2"><Textarea name="address" rows={3} defaultValue={c.address ?? ""} /></Field>
              <Field label="Phone"><Input name="phone" defaultValue={c.phone ?? ""} /></Field>
              <Field label="Email for customer replies"><Input name="email" type="email" defaultValue={c.email ?? ""} /></Field>
              <Field label="Bank details" hint="Printed on invoices and quotes" className="sm:col-span-2"><Textarea name="bank_details" rows={3} defaultValue={c.bank_details ?? ""} placeholder={"FNB, Account 62000000000\nBranch 250655, Swift FIRNZAJJ"} /></Field>
              <Field label="Default payment terms (days)"><Input name="default_payment_days" inputMode="numeric" defaultValue={c.default_payment_days} /></Field>
              <div />
              <Field label="Footer on documents" className="sm:col-span-2"><Textarea name="invoice_footer" rows={2} defaultValue={c.invoice_footer ?? ""} placeholder="Directors: ... | Terms and conditions apply" /></Field>
              {canEdit && <div className="sm:col-span-2"><SubmitButton>Save changes</SubmitButton></div>}
            </fieldset>
          </form>
        </Panel>
        <div className="flex flex-col gap-6 self-start">
        <Panel title="Your Kageflow dealer code">
          <div className="font-mono text-[22px] font-semibold tracking-wider">{c.dealer_code}</div>
          <p className="mt-2 text-[13px] text-ink-soft">Give this code to dealers you buy cars from. When they invoice you a car in Kageflow, its details and photos come straight into your stock under Incoming cars.</p>
        </Panel>
        <Panel title="Fixed settings">
          <Dl items={[["Country", ctx.rules.name], ["Base currency", c.base_currency], ["VAT rate", ctx.rules.vatRateLabel], ["Tax authority", ctx.rules.taxAuthority], ["Privacy law", ctx.rules.privacyLaw]]} />
          <p className="mt-3 text-[13px] text-ink-faint">The country and base currency are set when the company is created and can&apos;t be changed: tax, invoices and privacy rules follow the country, and every posted amount is stored in the base currency.</p>
        </Panel>
        </div>
      </div>
    </>
  );
}
