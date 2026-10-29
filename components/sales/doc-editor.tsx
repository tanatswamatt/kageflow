"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass } from "@/components/ui";

export type CatalogItem = {
  key: string;
  kind: "product" | "unit";
  product_id: string | null;
  unit_id: string | null;
  label: string;
  sublabel: string;
  description: string;
  price: number | null;
  currency: string;
  tax_rate_id: string | null;
  image_url: string | null;
  stock: number | null;
  warning: string | null;
};
export type EditorCustomer = { id: string; name: string; email: string | null; billing_address: string | null };
export type EditorTax = { id: string; name: string; rate: number; is_zero_rated: boolean; code: string };
export type EditorDoc = {
  id?: string;
  doc_type: "quote" | "order" | "invoice" | "credit_note";
  account_id: string | null;
  contact_id?: string | null;
  deal_id?: string | null;
  currency: string;
  fx_rate: number;
  issue_date: string;
  due_date: string | null;
  valid_until: string | null;
  reference: string | null;
  notes: string | null;
  terms: string | null;
  credit_reason: string | null;
  lines: { product_id: string | null; unit_id: string | null; description: string; quantity: number; unit_price: number; tax_rate_id: string }[];
};

type Line = {
  key: number;
  search: string;
  product_id: string;
  unit_id: string;
  description: string;
  quantity: string;
  unit_price: string;
  tax_rate_id: string;
  save_as_product: boolean;
  image_url: string | null;
  warning: string | null;
};

const fmt = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const num = (v: string) => {
  const n = Number(v.replace(/[\s,]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
let keySeq = 1;

const PRIMARY: Record<EditorDoc["doc_type"], string> = {
  invoice: "Issue invoice",
  quote: "Save and mark as sent",
  order: "Confirm order",
  credit_note: "Issue credit note",
};

export function DocEditor({
  doc,
  customers,
  catalog,
  taxes,
  currencies,
  base,
  defaultDays,
  lockCustomer,
  action,
}: {
  doc: EditorDoc;
  customers: EditorCustomer[];
  catalog: CatalogItem[];
  taxes: EditorTax[];
  currencies: string[];
  base: string;
  defaultDays: number;
  lockCustomer?: boolean;
  action: (prev: { error?: string } | null, fd: FormData) => Promise<{ error?: string }>;
}) {
  const [state, formAction] = useActionState(action, null);
  const std = taxes.find((t) => t.code === "STD")?.id ?? taxes[0]?.id ?? "";
  const zero = taxes.find((t) => t.is_zero_rated)?.id;
  const [currency, setCurrency] = useState(doc.currency);
  const defaultTax = currency !== base && zero ? zero : std;

  const blank = (): Line => ({ key: keySeq++, search: "", product_id: "", unit_id: "", description: "", quantity: "1", unit_price: "", tax_rate_id: defaultTax, save_as_product: false, image_url: null, warning: null });
  const [lines, setLines] = useState<Line[]>(() =>
    doc.lines.length
      ? doc.lines.map((l) => {
          const item = catalog.find((c) => (l.unit_id ? c.unit_id === l.unit_id : c.product_id === l.product_id && !c.unit_id));
          return {
            key: keySeq++,
            search: item?.label ?? "",
            product_id: l.product_id ?? "",
            unit_id: l.unit_id ?? "",
            description: l.description,
            quantity: String(Number(l.quantity)),
            unit_price: String(Number(l.unit_price)),
            tax_rate_id: l.tax_rate_id,
            save_as_product: false,
            image_url: item?.image_url ?? null,
            warning: item?.warning ?? null,
          };
        })
      : [blank()],
  );
  const [customerId, setCustomerId] = useState(doc.account_id ?? "");
  const [newCustomer, setNewCustomer] = useState(!doc.account_id && customers.length === 0);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const taxById = useMemo(() => new Map(taxes.map((t) => [t.id, t])), [taxes]);
  const usedUnits = new Set(lines.map((l) => l.unit_id).filter(Boolean));
  const update = (key: number, patch: Partial<Line>) => {
    setDirty(true);
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const pick = (line: Line, item: CatalogItem) =>
    update(line.key, {
      search: item.label,
      product_id: item.product_id ?? "",
      unit_id: item.unit_id ?? "",
      description: item.description,
      quantity: item.unit_id ? "1" : line.quantity || "1",
      unit_price: item.price != null && item.currency === currency ? String(item.price) : line.unit_price,
      tax_rate_id: currency !== base && zero ? zero : (item.tax_rate_id ?? line.tax_rate_id),
      save_as_product: false,
      image_url: item.image_url,
      warning: item.warning,
    });

  const totals = lines.reduce(
    (acc, l) => {
      const sub = round2(num(l.quantity || "0") * num(l.unit_price || "0"));
      const tax = round2(sub * (taxById.get(l.tax_rate_id)?.rate ?? 0));
      return { sub: acc.sub + sub, tax: acc.tax + tax };
    },
    { sub: 0, tax: 0 },
  );

  const payload = JSON.stringify(
    lines.map((l) => ({ product_id: l.product_id, unit_id: l.unit_id, description: l.description || l.search, quantity: l.quantity, unit_price: l.unit_price, tax_rate_id: l.tax_rate_id, save_as_product: l.save_as_product })),
  );
  const isCredit = doc.doc_type === "credit_note";
  const field = "h-10 w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-sm focus:border-shadow-700 focus:outline-none focus:ring-2 focus:ring-shadow-100";

  return (
    <form action={formAction} onSubmit={() => setDirty(false)} className="flex flex-col gap-6">
      {doc.id && <input type="hidden" name="id" value={doc.id} />}
      <input type="hidden" name="doc_type" value={doc.doc_type} />
      {doc.deal_id && <input type="hidden" name="deal_id" value={doc.deal_id} />}
      {doc.contact_id && <input type="hidden" name="contact_id" value={doc.contact_id} />}
      <input type="hidden" name="lines" value={payload} />

      {state?.error && (
        <div role="alert" className="rounded-[var(--radius-control)] border border-ember-700/25 bg-ember-50 px-4 py-2.5 text-ember-700">{state.error}</div>
      )}

      {/* Customer */}
      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <h2 className="mb-3 text-[15px] font-semibold">Customer</h2>
        {lockCustomer ? (
          <>
            <input type="hidden" name="account_id" value={customerId} />
            <p className="font-medium">{customers.find((c) => c.id === customerId)?.name}</p>
          </>
        ) : newCustomer ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="new_customer" value="1" />
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-[13px] font-medium text-ink-soft">Name or company</span>
              <input name="new_customer_name" required autoFocus className={field} onChange={() => setDirty(true)} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-soft">Email</span>
              <input name="new_customer_email" type="email" className={field} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-soft">Phone</span>
              <input name="new_customer_phone" type="tel" className={field} />
            </label>
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-[13px] font-medium text-ink-soft">Billing address</span>
              <textarea name="new_customer_address" rows={2} className={`${field} h-auto py-2`} placeholder="Printed on the invoice" />
            </label>
            {customers.length > 0 && (
              <button type="button" onClick={() => setNewCustomer(false)} className="justify-self-start text-[13px] font-medium text-shadow-700 hover:underline">
                Pick an existing customer instead
              </button>
            )}
          </div>
        ) : (
          <CustomerPicker customers={customers} value={customerId} onChange={(id) => { setCustomerId(id); setDirty(true); }} onNew={() => setNewCustomer(true)} />
        )}
      </section>

      {/* Lines */}
      <section className="rounded-[var(--radius-panel)] border border-line bg-surface">
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-[15px] font-semibold">What you&apos;re {isCredit ? "crediting" : "selling"}</h2>
          <span className="text-[13px] text-ink-faint">Prices in {currency}{currency !== base ? ", usually zero-rated for export" : ", excluding VAT"}</span>
        </header>
        <ol className="divide-y divide-line">
          {lines.map((l, i) => {
            const sub = round2(num(l.quantity || "0") * num(l.unit_price || "0"));
            const isUnit = !!l.unit_id;
            const freeText = !l.product_id && !l.unit_id && l.search.trim().length > 0;
            return (
              <li key={l.key} className="flex flex-col gap-3 px-5 py-4">
                <div className="flex items-start gap-3">
                  {l.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.image_url} alt="" className="mt-0.5 size-10 shrink-0 rounded-md object-cover" />
                  ) : (
                    <span className="mt-2.5 w-6 shrink-0 text-center text-[13px] text-ink-faint tabular-nums">{i + 1}</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <ItemSearch
                      value={l.search}
                      items={catalog.filter((c) => !c.unit_id || c.unit_id === l.unit_id || !usedUnits.has(c.unit_id))}
                      currency={currency}
                      onType={(text) => update(l.key, { search: text, description: text, product_id: "", unit_id: "", image_url: null, warning: null })}
                      onPick={(item) => pick(l, item)}
                      autoFocus={i === lines.length - 1 && lines.length > 1 && !l.search}
                    />
                    {l.warning && <p className="mt-1 text-[13px] text-amber-700">{l.warning}</p>}
                    {freeText && !isCredit && (
                      <label className="mt-2 flex items-center gap-2 text-[13px] text-ink-soft">
                        <input type="checkbox" checked={l.save_as_product} onChange={(e) => update(l.key, { save_as_product: e.target.checked })} className="size-4 accent-jade-700" />
                        Save &ldquo;{l.search.trim().slice(0, 40)}&rdquo; as a product for next time
                      </label>
                    )}
                    {(l.product_id || l.unit_id) && (
                      <textarea
                        aria-label={`Line ${i + 1} description on the document`}
                        rows={isUnit ? 2 : 1}
                        value={l.description}
                        onChange={(e) => update(l.key, { description: e.target.value })}
                        className="mt-2 w-full resize-y rounded-[var(--radius-control)] border border-line bg-paper px-3 py-1.5 text-[13px] text-ink-soft focus:border-shadow-700 focus:outline-none"
                      />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => { setDirty(true); setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [blank()])); }}
                    className="mt-1.5 rounded px-2 py-1 text-ink-faint hover:bg-ember-50 hover:text-ember-700"
                    aria-label={`Remove line ${i + 1}`}
                  >
                    ×
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:ml-[52px] sm:grid-cols-[90px_1fr_1fr_auto] sm:items-end">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-ink-faint">Qty</span>
                    <input inputMode="decimal" value={l.quantity} disabled={isUnit} onChange={(e) => update(l.key, { quantity: e.target.value })} className={`${field} text-right tabular-nums disabled:bg-paper`} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-ink-faint">Price each</span>
                    <input inputMode="decimal" value={l.unit_price} onChange={(e) => update(l.key, { unit_price: e.target.value })} placeholder="0.00" className={`${field} text-right tabular-nums`} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-ink-faint">VAT</span>
                    <select value={l.tax_rate_id} onChange={(e) => update(l.key, { tax_rate_id: e.target.value })} className={field}>
                      {taxes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </label>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xs text-ink-faint">Amount</span>
                    <span className="flex h-10 items-center font-semibold tabular-nums">{fmt(sub)}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap items-start justify-between gap-4 border-t border-line px-5 py-4">
          <button type="button" onClick={() => { setDirty(true); setLines((ls) => [...ls, blank()]); }} className={buttonClass("secondary", "sm")}>
            Add another line
          </button>
          <dl className="grid min-w-60 grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm tabular-nums">
            <dt className="text-ink-soft">Subtotal</dt><dd className="text-right">{fmt(totals.sub)}</dd>
            <dt className="text-ink-soft">VAT</dt><dd className="text-right">{fmt(totals.tax)}</dd>
            <dt className="text-[15px] font-semibold">Total {currency}</dt><dd className="text-right text-[15px] font-semibold">{fmt(totals.sub + totals.tax)}</dd>
          </dl>
        </div>
      </section>

      {isCredit && (
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-soft">Why are you crediting this? (printed on the credit note)</span>
            <input name="credit_reason" required defaultValue={doc.credit_reason ?? ""} className={field} placeholder="Vehicle returned, price adjustment, duplicate charge" />
          </label>
        </section>
      )}

      {/* Optional details */}
      <details className="group rounded-[var(--radius-panel)] border border-line bg-surface" open={currency !== base || !!doc.reference}>
        <summary className="cursor-pointer list-none px-5 py-3 text-[15px] font-semibold">
          Dates, currency and notes <span className="text-[13px] font-normal text-ink-faint group-open:hidden">(optional)</span>
        </summary>
        <div className="grid gap-4 border-t border-line p-5 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-soft">Currency</span>
            <select name="currency" value={currency} disabled={isCredit} onChange={(e) => { setCurrency(e.target.value); setDirty(true); }} className={field}>
              {currencies.map((c) => <option key={c}>{c}</option>)}
            </select>
            {isCredit && <input type="hidden" name="currency" value={currency} />}
          </label>
          {currency !== base ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-soft">Exchange rate: {base} for 1 {currency}</span>
              <input name="fx_rate" inputMode="decimal" required defaultValue={doc.fx_rate !== 1 ? doc.fx_rate : ""} readOnly={isCredit} placeholder="e.g. 18.25" className={field} />
            </label>
          ) : (
            <div />
          )}
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-soft">Date</span>
            <input name="issue_date" type="date" defaultValue={doc.issue_date} className={field} />
          </label>
          {doc.doc_type === "invoice" && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-soft">Due date</span>
              <input name="due_date" type="date" defaultValue={doc.due_date ?? ""} className={field} />
              <span className="text-xs text-ink-faint">Blank uses the customer&apos;s terms or {defaultDays} days</span>
            </label>
          )}
          {doc.doc_type === "quote" && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-soft">Valid until</span>
              <input name="valid_until" type="date" defaultValue={doc.valid_until ?? ""} className={field} />
            </label>
          )}
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-[13px] font-medium text-ink-soft">Customer reference or order number</span>
            <input name="reference" defaultValue={doc.reference ?? ""} className={field} />
          </label>
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-[13px] font-medium text-ink-soft">Notes on the document</span>
            <textarea name="notes" rows={2} defaultValue={doc.notes ?? ""} className={`${field} h-auto py-2`} />
          </label>
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-[13px] font-medium text-ink-soft">Terms</span>
            <textarea name="terms" rows={2} defaultValue={doc.terms ?? ""} placeholder="Payment terms, delivery terms (e.g. FCA Durban)" className={`${field} h-auto py-2`} />
          </label>
        </div>
      </details>

      <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-paper/95 px-1 py-3 backdrop-blur">
        <span className="mr-auto text-sm text-ink-soft">Total <strong className="font-semibold text-ink tabular-nums">{currency} {fmt(totals.sub + totals.tax)}</strong></span>
        <Buttons primary={PRIMARY[doc.doc_type]} />
      </div>
    </form>
  );
}

function Buttons({ primary }: { primary: string }) {
  const { pending, data } = useFormStatus();
  const intent = data?.get("intent");
  return (
    <>
      <button type="submit" name="intent" value="draft" disabled={pending} className={buttonClass("secondary")}>
        {pending && intent === "draft" ? "Saving…" : "Save draft"}
      </button>
      <button type="submit" name="intent" value="primary" disabled={pending} className={buttonClass("primary")}>
        {pending && intent === "primary" ? "Working…" : primary}
      </button>
    </>
  );
}

function CustomerPicker({ customers, value, onChange, onNew }: { customers: EditorCustomer[]; value: string; onChange: (id: string) => void; onNew: () => void }) {
  const selected = customers.find((c) => c.id === value);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(!selected);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? customers.filter((c) => c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q)) : customers).slice(0, 8);
  }, [customers, query]);

  if (selected && !open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input type="hidden" name="account_id" value={selected.id} />
        <div>
          <div className="font-medium">{selected.name}</div>
          <div className="text-[13px] text-ink-soft">{[selected.email, selected.billing_address?.split("\n")[0]].filter(Boolean).join(", ") || "No email or address yet"}</div>
        </div>
        <button type="button" onClick={() => setOpen(true)} className={buttonClass("quiet", "sm")}>Change</button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search customers by name or email"
        className="h-10 w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-sm focus:border-shadow-700 focus:outline-none focus:ring-2 focus:ring-shadow-100"
        aria-label="Search customers"
      />
      <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-control)] border border-line">
        {matches.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => { onChange(c.id); setOpen(false); }} className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-paper">
              <span className="font-medium">{c.name}</span>
              {c.email && <span className="text-xs text-ink-faint">{c.email}</span>}
            </button>
          </li>
        ))}
        <li>
          <button type="button" onClick={onNew} className="w-full px-3 py-2 text-left font-medium text-shadow-700 hover:bg-paper">
            + New customer{query.trim() ? `: ${query.trim()}` : ""}
          </button>
        </li>
      </ul>
    </div>
  );
}

function ItemSearch({ value, items, currency, onType, onPick, autoFocus }: { value: string; items: CatalogItem[]; currency: string; onType: (t: string) => void; onPick: (i: CatalogItem) => void; autoFocus?: boolean }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => {
    const words = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const list = words.length ? items.filter((i) => words.every((w) => `${i.label} ${i.sublabel}`.toLowerCase().includes(w))) : items;
    return list.slice(0, 10);
  }, [items, value]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const choose = (i: CatalogItem) => {
    onPick(i);
    setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <input
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => { onType(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, matches.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === "Enter" && matches[active]) { e.preventDefault(); choose(matches[active]!); }
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Search a vehicle, product or service, or type anything"
        className="h-10 w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-sm font-medium focus:border-shadow-700 focus:outline-none focus:ring-2 focus:ring-shadow-100"
        role="combobox"
        aria-expanded={open}
        aria-label="Item"
        autoComplete="off"
      />
      {open && matches.length > 0 && (
        <ul role="listbox" className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-[var(--radius-control)] border border-line bg-surface py-1 shadow-lg">
          {matches.map((i, idx) => (
            <li key={i.key} role="option" aria-selected={idx === active}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
                onMouseEnter={() => setActive(idx)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left ${idx === active ? "bg-shadow-100" : ""}`}
              >
                {i.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={i.image_url} alt="" className="size-9 shrink-0 rounded object-cover" />
                ) : (
                  <span className="flex size-9 shrink-0 items-center justify-center rounded bg-paper text-[11px] text-ink-faint">{i.kind === "unit" ? "VIN" : "Item"}</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{i.label}</span>
                  <span className="block truncate text-xs text-ink-faint">{i.sublabel}</span>
                </span>
                {i.price != null && (
                  <span className={`shrink-0 text-[13px] tabular-nums ${i.currency === currency ? "" : "text-ink-faint"}`}>
                    {i.currency} {fmt(i.price)}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
