import type { Metadata } from "next";
import Link from "next/link";
import { Field, Input, Notice, PageHeader, Panel, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { getContext } from "@/lib/context";
import { fail } from "@/lib/forms";
import { listSupplierCar } from "../listing-actions";

export const metadata: Metadata = { title: "List a supplier's car" };

const BODIES = ["Bakkie (single cab)", "Bakkie (double cab)", "Bakkie (extended cab)", "SUV", "Hatchback", "Sedan", "MPV", "Coupe", "Convertible", "Station wagon", "Panel van", "Minibus", "Truck"];

export default async function ListSupplierCarPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; supplier?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  if (!ctx.can("inventory.write")) fail("/inventory/units", "Your role can't add stock");
  const { data } = await ctx.supabase.from("crm_accounts").select("id, name").eq("company_id", ctx.companyId).eq("approved_supplier", true).order("name");
  const suppliers = (data ?? []) as { id: string; name: string }[];
  const cur = ctx.company.base_currency;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="List a supplier's car"
        description="Advertise a car that stays on a supplier's floor plan. It isn't in your stock value or books until you inspect it and buy it."
        back={{ href: "/inventory/units?v=listed", label: "Supplier listings" }}
      />
      <Notice params={sp} />
      {suppliers.length === 0 ? (
        <Panel>
          <p className="text-ink-soft">
            You only list cars from approved suppliers. Open the supplier under <Link href="/crm/accounts" className="text-shadow-700 hover:underline">Accounts</Link> and tick <strong>Approved supplier</strong>
            {ctx.can("company.manage") ? "" : " (an owner or admin does this)"}. Suppliers on Kageflow can also share their cars with you directly: give them your dealer code, {ctx.company.dealer_code}.
          </p>
        </Panel>
      ) : (
        <Panel>
          <form action={listSupplierCar} className="grid gap-4 sm:grid-cols-2">
            <Field label="Supplier" className="sm:col-span-2" hint="Only approved suppliers are listed here">
              <Select name="supplier_id" defaultValue={sp.supplier ?? suppliers[0]?.id} required>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Make"><Input name="make" required placeholder="Toyota" /></Field>
            <Field label="Model"><Input name="model" placeholder="Hilux" /></Field>
            <Field label="Variant"><Input name="variant" placeholder="2.8 GD-6 Raider double cab" /></Field>
            <Field label="Year"><Input name="year" inputMode="numeric" /></Field>
            <Field label="Mileage (km)"><Input name="mileage_km" inputMode="numeric" /></Field>
            <Field label="Colour"><Input name="colour" /></Field>
            <Field label="Gearbox"><Select name="transmission" defaultValue=""><option value="">Not set</option><option>Manual</option><option>Automatic</option></Select></Field>
            <Field label="Fuel"><Select name="fuel_type" defaultValue=""><option value="">Not set</option><option>Petrol</option><option>Diesel</option><option>Hybrid</option><option>Electric</option></Select></Field>
            <Field label="Body"><Select name="body_type" defaultValue=""><option value="">Not set</option>{BODIES.map((b) => <option key={b}>{b}</option>)}</Select></Field>
            <Field label="Registration number" hint="From the registration document"><Input name="registration_no" autoCapitalize="characters" /></Field>
            <Field label="VIN (optional)" hint="From the registration document. You check it on the car at inspection" className="sm:col-span-2">
              <Input name="vin" autoCapitalize="characters" className="font-mono" />
            </Field>
            <Field label={`Supplier's price (${cur})`} hint="What they want for it"><Input name="supplier_price" inputMode="decimal" /></Field>
            <Field label={`Your asking price (${cur})`} hint="What you advertise it for"><Input name="advert_price" inputMode="decimal" /></Field>
            <Field label="Where it is" className="sm:col-span-2"><Input name="location" placeholder="Supplier's yard, Midrand" /></Field>
            <Field label="Advert description" className="sm:col-span-2"><Textarea name="advert_description" rows={3} /></Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="publish" defaultChecked className="size-4 accent-jade-700" /> Advertise it on my feeds now (needs an asking price)
            </label>
            <div className="sm:col-span-2"><SubmitButton pendingText="Listing…">List the car</SubmitButton></div>
            <p className="text-[13px] text-ink-faint sm:col-span-2">Next you add the photos and the registration document on the car&apos;s page.</p>
          </form>
        </Panel>
      )}
    </div>
  );
}
