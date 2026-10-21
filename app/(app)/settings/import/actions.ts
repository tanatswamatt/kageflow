"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { cleanError, done, fail, str } from "@/lib/forms";
import type { ImportType } from "@/lib/import-spec";

const BACK = "/settings/import";
const KINDS = ["prospect", "customer", "supplier", "partner"];
const BASES = ["consent", "contract", "legitimate_interest", "not_recorded"];
const STATUSES = ["on_order", "in_transit", "in_stock"];

const numOrNull = (v: string | undefined) => {
  if (!v) return null;
  const n = Number(v.replace(/[\s,]/g, "").replace(/^R/i, ""));
  return Number.isFinite(n) ? n : NaN;
};

export async function importRows(fd: FormData) {
  const ctx = await getContext();
  const type = str(fd, "type") as ImportType;
  let rows: Record<string, string>[] = [];
  try {
    rows = JSON.parse(str(fd, "rows") ?? "[]");
  } catch {
    fail(BACK, "Couldn't read the file data. Choose the file again.");
  }
  if (!Array.isArray(rows) || rows.length === 0) fail(BACK, "Nothing to import");
  if (rows.length > 2000) fail(BACK, "Import up to 2 000 rows at a time");
  const errors: string[] = [];
  const bad = (i: number, msg: string) => errors.push(`Row ${i + 2}: ${msg}`);

  if (type === "customers") {
    if (!ctx.can("crm.write")) fail(BACK, "Your role can't add customers");
    const out = rows.map((r, i) => {
      if (!r.name) bad(i, "name is empty");
      const days = numOrNull(r.payment_days);
      if (Number.isNaN(days)) bad(i, "payment_days isn't a number");
      return {
        company_id: ctx.companyId, name: r.name, kind: KINDS.includes((r.kind ?? "").toLowerCase()) ? r.kind!.toLowerCase() : "customer",
        email: r.email || null, phone: r.phone || null, vat_no: r.vat_no || null, billing_address: r.billing_address || null,
        city: r.city || null, country: r.country ? r.country.toUpperCase().slice(0, 2) : null, payment_days: days, owner_id: ctx.user.id,
      };
    });
    if (errors.length) fail(BACK, errors.slice(0, 5).join(". "));
    const { error } = await ctx.supabase.from("crm_accounts").insert(out);
    if (error) fail(BACK, cleanError(error.message));
    revalidatePath("/crm/accounts");
    done(BACK, `${out.length} customers imported`);
  }

  if (type === "contacts") {
    if (!ctx.can("crm.write")) fail(BACK, "Your role can't add contacts");
    const { data: accts } = await ctx.supabase.from("crm_accounts").select("id, name").eq("company_id", ctx.companyId);
    const byName = new Map(((accts ?? []) as { id: string; name: string }[]).map((a) => [a.name.trim().toLowerCase(), a.id]));
    const out = rows.map((r, i) => {
      if (!r.first_name && !r.last_name) bad(i, "first_name and last_name are both empty");
      const accountId = r.account_name ? byName.get(r.account_name.trim().toLowerCase()) : null;
      if (r.account_name && !accountId) bad(i, `no customer called "${r.account_name}"`);
      const basis = BASES.includes((r.consent_basis ?? "").toLowerCase()) ? r.consent_basis!.toLowerCase() : "not_recorded";
      return {
        company_id: ctx.companyId, account_id: accountId ?? null, first_name: r.first_name || null, last_name: r.last_name || null,
        job_title: r.job_title || null, email: r.email || null, phone: r.phone || null, consent_basis: basis,
        consent_source: basis === "not_recorded" ? null : "Imported", consent_at: basis === "not_recorded" ? null : new Date().toISOString(), owner_id: ctx.user.id,
      };
    });
    if (errors.length) fail(BACK, errors.slice(0, 5).join(". "));
    const { error } = await ctx.supabase.from("crm_contacts").insert(out);
    if (error) fail(BACK, cleanError(error.message));
    done(BACK, `${out.length} contacts imported`);
  }

  if (type === "products") {
    if (!ctx.can("inventory.write")) fail(BACK, "Your role can't add products");
    const { data: taxes } = await ctx.supabase.from("tax_rates").select("id, code").eq("company_id", ctx.companyId);
    const taxBy = new Map(((taxes ?? []) as { id: string; code: string }[]).map((t) => [t.code, t.id]));
    const out = rows.map((r, i) => {
      if (!r.sku || !r.name) bad(i, "sku and name are required");
      const price = numOrNull(r.sale_price);
      if (Number.isNaN(price)) bad(i, "sale_price isn't a number");
      const tax = taxBy.get((r.vat_code || "STD").toUpperCase());
      if (!tax) bad(i, `unknown vat_code ${r.vat_code}`);
      return {
        company_id: ctx.companyId, sku: (r.sku ?? "").toUpperCase(), name: r.name, tracking: ["serial", "stock"].includes(r.tracking?.toLowerCase() ?? "") ? r.tracking!.toLowerCase() : "none",
        sale_price: price, currency: /^[A-Z]{3}$/.test((r.currency ?? "").toUpperCase()) ? r.currency!.toUpperCase() : ctx.company.base_currency, tax_rate_id: tax,
      };
    });
    if (errors.length) fail(BACK, errors.slice(0, 5).join(". "));
    const { error } = await ctx.supabase.from("products").insert(out);
    if (error) fail(BACK, error.message.includes("duplicate") ? "A product code in the file already exists" : cleanError(error.message));
    done(BACK, `${out.length} products imported`);
  }

  if (type === "vehicles") {
    if (!ctx.can("inventory.write")) fail(BACK, "Your role can't add vehicles");
    const { data: product } = await ctx.supabase.from("products").select("id").eq("company_id", ctx.companyId).eq("tracking", "serial").order("created_at").limit(1).maybeSingle();
    const withCost = rows.some((r) => r.opening_cost);
    const credit = str(fd, "credit_account_id");
    if (withCost && !ctx.can("inventory.costs")) fail(BACK, "Only owners, admins and accountants can import opening costs. Remove the opening_cost column or ask them.");
    if (withCost && !credit) fail(BACK, "Choose the account to credit opening costs to");
    const seen = new Set<string>();
    const out = rows.map((r, i) => {
      const vin = (r.vin ?? "").toUpperCase().replace(/\s+/g, "");
      if (vin.length < 3) bad(i, "vin is missing or too short");
      if (seen.has(vin)) bad(i, `VIN ${vin} appears twice`);
      seen.add(vin);
      const year = numOrNull(r.year), km = numOrNull(r.mileage_km), price = numOrNull(r.list_price), cost = numOrNull(r.opening_cost);
      if ([year, km, price, cost].some((x) => Number.isNaN(x))) bad(i, "a number column has text in it");
      return {
        row: {
          company_id: ctx.companyId, product_id: (product as { id: string } | null)?.id ?? null, serial_no: vin, make: r.make || null, model: r.model || null,
          variant: r.variant || null, year: year ? Math.round(year) : null, colour: r.colour || null, mileage_km: km ? Math.round(km) : null,
          location: r.location || null, status: STATUSES.includes((r.status ?? "").toLowerCase()) ? r.status!.toLowerCase() : "in_stock",
          list_price: price, list_currency: /^[A-Z]{3}$/.test((r.list_currency ?? "").toUpperCase()) ? r.list_currency!.toUpperCase() : ctx.company.base_currency,
        },
        cost,
      };
    });
    if (errors.length) fail(BACK, errors.slice(0, 5).join(". "));
    const { data: inserted, error } = await ctx.supabase.from("inventory_units").insert(out.map((o) => o.row)).select("id, serial_no");
    if (error) fail(BACK, error.message.includes("duplicate") ? "A VIN in the file is already in Kageflow" : cleanError(error.message));
    const idByVin = new Map(((inserted ?? []) as { id: string; serial_no: string }[]).map((u) => [u.serial_no, u.id]));
    let posted = 0;
    for (const o of out) {
      if (!o.cost || o.cost <= 0) continue;
      const { error: ce } = await ctx.supabase.rpc("add_unit_cost", {
        p_unit: idByVin.get(o.row.serial_no), p_kind: "purchase", p_amount: o.cost, p_paid_from: credit, p_description: "Opening stock",
      });
      if (ce) fail("/inventory/units", `Vehicles imported, but posting the cost of ${o.row.serial_no} failed: ${cleanError(ce.message)}. ${posted} costs were posted.`);
      posted++;
    }
    revalidatePath("/inventory", "layout");
    done(BACK, `${out.length} vehicles imported${posted ? `, ${posted} opening costs posted` : ""}`);
  }

  if (type === "opening_balances") {
    if (!ctx.can("ledger.write")) fail(BACK, "Only owners, admins and accountants can import opening balances");
    const asOf = str(fd, "as_of");
    if (!asOf) fail(BACK, "Choose the go-live date");
    const { data: accts } = await ctx.supabase.from("accounts").select("id, code").eq("company_id", ctx.companyId);
    const byCode = new Map(((accts ?? []) as { id: string; code: string }[]).map((a) => [a.code, a.id]));
    let dr = 0, cr = 0;
    const lines = rows.map((r, i) => {
      const id = byCode.get((r.account_code ?? "").trim());
      if (!id) bad(i, `no account with code ${r.account_code}`);
      const d = numOrNull(r.debit) ?? 0, c = numOrNull(r.credit) ?? 0;
      if (Number.isNaN(d) || Number.isNaN(c) || d < 0 || c < 0) bad(i, "debit and credit must be positive numbers");
      if (d && c) bad(i, "use either debit or credit, not both");
      if (!d && !c) bad(i, "no amount");
      dr += Math.round(d * 100); cr += Math.round(c * 100);
      return { account_id: id, debit: d, credit: c, description: r.description || null };
    });
    if (errors.length) fail(BACK, errors.slice(0, 5).join(". "));
    if (dr !== cr) fail(BACK, `Debits (${(dr / 100).toFixed(2)}) and credits (${(cr / 100).toFixed(2)}) differ by ${(Math.abs(dr - cr) / 100).toFixed(2)}. Fix the file so it balances.`);
    const { data: j, error } = await ctx.supabase.from("journals").insert({ company_id: ctx.companyId, journal_date: asOf, description: "Opening balances", source_type: "opening_balance" }).select("id").single();
    if (error) fail(BACK, cleanError(error.message));
    const { error: le } = await ctx.supabase.from("journal_lines").insert(lines.map((l, i) => ({ ...l, company_id: ctx.companyId, journal_id: j.id, line_no: i + 1 })));
    if (le) {
      await ctx.supabase.from("journals").delete().eq("id", j.id);
      fail(BACK, cleanError(le.message));
    }
    done(`/accounting/journals/${j.id}`, "Opening balances saved as a draft journal. Check it, then post it.");
  }

  fail(BACK, "Unknown import type");
}
