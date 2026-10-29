import { Field, Input, Textarea } from "@/components/ui";
import type { TradeIn } from "@/lib/finance";

const n = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(Number(v)));

export function TradeInFields({ t, vatVendor, currency = "ZAR" }: { t?: Partial<TradeIn>; vatVendor: boolean; currency?: string }) {
  const cur = currency === "ZAR" ? "R" : currency;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Make"><Input name="make" required defaultValue={t?.make ?? ""} /></Field>
        <Field label="Model"><Input name="model" defaultValue={t?.model ?? ""} /></Field>
        <Field label="Variant"><Input name="variant" defaultValue={t?.variant ?? ""} /></Field>
        <Field label="Year"><Input name="year" inputMode="numeric" defaultValue={n(t?.year)} /></Field>
        <Field label="Mileage (km)"><Input name="mileage_km" inputMode="numeric" defaultValue={n(t?.mileage_km)} /></Field>
        <Field label="Colour"><Input name="colour" defaultValue={t?.colour ?? ""} /></Field>
        <Field label="VIN" className="sm:col-span-2"><Input name="vin" className="font-mono uppercase" defaultValue={t?.vin ?? ""} /></Field>
        <Field label="Registration"><Input name="registration" className="uppercase" defaultValue={t?.registration ?? ""} /></Field>
        <Field label="Condition notes" className="sm:col-span-3"><Textarea name="condition_notes" rows={2} defaultValue={t?.condition_notes ?? ""} placeholder="Scratches on bumper, needs tyres, full service history" /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={`Trade value (your estimate, ${cur})`} hint="TransUnion or Lightstone trade value"><Input name="valuation" inputMode="decimal" defaultValue={n(t?.valuation)} /></Field>
        <Field label={`Allowance agreed (${cur}, incl. VAT)`} hint="What the customer gets for it"><Input name="allowance" inputMode="decimal" defaultValue={n(t?.allowance)} /></Field>
        <Field label={`Settlement owed to their bank (${cur})`}><Input name="settlement_amount" inputMode="decimal" defaultValue={n(t?.settlement_amount ?? 0)} /></Field>
        <Field label="Their finance house"><Input name="settlement_bank" defaultValue={t?.settlement_bank ?? ""} placeholder="WesBank" /></Field>
        <Field label="Their account number"><Input name="settlement_ref" defaultValue={t?.settlement_ref ?? ""} /></Field>
        {vatVendor && (
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="seller_is_vendor" defaultChecked={t?.seller_is_vendor ?? false} className="size-4 accent-jade-700" /> Seller is a VAT vendor (gave a tax invoice)</label>
        )}
      </div>
    </div>
  );
}
