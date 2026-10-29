import type { DocType } from "@/lib/types";

export type DocumentData = {
  doc: {
    doc_type: DocType;
    number: string | null;
    status: string;
    issue_date: string;
    due_date: string | null;
    valid_until: string | null;
    currency: string;
    fx_rate: number;
    reference: string | null;
    bill_to_name: string | null;
    bill_to_address: string | null;
    bill_to_vat_no: string | null;
    notes: string | null;
    terms: string | null;
    credit_reason: string | null;
    subtotal: number;
    tax_total: number;
    total: number;
    amount_paid: number;
    amount_credited: number;
    amount_due: number;
  };
  lines: { line_no: number; description: string; quantity: number; unit_price: number; discount_pct: number; tax_rate: number; line_subtotal: number; line_tax: number; serial_no: string | null; is_second_hand: boolean | null }[];
  company: { name: string; legal_name: string | null; registration_no: string | null; vat_no: string | null; address: string | null; phone: string | null; email: string | null; bank_details: string | null; invoice_footer: string | null; base_currency: string; country?: string | null };
  customer: { name: string; billing_address: string | null; vat_no: string | null; email: string | null };
  source_number: string | null;
};

const fmt = (n: number | string) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n));
const fmtDate = (v: string | null) => (v ? new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${v}T00:00:00`)) : "");

function heading(d: DocumentData): string {
  switch (d.doc.doc_type) {
    case "invoice":
      // in Zimbabwe the tax invoice is the fiscal invoice from the ZIMRA fiscal device, so this one is not
      return d.company.vat_no && d.company.country !== "ZW" ? "Tax Invoice" : "Invoice";
    case "credit_note":
      return "Credit Note";
    case "quote":
      return "Quotation";
    default:
      return "Sales Order";
  }
}

/** Printable document: supplier and recipient details, serial number, date, description, VAT shown separately, base-currency equivalents for foreign currency (SARS rules in South Africa) */
export function DocumentView({ data }: { data: DocumentData }) {
  const { doc, lines, company: c } = data;
  const isIssued = doc.status !== "draft";
  const base = c.base_currency;
  const foreign = doc.currency !== base;
  const rate = Number(doc.fx_rate);
  const name = doc.bill_to_name ?? data.customer.name;
  const address = doc.bill_to_name ? doc.bill_to_address : data.customer.billing_address;
  const vat = doc.bill_to_name ? doc.bill_to_vat_no : data.customer.vat_no;
  const anySecondHand = lines.some((l) => l.is_second_hand);
  const notFiscal = c.country === "ZW" && !!c.vat_no && doc.doc_type === "invoice";

  return (
    <article className="relative mx-auto max-w-[820px] bg-white p-8 text-[13px] leading-relaxed text-[#1a1d2e] sm:p-12 print:max-w-none print:p-0">
      {!isIssued && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <span className="-rotate-12 text-[120px] font-bold tracking-widest text-[#1a1d2e]/[0.06]">DRAFT</span>
        </div>
      )}
      <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-[#1e2346] pb-6">
        <div className="max-w-xs">
          <div className="text-[20px] font-semibold">{c.name}</div>
          {c.legal_name && c.legal_name !== c.name && <div>{c.legal_name}</div>}
          {c.address && <div className="whitespace-pre-line text-[#4a4f66]">{c.address}</div>}
          <div className="mt-1 text-[#4a4f66]">
            {[c.phone, c.email].filter(Boolean).join("  ")}
          </div>
          {c.registration_no && <div className="text-[#4a4f66]">Reg. no. {c.registration_no}</div>}
          {c.vat_no && <div className="font-medium">VAT no. {c.vat_no}</div>}
        </div>
        <div className="text-right">
          <h1 className="text-[26px] font-semibold uppercase tracking-wide text-[#1e2346]">{heading(data)}</h1>
          <dl className="mt-2 grid grid-cols-[auto_auto] justify-end gap-x-4 gap-y-0.5">
            <dt className="text-[#7c8197]">Number</dt><dd className="font-semibold tabular-nums">{doc.number ?? "Draft"}</dd>
            <dt className="text-[#7c8197]">Date</dt><dd>{fmtDate(doc.issue_date)}</dd>
            {doc.doc_type === "invoice" && doc.due_date && (<><dt className="text-[#7c8197]">Due</dt><dd>{fmtDate(doc.due_date)}</dd></>)}
            {doc.doc_type === "quote" && doc.valid_until && (<><dt className="text-[#7c8197]">Valid until</dt><dd>{fmtDate(doc.valid_until)}</dd></>)}
            {doc.reference && (<><dt className="text-[#7c8197]">Your reference</dt><dd>{doc.reference}</dd></>)}
            {doc.doc_type === "credit_note" && data.source_number && (<><dt className="text-[#7c8197]">Against invoice</dt><dd className="font-semibold">{data.source_number}</dd></>)}
          </dl>
        </div>
      </header>

      <section className="mt-6 grid gap-6 sm:grid-cols-2">
        <div>
          <div className="text-[12px] text-[#7c8197]">{doc.doc_type === "quote" ? "Prepared for" : "Bill to"}</div>
          <div className="font-semibold">{name}</div>
          {address && <div className="whitespace-pre-line">{address}</div>}
          {vat && <div>VAT no. {vat}</div>}
        </div>
        {doc.doc_type === "credit_note" && doc.credit_reason && (
          <div>
            <div className="text-[12px] text-[#7c8197]">Reason for credit</div>
            <div>{doc.credit_reason}</div>
          </div>
        )}
      </section>

      <table className="mt-8 w-full border-collapse">
        <thead>
          <tr className="border-b border-[#c9ccd8] text-left text-[12px] text-[#7c8197]">
            <th className="py-2 pr-3 font-medium">Description</th>
            <th className="py-2 pr-3 text-right font-medium">Qty</th>
            <th className="py-2 pr-3 text-right font-medium">Unit price</th>
            <th className="py-2 pr-3 text-right font-medium">VAT</th>
            <th className="py-2 text-right font-medium">Amount ({doc.currency})</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.line_no} className="border-b border-[#e2e4ec] align-top">
              <td className="py-2.5 pr-3 whitespace-pre-line">
                {l.description}
                {Number(l.discount_pct) > 0 && <span className="text-[#7c8197]"> less {Number(l.discount_pct)}%</span>}
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{Number(l.quantity)}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{fmt(l.unit_price)}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{Math.round(Number(l.tax_rate) * 1000) / 10}%</td>
              <td className="py-2.5 text-right tabular-nums">{fmt(l.line_subtotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-6 flex flex-wrap justify-between gap-8">
        <div className="max-w-sm text-[12px] text-[#4a4f66]">
          {anySecondHand && <p>Items marked used are second-hand goods.</p>}
          {foreign && (
            <p className="mt-2">
              {base === "ZAR" ? "Rand" : base} equivalent at {rate} {base} per {doc.currency}: excluding VAT {base} {fmt(Number(doc.subtotal) * rate)}, VAT {base} {fmt(Number(doc.tax_total) * rate)}, total {base} {fmt(Number(doc.total) * rate)}.
            </p>
          )}
        </div>
        <dl className="grid min-w-64 grid-cols-[1fr_auto] gap-x-8 gap-y-1 tabular-nums">
          <dt>Total excluding VAT</dt><dd className="text-right">{fmt(doc.subtotal)}</dd>
          <dt>VAT</dt><dd className="text-right">{fmt(doc.tax_total)}</dd>
          <div className="col-span-2 mt-1 border-t-2 border-[#1e2346]" aria-hidden="true" />
          <dt className="font-semibold">Total {doc.currency}</dt>
          <dd className="text-right font-semibold">{fmt(doc.total)}</dd>
          {doc.doc_type === "invoice" && isIssued && (Number(doc.amount_paid) > 0 || Number(doc.amount_credited) > 0) && (
            <>
              {Number(doc.amount_paid) > 0 && (<><dt className="text-[#4a4f66]">Paid</dt><dd className="text-right text-[#4a4f66]">-{fmt(doc.amount_paid)}</dd></>)}
              {Number(doc.amount_credited) > 0 && (<><dt className="text-[#4a4f66]">Credited</dt><dd className="text-right text-[#4a4f66]">-{fmt(doc.amount_credited)}</dd></>)}
              <dt className="font-semibold">Amount due</dt><dd className="text-right font-semibold">{fmt(doc.amount_due)}</dd>
            </>
          )}
        </dl>
      </section>

      {(doc.notes || doc.terms) && (
        <section className="mt-8 grid gap-4 sm:grid-cols-2">
          {doc.notes && <div><div className="text-[12px] text-[#7c8197]">Notes</div><div className="whitespace-pre-line">{doc.notes}</div></div>}
          {doc.terms && <div><div className="text-[12px] text-[#7c8197]">Terms</div><div className="whitespace-pre-line">{doc.terms}</div></div>}
        </section>
      )}

      {c.bank_details && doc.doc_type !== "credit_note" && (
        <section className="mt-8 rounded-md border border-[#e2e4ec] p-4">
          <div className="text-[12px] text-[#7c8197]">Payment details</div>
          <div className="whitespace-pre-line">{c.bank_details}</div>
          {doc.number && <div className="mt-1">Use <strong>{doc.number}</strong> as your payment reference.</div>}
        </section>
      )}

      {notFiscal && (
        <p className="mt-8 rounded-md border border-[#e2e4ec] p-3 text-[12px] text-[#4a4f66]">
          This is not a fiscal tax invoice. The fiscal tax invoice for this sale is issued from the supplier&apos;s ZIMRA fiscal device.
        </p>
      )}

      {c.invoice_footer && <footer className="mt-8 border-t border-[#e2e4ec] pt-4 text-[12px] whitespace-pre-line text-[#7c8197]">{c.invoice_footer}</footer>}
    </article>
  );
}
