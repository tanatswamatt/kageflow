export type Role = "owner" | "admin" | "accountant" | "sales" | "viewer";
export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";
export type LeadSource = "web_form" | "whatsapp" | "referral" | "manual" | "api" | "event" | "other";
export type LeadStatus = "new" | "contacted" | "qualified" | "disqualified" | "converted";
export type AccountKind = "prospect" | "customer" | "supplier" | "partner";
export type ActivityType = "call" | "meeting" | "email" | "whatsapp" | "task" | "note" | "system";
export type DealStatus = "open" | "won" | "lost";
export type ConsentBasis = "consent" | "contract" | "legitimate_interest" | "not_recorded";

export const LEAD_SOURCES: LeadSource[] = ["web_form", "whatsapp", "referral", "manual", "api", "event", "other"];
export const LEAD_STATUSES: LeadStatus[] = ["new", "contacted", "qualified", "disqualified", "converted"];
export const ACCOUNT_KINDS: AccountKind[] = ["prospect", "customer", "supplier", "partner"];
export const ACTIVITY_TYPES: Exclude<ActivityType, "system">[] = ["call", "meeting", "email", "whatsapp", "task", "note"];
export const CONSENT_BASES: ConsentBasis[] = ["consent", "contract", "legitimate_interest", "not_recorded"];
export const ACCOUNT_TYPES: AccountType[] = ["asset", "liability", "equity", "income", "expense"];
export const ROLES: Role[] = ["owner", "admin", "accountant", "sales", "viewer"];

export type Company = {
  id: string;
  name: string;
  legal_name: string | null;
  registration_no: string | null;
  vat_no: string | null;
  base_currency: string;
  country: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  bank_details: string | null;
  invoice_footer: string | null;
  default_payment_days: number;
};

export type Stage = {
  id: string;
  name: string;
  position: number;
  probability: number;
  is_won: boolean;
  is_lost: boolean;
};

export type CrmAccount = {
  id: string;
  name: string;
  kind: AccountKind;
  industry: string | null;
  country: string | null;
  city: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  vat_no: string | null;
  owner_id: string | null;
  notes: string | null;
  billing_address: string | null;
  payment_days: number | null;
  created_at: string;
};

export type Contact = {
  id: string;
  account_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  job_title: string | null;
  owner_id: string | null;
  consent_basis: ConsentBasis;
  consent_source: string | null;
  created_at: string;
};

export type Lead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  source: LeadSource;
  source_detail: string | null;
  status: LeadStatus;
  interest: string | null;
  estimated_value: number | null;
  currency: string;
  owner_id: string | null;
  consent_basis: ConsentBasis;
  consent_source: string | null;
  disqualified_reason: string | null;
  notes: string | null;
  converted_account_id: string | null;
  converted_deal_id: string | null;
  converted_at: string | null;
  created_at: string;
};

export type Deal = {
  id: string;
  name: string;
  account_id: string;
  contact_id: string | null;
  stage_id: string;
  status: DealStatus;
  value: number;
  currency: string;
  expected_close: string | null;
  owner_id: string | null;
  lost_reason: string | null;
  closed_at: string | null;
  created_at: string;
};

export type Activity = {
  id: string;
  type: ActivityType;
  subject: string;
  body: string | null;
  due_at: string | null;
  completed_at: string | null;
  account_id: string | null;
  contact_id: string | null;
  lead_id: string | null;
  deal_id: string | null;
  owner_id: string | null;
  created_by: string | null;
  created_at: string;
};

export type LedgerAccount = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  system_key: string | null;
  is_system: boolean;
  is_active: boolean;
  description: string | null;
};

export type Journal = {
  id: string;
  number: string | null;
  journal_date: string;
  description: string;
  source_type: string;
  currency: string;
  fx_rate: number;
  status: "draft" | "posted";
  posted_at: string | null;
  reversal_of: string | null;
  reversed_by: string | null;
  created_at: string;
};

export type JournalLine = {
  id: string;
  line_no: number;
  account_id: string;
  description: string | null;
  debit: number;
  credit: number;
};

export type Period = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: "open" | "closed" | "locked";
};

export type Member = {
  user_id: string;
  role: Role;
  created_at: string;
};

export type Profile = { id: string; full_name: string | null; email: string | null };

// ---------- sales, inventory, integrations ----------
export type DocType = "quote" | "order" | "invoice" | "credit_note";
export type DocStatus = "draft" | "sent" | "accepted" | "declined" | "open" | "fulfilled" | "cancelled" | "issued";
export type UnitStatus = "on_order" | "in_transit" | "in_stock" | "reserved" | "sold" | "written_off";
export type UnitCostKind = "purchase" | "transport" | "clearing" | "duty" | "repairs" | "other";
export type PaymentMethod = "eft" | "cash" | "card" | "other";

export const CURRENCIES = ["ZAR", "USD", "EUR", "GBP", "KES", "BWP", "ZMW", "MZN", "NAD", "ZWG"];
export const UNIT_STATUSES: UnitStatus[] = ["on_order", "in_transit", "in_stock", "reserved", "sold", "written_off"];
export const MANUAL_UNIT_STATUSES: UnitStatus[] = ["on_order", "in_transit", "in_stock"];
export const UNIT_COST_KINDS: UnitCostKind[] = ["purchase", "transport", "clearing", "duty", "repairs", "other"];
export const PAYMENT_METHODS: PaymentMethod[] = ["eft", "cash", "card", "other"];

export type TaxRate = { id: string; code: string; name: string; rate: number; is_zero_rated: boolean; is_active: boolean };

export type Tracking = "serial" | "none" | "stock";

export type Product = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  tracking: Tracking;
  sale_price: number | null;
  currency: string;
  tax_rate_id: string | null;
  is_active: boolean;
  qty_on_hand: number;
  avg_cost: number;
  reorder_level: number | null;
  unit_label: string | null;
  image_url: string | null;
  external_id: string | null;
};

export type StockSource = {
  id: string;
  name: string;
  kind: "supabase_vehicles" | "json_feed";
  base_url: string;
  api_key: string | null;
  table_name: string;
  image_bucket: string;
  include_images: boolean;
  is_active: boolean;
  last_synced_at: string | null;
  last_status: string | null;
  last_counts: { created?: number; updated?: number; skipped?: number; products?: number; received?: number } | null;
  created_at: string;
};

export type Unit = {
  id: string;
  product_id: string | null;
  serial_no: string;
  make: string | null;
  model: string | null;
  variant: string | null;
  year: number | null;
  colour: string | null;
  engine_no: string | null;
  mileage_km: number | null;
  is_second_hand: boolean;
  location: string | null;
  status: UnitStatus;
  list_price: number | null;
  list_currency: string;
  supplier_account_id: string | null;
  acquired_on: string | null;
  sold_doc_id: string | null;
  sold_at: string | null;
  notes: string | null;
  vin_confirmed: boolean;
  external_id: string | null;
  external_source_id: string | null;
  image_url: string | null;
  site_status: string | null;
  description: string | null;
  created_at: string;
};

export type UnitCost = {
  id: string;
  unit_id: string;
  kind: UnitCostKind;
  description: string | null;
  cost_date: string;
  amount: number;
  vat_amount: number;
  paid_from_account_id: string;
  reference: string | null;
  journal_id: string | null;
  reversal_journal_id: string | null;
  created_at: string;
};

export type SalesDoc = {
  id: string;
  doc_type: DocType;
  number: string | null;
  status: DocStatus;
  account_id: string;
  contact_id: string | null;
  deal_id: string | null;
  source_doc_id: string | null;
  issue_date: string;
  due_date: string | null;
  valid_until: string | null;
  currency: string;
  fx_rate: number;
  reference: string | null;
  tracking_stage: string | null;
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
  journal_id: string | null;
  issued_at: string | null;
  share_token: string;
  created_at: string;
};

export type SalesLine = {
  id: string;
  line_no: number;
  product_id: string | null;
  unit_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  tax_rate_id: string;
  tax_rate: number;
  line_subtotal: number;
  line_tax: number;
  line_total: number;
  cost_amount: number | null;
};

export type Payment = {
  id: string;
  number: string | null;
  account_id: string;
  order_id: string | null;
  payment_date: string;
  currency: string;
  fx_rate: number;
  amount: number;
  amount_allocated: number;
  bank_account_id: string;
  method: PaymentMethod;
  reference: string | null;
  journal_id: string | null;
  reversal_journal_id: string | null;
  created_at: string;
};

export type Allocation = { id: string; payment_id: string; invoice_id: string; amount: number; fx_difference: number; created_at: string };

export type ApiKey = { id: string; name: string; prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null };
export type WebhookEndpoint = { id: string; url: string; description: string | null; secret: string; events: string[]; is_active: boolean; created_at: string };
