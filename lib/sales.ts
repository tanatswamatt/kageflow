import type { DocType, SalesDoc } from "./types";

export const DOC_SLUGS: Record<string, DocType> = {
  quotes: "quote",
  orders: "order",
  invoices: "invoice",
  "credit-notes": "credit_note",
};

export const DOC_SLUG: Record<DocType, string> = {
  quote: "quotes",
  order: "orders",
  invoice: "invoices",
  credit_note: "credit-notes",
};

export const DOC_LABEL: Record<DocType, { one: string; many: string }> = {
  quote: { one: "Quote", many: "Quotes" },
  order: { one: "Sales order", many: "Sales orders" },
  invoice: { one: "Invoice", many: "Invoices" },
  credit_note: { one: "Credit note", many: "Credit notes" },
};

export function docTitle(d: Pick<SalesDoc, "doc_type" | "number">): string {
  return d.number ?? `Draft ${DOC_LABEL[d.doc_type].one.toLowerCase()}`;
}

/** Status shown to people: invoices show payment state once issued */
export function docStatusLabel(d: Pick<SalesDoc, "doc_type" | "status" | "amount_due" | "due_date" | "total">): { text: string; overdue: boolean } {
  if (d.doc_type === "invoice" && d.status === "issued") {
    if (Number(d.amount_due) <= 0) return { text: "Paid", overdue: false };
    const overdue = !!d.due_date && d.due_date < new Date().toISOString().slice(0, 10);
    if (Number(d.amount_due) < Number(d.total)) return { text: overdue ? "Part paid, overdue" : "Part paid", overdue };
    return { text: overdue ? "Overdue" : "Unpaid", overdue };
  }
  const s = d.status.replace(/_/g, " ");
  return { text: s.charAt(0).toUpperCase() + s.slice(1), overdue: false };
}

export function unitLabel(u: { make: string | null; model: string | null; year: number | null; serial_no: string; is_second_hand?: boolean }): string {
  const name = [u.make, u.model, u.year].filter(Boolean).join(" ");
  return `${name || "Unit"}${u.is_second_hand ? " (used)" : ""}, VIN ${u.serial_no}`;
}

export function daysOverdue(due: string | null, asOf = new Date()): number {
  if (!due) return 0;
  const ms = asOf.getTime() - new Date(`${due}T00:00:00`).getTime();
  return Math.max(0, Math.floor(ms / 864e5));
}
