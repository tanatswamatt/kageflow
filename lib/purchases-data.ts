import type { AppContext } from "./context";
import type { Option, StockOption, EditorTax } from "@/components/purchases/bill-editor";

/** Bank and card accounts money can be paid from */
export async function loadBankAccounts(ctx: AppContext) {
  const { data } = await ctx.supabase
    .from("accounts")
    .select("id, code, name, type, system_key")
    .eq("company_id", ctx.companyId)
    .eq("is_active", true)
    .in("type", ["asset", "liability"])
    .order("code");
  return ((data ?? []) as { id: string; code: string; name: string; type: string; system_key: string | null }[]).filter(
    (a) => a.system_key === "bank" || (a.type === "asset" && a.code < "1100" && !a.system_key) || /bank|card|cash/i.test(a.name),
  ).filter((a) => !["receivables", "payables", "vat_input", "vat_output", "vat_control", "customer_deposits", "inventory"].includes(a.system_key ?? ""));
}

/** Accounts a bill line can be charged to: expenses and non-system assets */
export async function loadCostAccounts(ctx: AppContext) {
  const { data } = await ctx.supabase
    .from("accounts")
    .select("id, code, name, type, system_key")
    .eq("company_id", ctx.companyId)
    .eq("is_active", true)
    .in("type", ["expense", "asset"])
    .order("code");
  return ((data ?? []) as { id: string; code: string; name: string; type: string; system_key: string | null }[]).filter(
    (a) => !["bank", "receivables", "vat_input", "inventory", "landed_cost_clearing", "suspense"].includes(a.system_key ?? ""),
  );
}

export async function loadBillOptions(ctx: AppContext) {
  const [banks, costs, sup, prods, units, taxes] = await Promise.all([
    loadBankAccounts(ctx),
    loadCostAccounts(ctx),
    ctx.supabase.from("crm_accounts").select("id, name, kind").eq("company_id", ctx.companyId).order("name").limit(2000),
    ctx.supabase.from("products").select("id, name, sku, qty_on_hand, unit_label, avg_cost, tax_rate_id").eq("company_id", ctx.companyId).eq("tracking", "stock").eq("is_active", true).order("name"),
    ctx.supabase.from("inventory_units").select("id, serial_no, make, model, year, vin_confirmed").eq("company_id", ctx.companyId).not("status", "in", "(sold,written_off)").order("created_at", { ascending: false }).limit(1000),
    ctx.supabase.from("tax_rates").select("id, name, rate, code").eq("company_id", ctx.companyId).eq("is_active", true).order("rate", { ascending: false }),
  ]);
  type S = { id: string; name: string; kind: string };
  const supplierRows = ((sup.data ?? []) as S[]).sort((a, b) => Number(b.kind === "supplier") - Number(a.kind === "supplier") || a.name.localeCompare(b.name));
  const suppliers: Option[] = supplierRows.map((s) => ({ id: s.id, label: s.name, sub: s.kind === "supplier" ? undefined : s.kind }));
  const accounts: Option[] = costs.map((a) => ({ id: a.id, label: `${a.code} ${a.name}` }));
  const bankOptions: Option[] = banks.map((a) => ({ id: a.id, label: `${a.code} ${a.name}` }));
  type P = { id: string; name: string; sku: string; qty_on_hand: number; unit_label: string | null; avg_cost: number; tax_rate_id: string | null };
  const stock: StockOption[] = ((prods.data ?? []) as P[]).map((p) => ({ id: p.id, label: p.name, sub: `${Number(p.qty_on_hand)} ${p.unit_label ?? "in stock"}`, tax_rate_id: p.tax_rate_id, avg_cost: Number(p.avg_cost) }));
  type U = { id: string; serial_no: string; make: string | null; model: string | null; year: number | null; vin_confirmed: boolean };
  const vehicles: Option[] = ((units.data ?? []) as U[]).map((u) => ({ id: u.id, label: `${[u.make, u.model, u.year].filter(Boolean).join(" ") || "Vehicle"} · ${u.vin_confirmed ? u.serial_no : "VIN not added"}` }));
  const taxList = ((taxes.data ?? []) as EditorTax[]).map((t) => ({ ...t, rate: Number(t.rate) }));
  return { suppliers, accounts, banks: bankOptions, stock, vehicles, taxes: taxList };
}
