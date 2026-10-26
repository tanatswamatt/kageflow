export type ObjectEvent = {
  subject_type: "vehicle" | "customer";
  subject_id: string;
  at: string;
  kind: string;
  title: string;
  detail: string | null;
  amount: number | null;
  currency: string | null;
  ref_type: string | null;
  ref_id: string | null;
};

export const EVENT_KINDS: Record<string, { label: string; dot: string }> = {
  stock: { label: "Stock", dot: "bg-shadow-700" },
  cost: { label: "Costs", dot: "bg-amber-700" },
  advert: { label: "Adverts", dot: "bg-jade-600" },
  lead: { label: "Enquiries", dot: "bg-[#7c3aed]" },
  message: { label: "WhatsApp", dot: "bg-[#16a34a]" },
  deal: { label: "Deals", dot: "bg-[#2563eb]" },
  activity: { label: "Calls and notes", dot: "bg-ink-faint" },
  sale: { label: "Sales", dot: "bg-jade-700" },
  payment: { label: "Money", dot: "bg-jade-600" },
  finance: { label: "Finance", dot: "bg-[#0891b2]" },
  purchase: { label: "Bills", dot: "bg-amber-700" },
  check: { label: "Stock checks", dot: "bg-shadow-300" },
  crm: { label: "Customer", dot: "bg-shadow-300" },
};

/** Where each kind of linked record lives in the app */
export function refHref(type: string | null, id: string | null): string | null {
  if (!type || !id) return null;
  const routes: Record<string, string> = {
    vehicle: "/inventory/units/", customer: "/crm/accounts/", contact: "/crm/contacts/", lead: "/crm/leads/", deal: "/crm/deals/",
    sales_doc: "/sales/doc/", payment: "/sales/payments/", finance_application: "/sales/finance/", trade_in: "/sales/trade-ins/",
    bill: "/purchases/bills/", journal: "/accounting/journals/", stock_check: "/inventory/stock-check/",
  };
  return routes[type] ? `${routes[type]}${id}` : null;
}

export const OBJECT_LABEL: Record<string, string> = {
  vehicle: "Vehicle", customer: "Customer", contact: "Contact", lead: "Lead", deal: "Deal", sales_doc: "Document",
  bill: "Bill", finance_application: "Finance", trade_in: "Trade-in", payment: "Payment",
};
