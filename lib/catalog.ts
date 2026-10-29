import "server-only";
import type { AppContext } from "./context";
import type { CatalogItem, EditorCustomer, EditorTax } from "@/components/sales/doc-editor";
import { unitLabel } from "./sales";

type ProductRow = { id: string; sku: string; name: string; description: string | null; tracking: "serial" | "none" | "stock"; sale_price: number | null; currency: string; tax_rate_id: string | null; image_url: string | null; qty_on_hand: number };
type UnitRow = { id: string; product_id: string | null; serial_no: string; vin_confirmed: boolean; make: string | null; model: string | null; variant: string | null; year: number | null; colour: string | null; mileage_km: number | null; is_second_hand: boolean; status: string; list_price: number | null; list_currency: string; image_url: string | null; location: string | null };

/** Everything that can go on a sales line: products/services and individual vehicles */
export async function loadCatalog(ctx: AppContext, opts: { creditFor?: string | null } = {}): Promise<CatalogItem[]> {
  const unitsQuery = opts.creditFor
    ? ctx.supabase.from("inventory_units").select("*").eq("company_id", ctx.companyId).eq("sold_doc_id", opts.creditFor)
    : ctx.supabase.from("inventory_units").select("*").eq("company_id", ctx.companyId).in("status", ["in_stock", "in_transit", "on_order", "reserved", "listed"]).order("created_at", { ascending: false }).limit(1000);
  const [{ data: products }, { data: units }] = await Promise.all([
    ctx.supabase.from("products").select("id, sku, name, description, tracking, sale_price, currency, tax_rate_id, image_url, qty_on_hand").eq("company_id", ctx.companyId).eq("is_active", true).order("name"),
    unitsQuery,
  ]);
  const productList = (products ?? []) as ProductRow[];
  const taxOf = new Map(productList.map((p) => [p.id, p.tax_rate_id]));
  const unitItems: CatalogItem[] = ((units ?? []) as UnitRow[]).map((u) => ({
    key: `u:${u.id}`,
    kind: "unit",
    product_id: u.product_id,
    unit_id: u.id,
    label: [u.make, u.model, u.year].filter(Boolean).join(" ") || "Vehicle",
    sublabel: [u.vin_confirmed ? `VIN ${u.serial_no}` : "VIN not added yet", u.variant, u.colour, u.mileage_km != null ? `${u.mileage_km.toLocaleString("en-US")} km` : null, u.status === "reserved" ? "reserved" : u.status === "in_stock" ? null : u.status.replace("_", " ")].filter(Boolean).join(" · "),
    description: [unitLabel(u), u.variant, u.colour].filter(Boolean).join("\n"),
    price: u.list_price != null ? Number(u.list_price) : null,
    currency: u.list_currency,
    tax_rate_id: u.product_id ? (taxOf.get(u.product_id) ?? null) : null,
    image_url: u.image_url,
    stock: null,
    warning: u.vin_confirmed ? null : "This vehicle came from the website without a VIN. Add the VIN on the vehicle page before issuing.",
  }));
  const productItems: CatalogItem[] = productList
    .filter((p) => p.tracking !== "serial")
    .map((p) => ({
      key: `p:${p.id}`,
      kind: "product",
      product_id: p.id,
      unit_id: null,
      label: p.name,
      sublabel: [p.sku, p.tracking === "stock" ? `${Number(p.qty_on_hand)} in stock` : null, p.description].filter(Boolean).join(" · "),
      description: p.name,
      price: p.sale_price != null ? Number(p.sale_price) : null,
      currency: p.currency,
      tax_rate_id: p.tax_rate_id,
      image_url: p.image_url,
      stock: p.tracking === "stock" ? Number(p.qty_on_hand) : null,
      warning: p.tracking === "stock" && Number(p.qty_on_hand) <= 0 ? "None in stock. Receive stock before issuing." : null,
    }));
  return [...unitItems, ...productItems];
}

export async function loadCustomers(ctx: AppContext): Promise<EditorCustomer[]> {
  const { data } = await ctx.supabase.from("crm_accounts").select("id, name, email, billing_address").eq("company_id", ctx.companyId).neq("kind", "supplier").order("name").limit(2000);
  return (data ?? []) as EditorCustomer[];
}

export async function loadTaxes(ctx: AppContext): Promise<EditorTax[]> {
  const { data } = await ctx.supabase.from("tax_rates").select("id, name, rate, is_zero_rated, code").eq("company_id", ctx.companyId).eq("is_active", true).order("rate", { ascending: false });
  return ((data ?? []) as EditorTax[]).map((t) => ({ ...t, rate: Number(t.rate) }));
}
