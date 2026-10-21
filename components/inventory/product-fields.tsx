import { Field, Input, Select, Textarea } from "@/components/ui";
import { CURRENCIES, type Product, type TaxRate } from "@/lib/types";

export function ProductFields({ product, taxes, base }: { product?: Product; taxes: TaxRate[]; base: string }) {
  const lockedTracking = product && product.tracking === "stock" && Number(product.qty_on_hand) !== 0;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Name" className="sm:col-span-2"><Input name="name" required defaultValue={product?.name ?? ""} placeholder="Tow bar kit, Export documentation, Service" /></Field>
      <Field label="How do you keep track of it?" className="sm:col-span-2">
        <Select name="tracking" defaultValue={product?.tracking ?? "stock"} disabled={lockedTracking}>
          <option value="stock">Count it in stock (parts, accessories, tyres)</option>
          <option value="none">Don&apos;t count it (services, fees, labour)</option>
          <option value="serial">One by one, by VIN (vehicles, machinery)</option>
        </Select>
      </Field>
      {lockedTracking && <input type="hidden" name="tracking" value="stock" />}
      <Field label="Selling price (excl. VAT)"><Input name="sale_price" inputMode="decimal" defaultValue={product?.sale_price ?? ""} /></Field>
      <Field label="Currency">
        <Select name="currency" defaultValue={product?.currency ?? base}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>
      </Field>
      <Field label="VAT">
        <Select name="tax_rate_id" defaultValue={product?.tax_rate_id ?? taxes.find((t) => t.code === "STD")?.id}>
          {taxes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      </Field>
      <Field label="Code" hint="Leave blank to create one"><Input name="sku" defaultValue={product?.sku ?? ""} className="uppercase" /></Field>
      <Field label="Sold per" hint="each, litre, metre, hour"><Input name="unit_label" defaultValue={product?.unit_label ?? ""} placeholder="each" /></Field>
      <Field label="Warn me when stock falls to"><Input name="reorder_level" inputMode="decimal" defaultValue={product?.reorder_level ?? ""} /></Field>
      <Field label="Description" className="sm:col-span-2"><Textarea name="description" rows={2} defaultValue={product?.description ?? ""} /></Field>
    </div>
  );
}
