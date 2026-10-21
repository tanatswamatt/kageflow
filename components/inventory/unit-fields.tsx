import { Field, Input, Select, Textarea } from "@/components/ui";
import { label } from "@/lib/format";
import { CURRENCIES, MANUAL_UNIT_STATUSES, type Unit } from "@/lib/types";

export function UnitFields({ unit, products, suppliers, base }: { unit?: Unit; products: { id: string; name: string }[]; suppliers: { id: string; name: string }[]; base: string }) {
  const locked = unit && (unit.status === "sold" || unit.status === "reserved" || unit.status === "written_off");
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label="VIN or serial number" hint={unit && !unit.vin_confirmed ? "Imported from the website without a VIN. Add it before invoicing." : undefined} className="sm:col-span-2">
        <Input name="serial_no" required={!unit || unit.vin_confirmed} defaultValue={unit && !unit.vin_confirmed ? "" : (unit?.serial_no ?? "")} placeholder={unit && !unit.vin_confirmed ? "Enter the 17-character VIN" : undefined} className="font-mono uppercase" readOnly={unit?.status === "sold"} />
      </Field>
      <Field label="Product">
        <Select name="product_id" defaultValue={unit?.product_id ?? products[0]?.id ?? ""}>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </Field>
      <Field label="Make"><Input name="make" defaultValue={unit?.make ?? ""} placeholder="Toyota" /></Field>
      <Field label="Model"><Input name="model" defaultValue={unit?.model ?? ""} placeholder="Land Cruiser 79" /></Field>
      <Field label="Variant"><Input name="variant" defaultValue={unit?.variant ?? ""} placeholder="4.5 V8 D/C" /></Field>
      <Field label="Year"><Input name="year" inputMode="numeric" defaultValue={unit?.year ?? ""} /></Field>
      <Field label="Colour"><Input name="colour" defaultValue={unit?.colour ?? ""} /></Field>
      <Field label="Mileage (km)"><Input name="mileage_km" inputMode="numeric" defaultValue={unit?.mileage_km ?? ""} /></Field>
      <Field label="Engine number"><Input name="engine_no" defaultValue={unit?.engine_no ?? ""} /></Field>
      <Field label="Location"><Input name="location" defaultValue={unit?.location ?? ""} placeholder="Durban yard" /></Field>
      <Field label="Status">
        {locked ? (
          <Input value={label(unit!.status)} readOnly disabled />
        ) : (
          <Select name="status" defaultValue={unit?.status ?? "in_stock"}>
            {MANUAL_UNIT_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </Select>
        )}
      </Field>
      <Field label="Asking price"><Input name="list_price" inputMode="decimal" defaultValue={unit?.list_price ?? ""} /></Field>
      <Field label="Price currency">
        <Select name="list_currency" defaultValue={unit?.list_currency ?? base}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>
      </Field>
      <Field label="Acquired on"><Input name="acquired_on" type="date" defaultValue={unit?.acquired_on ?? ""} /></Field>
      <Field label="Bought from" className="sm:col-span-2">
        <Select name="supplier_account_id" defaultValue={unit?.supplier_account_id ?? ""}>
          <option value="">Not recorded</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </Field>
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input type="checkbox" name="is_second_hand" defaultChecked={unit ? unit.is_second_hand : true} className="size-4 accent-jade-700" />
        Second-hand (printed on invoices)
      </label>
      <Field label="Notes" className="sm:col-span-3"><Textarea name="notes" rows={2} defaultValue={unit?.notes ?? ""} /></Field>
    </div>
  );
}
