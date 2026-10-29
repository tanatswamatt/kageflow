"use client";

import { useState } from "react";
import { Field, Input, Select } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { COUNTRIES, COUNTRY_CODES, type CountryCode } from "@/lib/country";

const CURRENCY_NAMES: Record<string, string> = { ZAR: "South African rand (ZAR)", USD: "US dollar (USD)", ZWG: "Zimbabwe Gold (ZiG)" };

/** Sign-up company form. The country decides tax, invoices and privacy rules and can't be changed later. */
export function CompanyForm({ action }: { action: (fd: FormData) => Promise<void> }) {
  const [country, setCountry] = useState<CountryCode | null>(null);
  const r = country ? COUNTRIES[country] : null;

  return (
    <form action={action} className="grid gap-4 rounded-[var(--radius-panel)] border border-line bg-surface p-6 sm:grid-cols-2">
      <fieldset className="sm:col-span-2">
        <legend className="mb-2 text-[13px] font-medium text-ink-soft">Where is your dealership registered?</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {COUNTRY_CODES.map((c) => {
            const x = COUNTRIES[c];
            const on = country === c;
            return (
              <label key={c} className={`flex cursor-pointer flex-col gap-1 rounded-[var(--radius-control)] border p-4 transition-colors ${on ? "border-jade-700 bg-jade-50 ring-1 ring-jade-700" : "border-line hover:border-line-strong"}`}>
                <span className="flex items-center gap-2">
                  <input type="radio" name="country" value={c} required checked={on} onChange={() => setCountry(c)} className="accent-jade-700" />
                  <span className="font-semibold">{x.name}</span>
                </span>
                <span className="pl-6 text-[13px] text-ink-soft">VAT {x.vatRateLabel}, {x.taxAuthority}, {x.privacyLawShort === "POPIA" ? "POPIA" : "Data Protection Act"}</span>
              </label>
            );
          })}
        </div>
        <p className="mt-2 text-[13px] text-amber-700">You can&apos;t change the country later. Kageflow follows that country&apos;s VAT, invoice and privacy rules.</p>
      </fieldset>

      {r && (
        <>
          {r.baseCurrencies.length > 1 ? (
            <Field label="Keep your books in" hint="Can't be changed later" className="sm:col-span-2">
              <Select name="base_currency" defaultValue={r.baseCurrencies[0]}>
                {r.baseCurrencies.map((c) => <option key={c} value={c}>{CURRENCY_NAMES[c] ?? c}</option>)}
              </Select>
            </Field>
          ) : (
            <input type="hidden" name="base_currency" value={r.baseCurrencies[0]} />
          )}
          <Field label="Trading name" className="sm:col-span-2">
            <Input name="name" required minLength={2} placeholder={r.tradingPlaceholder} />
          </Field>
          <Field label="Registered name" className="sm:col-span-2">
            <Input name="legal_name" placeholder={r.legalPlaceholder} />
          </Field>
          <Field label={r.registrationLabel}>
            <Input name="registration_no" placeholder={r.registrationPlaceholder} />
          </Field>
          <Field label="VAT number" hint={r.vatNoHint}>
            <Input name="vat_no" inputMode="numeric" />
          </Field>
          {r.fiscalInvoices && (
            <p className="rounded-[var(--radius-control)] bg-amber-50 px-3 py-2 text-[13px] text-amber-700 sm:col-span-2">
              {r.taxAuthority} requires tax invoices from a fiscal device. Until Kageflow connects to {r.taxAuthority}, keep issuing your fiscal tax invoices from your device; Kageflow invoices are marked as not fiscal.
            </p>
          )}
          <div className="sm:col-span-2">
            <SubmitButton pendingText="Creating company…" confirm={`Create your company in ${r.name}? The country can't be changed later.`}>Create company</SubmitButton>
          </div>
        </>
      )}
    </form>
  );
}
