export type BillStatus = "draft" | "posted" | "void";
export type BillLineKind = "account" | "stock" | "vehicle";

export type Bill = {
  id: string;
  company_id: string;
  number: string | null;
  supplier_id: string;
  supplier_ref: string | null;
  bill_date: string;
  due_date: string | null;
  currency: string;
  fx_rate: number;
  status: BillStatus;
  paid_from_account_id: string | null;
  subtotal: number;
  vat_total: number;
  total: number;
  amount_paid: number;
  amount_due: number;
  notes: string | null;
  draft_lines: DraftLine[];
  journal_id: string | null;
  void_journal_id: string | null;
  void_reason: string | null;
  posted_at: string | null;
  created_at: string;
};

export type DraftLine = {
  kind: BillLineKind;
  account_id?: string;
  product_id?: string;
  unit_id?: string;
  cost_kind?: string;
  description: string;
  quantity: string;
  unit_price: string;
  tax_rate_id?: string;
  vat?: string;
};

export type BillLine = {
  id: string;
  line_no: number;
  kind: BillLineKind;
  account_id: string | null;
  product_id: string | null;
  unit_id: string | null;
  cost_kind: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  line_subtotal: number;
  line_tax: number;
  line_total: number;
};

export type SupplierPayment = {
  id: string;
  number: string | null;
  supplier_id: string;
  payment_date: string;
  currency: string;
  fx_rate: number;
  amount: number;
  bank_charges: number;
  bank_account_id: string;
  reference: string | null;
  journal_id: string | null;
  reversal_journal_id: string | null;
  created_at: string;
};

export function billTitle(b: Pick<Bill, "number" | "paid_from_account_id">): string {
  return b.number ?? (b.paid_from_account_id ? "Draft expense" : "Draft bill");
}

export function billStatus(b: Pick<Bill, "status" | "amount_due" | "amount_paid" | "due_date" | "paid_from_account_id">): { text: string; tone: "neutral" | "jade" | "amber" | "ember" } {
  if (b.status === "draft") return { text: "Draft", tone: "neutral" };
  if (b.status === "void") return { text: "Void", tone: "neutral" };
  if (Number(b.amount_due) <= 0) return { text: b.paid_from_account_id ? "Paid now" : "Paid", tone: "jade" };
  const overdue = b.due_date && b.due_date < new Date().toISOString().slice(0, 10);
  if (overdue) return { text: "Overdue", tone: "ember" };
  return { text: Number(b.amount_paid) > 0 ? "Part paid" : "Unpaid", tone: "amber" };
}

export const COST_KINDS = [
  ["purchase", "Purchase price"],
  ["transport", "Transport"],
  ["clearing", "Clearing and agent fees"],
  ["duty", "Duty"],
  ["repairs", "Repairs and prep"],
  ["other", "Other"],
] as const;
