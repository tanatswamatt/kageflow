export const BANKS = ["WesBank", "Standard Bank VAF", "Absa Vehicle Finance", "MFC (Nedbank)", "Toyota Financial Services", "VW Financial Services", "Mercedes-Benz Financial Services", "BMW Financial Services", "Other"] as const;

export type FinanceStatus = "draft" | "submitted" | "approved" | "declined" | "contracted" | "paid_out" | "cancelled";
export type SubmissionStatus = "submitted" | "approved" | "counter_offer" | "declined" | "contracted" | "paid_out" | "withdrawn";

export const FINANCE_TONE: Record<string, "neutral" | "shadow" | "jade" | "amber" | "ember"> = {
  draft: "neutral", submitted: "shadow", approved: "jade", counter_offer: "amber", declined: "ember", contracted: "jade", paid_out: "jade", cancelled: "neutral", withdrawn: "neutral",
};
export const FINANCE_LABEL: Record<string, string> = {
  draft: "Draft", submitted: "Waiting on banks", approved: "Approved", counter_offer: "Counter-offer", declined: "Declined", contracted: "Contract signed", paid_out: "Paid out", cancelled: "Cancelled", withdrawn: "Withdrawn",
};

/** Documents the banks ask for */
export const FINANCE_DOCS: [string, string][] = [
  ["id", "Copy of ID"],
  ["licence", "Driver's licence"],
  ["payslips", "3 months' payslips"],
  ["statements", "3 months' bank statements"],
  ["address", "Proof of address"],
  ["consent", "Signed credit check consent"],
];

export type FinanceApplication = {
  id: string; number: string | null; account_id: string; order_id: string | null; deal_id: string | null; unit_id: string | null; status: FinanceStatus;
  first_name: string | null; last_name: string | null; id_number: string | null; email: string | null; phone: string | null;
  marital_status: string | null; dependants: number | null; address: string | null; residential_status: string | null; years_at_address: number | null;
  employer: string | null; occupation: string | null; employment_type: string | null; employed_since: string | null;
  gross_income: number | null; net_income: number | null; other_income: number | null; expenses: number | null;
  purchase_price: number | null; deposit: number; trade_in_credit: number; extras: number; term_months: number | null; balloon_pct: number; est_rate: number | null;
  documents: Record<string, boolean>; consent_at: string | null; consent_text: string | null; notes: string | null; created_at: string; updated_at: string;
};

export type FinanceSubmission = {
  id: string; application_id: string; bank: string; reference: string | null; status: SubmissionStatus; submitted_at: string; decided_at: string | null;
  approved_amount: number | null; rate: number | null; term_months: number | null; balloon_amount: number | null; instalment: number | null;
  conditions: string | null; dic_amount: number | null; payout_amount: number | null; payout_date: string | null; payment_id: string | null;
};

export type TradeIn = {
  id: string; number: string | null; account_id: string; order_id: string | null; deal_id: string | null; status: "draft" | "accepted" | "cancelled";
  vin: string | null; make: string | null; model: string | null; variant: string | null; year: number | null; mileage_km: number | null; colour: string | null;
  registration: string | null; condition_notes: string | null; valuation: number | null; allowance: number | null; settlement_amount: number;
  settlement_bank: string | null; settlement_ref: string | null; seller_is_vendor: boolean; unit_id: string | null; payment_id: string | null;
  journal_id: string | null; accepted_at: string | null; created_at: string;
};

export function amountToFinance(a: Pick<FinanceApplication, "purchase_price" | "deposit" | "trade_in_credit" | "extras">): number {
  return Math.max(0, Number(a.purchase_price ?? 0) + Number(a.extras ?? 0) - Number(a.deposit ?? 0) - Number(a.trade_in_credit ?? 0));
}

/** Monthly instalment with an optional balloon (residual) at the end */
export function instalment(principal: number, annualRatePct: number, months: number, balloon = 0, monthlyFee = 0): number {
  if (principal <= 0 || months <= 0) return 0;
  const r = annualRatePct / 1200;
  const pmt = r === 0 ? (principal - balloon) / months : ((principal - balloon / Math.pow(1 + r, months)) * r) / (1 - Math.pow(1 + r, -months));
  return Math.round((pmt + monthlyFee) * 100) / 100;
}
