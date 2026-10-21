"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass } from "@/components/ui";
import { COST_KINDS, type BillLineKind, type DraftLine } from "@/lib/purchases";

export type Option = { id: string; label: string; sub?: string };
export type EditorTax = { id: string; name: string; rate: number; code: string };
export type StockOption = Option & { tax_rate_id: string | null; avg_cost: number };

type Line = {
  key: number;
  kind: BillLineKind;
  account_id: string;
  product_id: string;
  unit_id: string;
  cost_kind: string;
  description: string;
  quantity: string;
  unit_price: string;
  tax_rate_id: string;
  vat: string;
};

type Initial = {
  id?: string;
  supplier_id: string | null;
  supplier_ref: string | null;
  bill_date: string;
  due_date: string | null;
  currency: string;
  fx_rate: number;
  paid_from_account_id: string | null;
  notes: string | null;
  lines: DraftLine[];
};

const fmt = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const num = (v: string) => {
  const n = Number(v.replace(/[\s,]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
let seq = 1;

const control = "h-10 w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-sm focus:border-shadow-700 focus:outline-none focus:ring-2 focus:ring-shadow-100";
const small = "text-xs font-medium text-ink-soft";

export function BillEditor({
  mode,
  initial,
  suppliers,
  accounts,
  banks,
  stock,
  vehicles,
  taxes,
  baseCurrency,
  vatVendor,
  action,
}: {
  mode: "bill" | "expense";
  initial: Initial;
  suppliers: Option[];
  accounts: Option[];
  banks: Option[];
  stock: StockOption[];
  vehicles: Option[];
  taxes: EditorTax[];
  baseCurrency: string;
  vatVendor: boolean;
  action: (prev: { error?: string } | null, fd: FormData) => Promise<{ error?: string }>;
}) {
  const [state, formAction] = useActionState(action, null);
  const std = taxes.find((t) => t.code === "STD")?.id ?? taxes[0]?.id ?? "";
  const blank = (): Line => ({ key: seq++, kind: "account", account_id: "", product_id: "", unit_id: "", cost_kind: "transport", description: "", quantity: "1", unit_price: "", tax_rate_id: vatVendor ? std : (taxes.find((t) => t.code === "NONE")?.id ?? std), vat: "" });
  const [lines, setLines] = useState<Line[]>(() =>
    initial.lines.length
      ? initial.lines.map((l) => ({ ...blank(), ...l, kind: l.kind, account_id: l.account_id ?? "", product_id: l.product_id ?? "", unit_id: l.unit_id ?? "", cost_kind: l.cost_kind ?? "transport", tax_rate_id: l.tax_rate_id ?? "", vat: l.vat ?? "" }))
      : [blank()],
  );
  const [supplierId, setSupplierId] = useState(initial.supplier_id ?? "");
  const [newSupplier, setNewSupplier] = useState(false);
  const [query, setQuery] = useState("");
  const [currency, setCurrency] = useState(initial.currency);
  const [inclusive, setInclusive] = useState(mode === "expense" && initial.lines.length === 0);
  const [more, setMore] = useState(initial.currency !== baseCurrency || !!initial.notes);
  const taxById = useMemo(() => new Map(taxes.map((t) => [t.id, t])), [taxes]);

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // What gets saved: prices excluding VAT. When typed including VAT, split here.
  const computed = lines.map((l) => {
    const rate = taxById.get(l.tax_rate_id)?.rate ?? 0;
    const q = num(l.quantity || "1") || 1;
    const typed = num(l.unit_price);
    const override = l.vat.trim() !== "" ? r2(num(l.vat)) : null;
    if (inclusive) {
      const gross = r2(q * typed);
      const vat = override ?? r2(gross - gross / (1 + rate));
      const net = r2(gross - vat);
      return { net, vat, gross, unitNet: q ? net / q : 0 };
    }
    const net = r2(q * typed);
    const vat = override ?? r2(net * rate);
    return { net, vat, gross: r2(net + vat), unitNet: typed };
  });
  const totals = computed.reduce((s, c) => ({ net: s.net + c.net, vat: s.vat + c.vat }), { net: 0, vat: 0 });

  const payload = JSON.stringify(
    lines.map((l, i) => {
      const c = computed[i]!;
      const out: DraftLine = {
        kind: l.kind,
        account_id: l.account_id,
        product_id: l.product_id,
        unit_id: l.unit_id,
        cost_kind: l.cost_kind,
        description: l.description,
        quantity: l.quantity || "1",
        unit_price: inclusive ? String(Math.round(c.unitNet * 10000) / 10000) : l.unit_price,
        tax_rate_id: l.tax_rate_id,
      };
      if (inclusive || l.vat.trim() !== "") out.vat = String(c.vat);
      return out;
    }),
  );

  const matches = suppliers.filter((s) => !query.trim() || s.label.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8);
  const selected = suppliers.find((s) => s.id === supplierId);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="lines" value={payload} />
      {state?.error && <div role="alert" className="rounded-[var(--radius-control)] border border-ember-700/25 bg-ember-50 px-4 py-2.5 text-ember-700">{state.error}</div>}

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 sm:p-5">
        <h2 className="mb-3 text-[15px] font-semibold">Supplier</h2>
        {newSupplier ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1"><span className={small}>Supplier name</span><input name="new_supplier_name" defaultValue={query} required className={control} autoFocus /></label>
            <label className="flex flex-col gap-1"><span className={small}>Their VAT number (optional)</span><input name="new_supplier_vat" className={control} /></label>
            <button type="button" onClick={() => setNewSupplier(false)} className="justify-self-start text-[13px] font-medium text-shadow-700 hover:underline">Pick an existing supplier instead</button>
          </div>
        ) : selected ? (
          <div className="flex items-center justify-between gap-3">
            <input type="hidden" name="supplier_id" value={selected.id} />
            <div className="font-medium">{selected.label}{selected.sub && <span className="ml-2 text-[13px] font-normal text-ink-faint">{selected.sub}</span>}</div>
            <button type="button" onClick={() => setSupplierId("")} className={buttonClass("quiet", "sm")}>Change</button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search suppliers" aria-label="Search suppliers" className={control} />
            <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-control)] border border-line">
              {matches.map((s) => (
                <li key={s.id}><button type="button" onClick={() => setSupplierId(s.id)} className="w-full px-3 py-2 text-left hover:bg-paper"><span className="font-medium">{s.label}</span>{s.sub && <span className="ml-2 text-xs text-ink-faint">{s.sub}</span>}</button></li>
              ))}
              <li><button type="button" onClick={() => setNewSupplier(true)} className="w-full px-3 py-2 text-left font-medium text-shadow-700 hover:bg-paper">+ New supplier{query.trim() ? `: ${query.trim()}` : ""}</button></li>
            </ul>
          </div>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1"><span className={small}>{mode === "expense" ? "Slip or reference (optional)" : "Their invoice number"}</span><input name="supplier_ref" defaultValue={initial.supplier_ref ?? ""} className={control} /></label>
          <label className="flex flex-col gap-1"><span className={small}>{mode === "expense" ? "Date paid" : "Invoice date"}</span><input type="date" name="bill_date" defaultValue={initial.bill_date} required className={control} /></label>
          {mode === "expense" ? (
            <label className="flex flex-col gap-1"><span className={small}>Paid from</span>
              <select name="paid_from" defaultValue={initial.paid_from_account_id ?? banks[0]?.id ?? ""} required className={control}>
                {banks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </select>
            </label>
          ) : (
            <label className="flex flex-col gap-1"><span className={small}>Due date (blank = 30 days)</span><input type="date" name="due_date" defaultValue={initial.due_date ?? ""} className={control} /></label>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold">What was bought</h2>
          {vatVendor && (
            <label className="flex items-center gap-2 text-[13px] text-ink-soft">
              <input type="checkbox" checked={inclusive} onChange={(e) => setInclusive(e.target.checked)} className="accent-jade-700" />
              Amounts include VAT
            </label>
          )}
        </div>
        {lines.map((l, i) => {
          const c = computed[i]!;
          return (
            <div key={l.key} className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
              <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                <label className="flex flex-col gap-1"><span className={small}>Type</span>
                  <select value={l.kind} onChange={(e) => update(l.key, { kind: e.target.value as BillLineKind })} className={control} aria-label={`Line ${i + 1} type`}>
                    <option value="account">Expense or asset</option>
                    <option value="stock">Stock item</option>
                    <option value="vehicle">Cost on a vehicle</option>
                  </select>
                </label>
                {l.kind === "account" && (
                  <label className="flex flex-col gap-1"><span className={small}>Account</span>
                    <select value={l.account_id} onChange={(e) => update(l.key, { account_id: e.target.value, description: l.description || (accounts.find((a) => a.id === e.target.value)?.label.replace(/^\S+\s+/, "") ?? "") })} className={control} aria-label={`Line ${i + 1} account`}>
                      <option value="">Choose…</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                    </select>
                  </label>
                )}
                {l.kind === "stock" && (
                  <label className="flex flex-col gap-1"><span className={small}>Stock item</span>
                    <select value={l.product_id} onChange={(e) => { const p = stock.find((s) => s.id === e.target.value); update(l.key, { product_id: e.target.value, description: l.description || p?.label || "", unit_price: l.unit_price || (p?.avg_cost ? String(p.avg_cost) : ""), tax_rate_id: p?.tax_rate_id ?? l.tax_rate_id }); }} className={control} aria-label={`Line ${i + 1} stock item`}>
                      <option value="">Choose…</option>
                      {stock.map((s) => <option key={s.id} value={s.id}>{s.label}{s.sub ? ` (${s.sub})` : ""}</option>)}
                    </select>
                    {stock.length === 0 && <span className="text-xs text-ink-faint">No counted stock items yet. Add one under Stock, Products.</span>}
                  </label>
                )}
                {l.kind === "vehicle" && (
                  <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
                    <label className="flex flex-col gap-1"><span className={small}>Vehicle</span>
                      <select value={l.unit_id} onChange={(e) => update(l.key, { unit_id: e.target.value, description: l.description || `${COST_KINDS.find((k) => k[0] === l.cost_kind)?.[1] ?? "Cost"}: ${vehicles.find((v) => v.id === e.target.value)?.label ?? ""}` })} className={control} aria-label={`Line ${i + 1} vehicle`}>
                        <option value="">Choose…</option>
                        {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1"><span className={small}>Cost type</span>
                      <select value={l.cost_kind} onChange={(e) => update(l.key, { cost_kind: e.target.value })} className={control}>
                        {COST_KINDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                      </select>
                    </label>
                  </div>
                )}
              </div>
              <label className="mt-3 flex flex-col gap-1"><span className={small}>Description</span>
                <input value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} className={control} aria-label={`Line ${i + 1} description`} />
              </label>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-[90px_1fr_1fr_1fr_auto] sm:items-end">
                <label className="flex flex-col gap-1"><span className={small}>Qty</span><input inputMode="decimal" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} className={`${control} text-right tabular-nums`} /></label>
                <label className="flex flex-col gap-1"><span className={small}>{inclusive ? "Price incl. VAT" : "Price excl. VAT"} ({currency})</span><input inputMode="decimal" value={l.unit_price} onChange={(e) => update(l.key, { unit_price: e.target.value })} className={`${control} text-right tabular-nums`} placeholder="0.00" /></label>
                <label className="flex flex-col gap-1"><span className={small}>VAT rate</span>
                  <select value={l.tax_rate_id} onChange={(e) => update(l.key, { tax_rate_id: e.target.value, vat: "" })} className={control}>
                    {taxes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1"><span className={small}>VAT amount</span><input inputMode="decimal" value={l.vat} onChange={(e) => update(l.key, { vat: e.target.value })} placeholder={fmt(c.vat)} className={`${control} text-right tabular-nums`} title="Leave blank to work it out. Type the amount on the slip if it differs by a few cents." /></label>
                <div className="col-span-2 flex items-center justify-between gap-3 sm:col-span-1 sm:h-10 sm:justify-end">
                  <span className="text-sm font-semibold tabular-nums">{fmt(c.gross)}</span>
                  <button type="button" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [blank()]))} className="rounded px-2 py-1 text-[13px] text-ink-faint hover:bg-ember-50 hover:text-ember-700" aria-label={`Remove line ${i + 1}`}>Remove</button>
                </div>
              </div>
            </div>
          );
        })}
        <button type="button" onClick={() => setLines((ls) => [...ls, blank()])} className="self-start text-[13px] font-medium text-shadow-700 hover:underline">+ Add a line</button>
        {!vatVendor && <p className="text-[13px] text-ink-faint">Your company has no VAT number, so VAT on purchases is added to the cost and not claimed.</p>}
      </section>

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 sm:p-5">
        <button type="button" onClick={() => setMore((m) => !m)} className="text-[13px] font-medium text-shadow-700 hover:underline">{more ? "Hide" : "Show"} currency and notes</button>
        <div className={more ? "mt-4 grid gap-3 sm:grid-cols-3" : "hidden"}>
          <label className="flex flex-col gap-1"><span className={small}>Currency</span><input name="currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} className={`${control} uppercase`} /></label>
          {currency !== baseCurrency && <label className="flex flex-col gap-1"><span className={small}>Rate: {baseCurrency} per 1 {currency}</span><input name="fx_rate" inputMode="decimal" defaultValue={initial.fx_rate !== 1 ? String(initial.fx_rate) : ""} className={`${control} text-right`} /></label>}
          <label className="flex flex-col gap-1 sm:col-span-3"><span className={small}>Notes</span><textarea name="notes" defaultValue={initial.notes ?? ""} rows={2} className={`${control} h-auto py-2`} /></label>
        </div>
        {!more && <input type="hidden" name="currency" value={currency} />}
      </section>

      <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-paper/95 px-1 py-3 backdrop-blur">
        <span className="mr-auto text-sm text-ink-soft">
          VAT {fmt(totals.vat)} · Total <strong className="font-semibold text-ink tabular-nums">{currency} {fmt(totals.net + totals.vat)}</strong>
        </span>
        <Buttons primary={mode === "expense" ? "Record expense" : "Post bill"} />
      </div>
    </form>
  );
}

function Buttons({ primary }: { primary: string }) {
  const { pending, data } = useFormStatus();
  const intent = data?.get("intent");
  return (
    <>
      <button type="submit" name="intent" value="draft" disabled={pending} className={buttonClass("secondary")}>{pending && intent === "draft" ? "Saving…" : "Save draft"}</button>
      <button type="submit" name="intent" value="post" disabled={pending} className={buttonClass("primary")}>{pending && intent === "post" ? "Posting…" : primary}</button>
    </>
  );
}
