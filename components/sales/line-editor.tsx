"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass } from "@/components/ui";

export type EditorProduct = { id: string; sku: string; name: string; tracking: "serial" | "none"; sale_price: number | null; tax_rate_id: string | null };
export type EditorUnit = { id: string; product_id: string | null; label: string; list_price: number | null; list_currency: string; status: string };
export type EditorTax = { id: string; name: string; rate: number; is_zero_rated: boolean };
export type EditorLine = { product_id: string; unit_id: string; description: string; quantity: string; unit_price: string; discount_pct: string; tax_rate_id: string };

type Row = EditorLine & { key: number };

const toCents = (v: string) => {
  const n = Number(v.replace(/[\s,]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const fmt = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const round2 = (n: number) => Math.round(n * 100) / 100;

let nextKey = 1000;

export function LineEditor({
  docId,
  currency,
  initial,
  products,
  units,
  taxes,
  defaultTaxId,
  action,
}: {
  docId: string;
  currency: string;
  initial: EditorLine[];
  products: EditorProduct[];
  units: EditorUnit[];
  taxes: EditorTax[];
  defaultTaxId: string;
  action: (fd: FormData) => Promise<void>;
}) {
  const blank = (): Row => ({ key: nextKey++, product_id: "", unit_id: "", description: "", quantity: "1", unit_price: "", discount_pct: "", tax_rate_id: defaultTaxId });
  const [rows, setRows] = useState<Row[]>(() => (initial.length ? initial.map((l, i) => ({ ...l, key: i + 1 })) : [blank()]));
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const taxById = useMemo(() => new Map(taxes.map((t) => [t.id, t])), [taxes]);
  const usedUnits = new Set(rows.map((r) => r.unit_id).filter(Boolean));

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const pickProduct = (r: Row, productId: string) => {
    const p = productById.get(productId);
    update(r.key, {
      product_id: productId,
      unit_id: "",
      description: p && p.tracking === "none" ? (r.description || p.name) : r.description,
      unit_price: p?.sale_price != null && !r.unit_price ? String(p.sale_price) : r.unit_price,
      tax_rate_id: p?.tax_rate_id ?? r.tax_rate_id,
    });
  };
  const pickUnit = (r: Row, unitId: string) => {
    const u = units.find((x) => x.id === unitId);
    update(r.key, {
      unit_id: unitId,
      quantity: "1",
      description: u ? u.label : r.description,
      unit_price: u?.list_price != null && u.list_currency === currency && !r.unit_price ? String(u.list_price) : r.unit_price,
    });
  };

  const computed = rows.map((r) => {
    const sub = round2(toCents(r.quantity || "0") * toCents(r.unit_price || "0") * (1 - toCents(r.discount_pct || "0") / 100));
    const tax = round2(sub * (taxById.get(r.tax_rate_id)?.rate ?? 0));
    return { sub, tax };
  });
  const subtotal = computed.reduce((s, c) => s + c.sub, 0);
  const vat = computed.reduce((s, c) => s + c.tax, 0);

  const cell = "h-9 w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-2 text-sm focus:border-shadow-700 focus:outline-none focus:ring-2 focus:ring-shadow-100";
  const payload = JSON.stringify(rows.map(({ key: _k, ...rest }) => rest));

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={docId} />
      <input type="hidden" name="lines" value={payload} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-faint">
              <th className="w-44 pb-2 font-medium">Item</th>
              <th className="pb-2 font-medium">Description</th>
              <th className="w-20 pb-2 text-right font-medium">Qty</th>
              <th className="w-32 pb-2 text-right font-medium">Price ({currency})</th>
              <th className="w-20 pb-2 text-right font-medium">Disc. %</th>
              <th className="w-40 pb-2 font-medium">VAT</th>
              <th className="w-32 pb-2 text-right font-medium">Amount</th>
              <th className="w-8 pb-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const p = productById.get(r.product_id);
              const serial = p?.tracking === "serial";
              return (
                <tr key={r.key} className="align-top">
                  <td className="py-1 pr-2">
                    <select aria-label={`Line ${i + 1} item`} value={r.product_id} onChange={(e) => pickProduct(r, e.target.value)} className={cell}>
                      <option value="">Free text</option>
                      {products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                    {serial && (
                      <select aria-label={`Line ${i + 1} vehicle`} value={r.unit_id} onChange={(e) => pickUnit(r, e.target.value)} className={`${cell} mt-1`}>
                        <option value="">Choose VIN</option>
                        {units
                          .filter((u) => (!u.product_id || u.product_id === r.product_id) && (u.id === r.unit_id || !usedUnits.has(u.id)))
                          .map((u) => <option key={u.id} value={u.id}>{u.label}{u.status === "reserved" ? " (reserved)" : ""}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="py-1 pr-2">
                    <textarea aria-label={`Line ${i + 1} description`} rows={serial ? 2 : 1} value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} className={`${cell} h-auto min-h-9 py-1.5`} />
                  </td>
                  <td className="py-1 pr-2">
                    <input aria-label={`Line ${i + 1} quantity`} inputMode="decimal" value={r.quantity} disabled={!!r.unit_id} onChange={(e) => update(r.key, { quantity: e.target.value })} className={`${cell} text-right tabular-nums disabled:bg-paper`} />
                  </td>
                  <td className="py-1 pr-2">
                    <input aria-label={`Line ${i + 1} price`} inputMode="decimal" value={r.unit_price} onChange={(e) => update(r.key, { unit_price: e.target.value })} className={`${cell} text-right tabular-nums`} />
                  </td>
                  <td className="py-1 pr-2">
                    <input aria-label={`Line ${i + 1} discount`} inputMode="decimal" value={r.discount_pct} onChange={(e) => update(r.key, { discount_pct: e.target.value })} className={`${cell} text-right tabular-nums`} />
                  </td>
                  <td className="py-1 pr-2">
                    <select aria-label={`Line ${i + 1} VAT`} value={r.tax_rate_id} onChange={(e) => update(r.key, { tax_rate_id: e.target.value })} className={cell}>
                      {taxes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </td>
                  <td className="py-1 pr-2 pt-3 text-right tabular-nums">{fmt(computed[i]!.sub)}</td>
                  <td className="py-1 text-right">
                    <button type="button" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [blank()]))} className="rounded px-2 py-1.5 text-ink-faint hover:bg-ember-50 hover:text-ember-700" aria-label={`Remove line ${i + 1}`}>
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4 border-t border-line pt-4">
        <button type="button" onClick={() => setRows((rs) => [...rs, blank()])} className="text-[13px] font-medium text-shadow-700 hover:underline">
          Add line
        </button>
        <dl className="grid min-w-64 grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm tabular-nums">
          <dt className="text-ink-soft">Subtotal</dt><dd className="text-right">{fmt(subtotal)}</dd>
          <dt className="text-ink-soft">VAT</dt><dd className="text-right">{fmt(vat)}</dd>
          <dt className="font-semibold">Total ({currency})</dt><dd className="text-right font-semibold">{fmt(subtotal + vat)}</dd>
        </dl>
      </div>
      <div><Save /></div>
    </form>
  );
}

function Save() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass("primary")}>
      {pending ? "Saving…" : "Save lines"}
    </button>
  );
}
