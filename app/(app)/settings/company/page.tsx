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
              <Field label="CIPC registration number"><Input name="registration_no" defaultValue={c.registration_no ?? ""} /></Field>
              <Field label="VAT number" hint="Set this if VAT registered: invoices then print as Tax Invoice"><Input name="vat_no" defaultValue={c.vat_no ?? ""} /></Field>
              <Field label="Address" hint="Printed on invoices (SARS requires it)" className="sm:col-span-2"><Textarea name="address" rows={3} defaultValue={c.address ?? ""} /></Field>
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
        <Panel title="Fixed settings" className="self-start">
          <Dl items={[["Base currency", c.base_currency], ["Country", c.country === "ZA" ? "South Africa" : c.country]]} />
          <p className="mt-3 text-[13px] text-ink-faint">The base currency is set when the company is created because every posted amount is stored in it.</p>
        </Panel>
      </div>
    </>
  );
}
