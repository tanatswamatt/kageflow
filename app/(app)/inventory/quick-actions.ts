"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { vatFraction } from "@/lib/country";
import { cleanError } from "@/lib/forms";
import { cleanVin, decodeVinLocal, vinProblem } from "@/lib/vin";

export type VinInfo = {
  vin: string;
  make: string | null; model: string | null; variant: string | null; year: number | null;
  body: string | null; fuel: string | null; transmission: string | null;
  existing: { id: string; label: string; status: string } | null;
  source: "vpic" | "local" | "none";
  error?: string;
};

const BODY: [RegExp, string][] = [[/pickup/i, "Bakkie (double cab)"], [/sport utility|suv|multipurpose/i, "SUV"], [/hatchback/i, "Hatchback"], [/sedan/i, "Sedan"], [/van/i, "Panel van"], [/wagon/i, "Station wagon"], [/coupe/i, "Coupe"], [/convertible|cabrio/i, "Convertible"]];

export async function decodeVin(raw: string): Promise<VinInfo> {
  const ctx = await getContext();
  const vin = cleanVin(raw);
  const problem = vinProblem(vin);
  const base: VinInfo = { vin, make: null, model: null, variant: null, year: null, body: null, fuel: null, transmission: null, existing: null, source: "none" };
  if (problem) return { ...base, error: problem };

  const { data: dup } = await ctx.supabase.from("inventory_units").select("id, make, model, year, status, stock_no").eq("company_id", ctx.companyId).eq("serial_no", vin).maybeSingle();
  if (dup) base.existing = { id: dup.id as string, label: `${dup.stock_no ?? ""} ${[dup.year, dup.make, dup.model].filter(Boolean).join(" ")}`.trim(), status: dup.status as string };

  const local = decodeVinLocal(vin);
  let out: VinInfo = { ...base, make: local.make, year: local.year, source: local.make ? "local" : "none" };
  try {
    const res = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`, { signal: AbortSignal.timeout(6000), next: { revalidate: 86400 } });
    if (res.ok) {
      const j = (await res.json()) as { Results?: Record<string, string>[] };
      const r = j.Results?.[0];
      if (r && (r.Make || r.Model)) {
        const title = (s: string | undefined) => (s ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : null);
        const yr = Number(r.ModelYear);
        out = {
          ...out,
          make: title(r.Make) ?? out.make,
          model: r.Model || null,
          variant: [r.Trim, r.Series].filter(Boolean).join(" ") || null,
          year: yr > 1950 ? yr : out.year,
          body: BODY.find(([re]) => re.test(r.BodyClass ?? ""))?.[1] ?? null,
          fuel: /diesel/i.test(r.FuelTypePrimary ?? "") ? "Diesel" : /electric/i.test(r.FuelTypePrimary ?? "") ? "Electric" : /gasoline|petrol/i.test(r.FuelTypePrimary ?? "") ? "Petrol" : null,
          transmission: /manual/i.test(r.TransmissionStyle ?? "") ? "Manual" : /auto|cvt|dual/i.test(r.TransmissionStyle ?? "") ? "Automatic" : null,
          source: "vpic",
        };
      }
    }
  } catch {
    /* offline or slow: keep the local guess */
  }
  return out;
}

export type QuickAddResult = { id?: string; stockNo?: string; error?: string };

export async function quickAddVehicle(input: {
  vin: string; make: string; model: string; variant: string; year: string; mileage: string; colour: string;
  transmission: string; fuel: string; body: string; location: string;
  price: string; paidFrom: string; supplierId: string; privateSeller: boolean; newSupplier?: string;
}): Promise<QuickAddResult> {
  const ctx = await getContext();
  if (!ctx.can("inventory.write")) return { error: "Your role can't add stock" };
  const vin = cleanVin(input.vin);
  const problem = vinProblem(vin);
  if (problem) return { error: problem };
  if (!input.make.trim()) return { error: "Enter the make" };
  const n = (v: string) => {
    const x = Number(v.replace(/[\s,]/g, ""));
    return v.trim() && Number.isFinite(x) ? x : null;
  };
  const year = n(input.year);
  const km = n(input.mileage);
  // a seller who isn't in Kageflow yet: add them as a supplier so the car's cost can be owed to them
  if (input.supplierId === "__new") {
    const name = (input.newSupplier ?? "").trim();
    if (!name) return { error: "Type the seller's name, or choose Not recorded" };
    const { data: sup, error: se } = await ctx.supabase.from("crm_accounts").insert({ company_id: ctx.companyId, name, kind: "supplier", owner_id: ctx.user.id }).select("id").single();
    if (se) return { error: cleanError(se.message) };
    input = { ...input, supplierId: sup.id as string };
  }
  const { data: product } = await ctx.supabase.from("products").select("id").eq("company_id", ctx.companyId).eq("tracking", "serial").order("created_at").limit(1).maybeSingle();
  const { data, error } = await ctx.supabase.from("inventory_units").insert({
    company_id: ctx.companyId, product_id: product?.id ?? null, serial_no: vin,
    make: input.make.trim(), model: input.model.trim() || null, variant: input.variant.trim() || null,
    year: year ? Math.round(year) : null, mileage_km: km !== null ? Math.round(km) : null, colour: input.colour.trim() || null,
    transmission: input.transmission || null, fuel_type: input.fuel || null, body_type: input.body || null,
    location: input.location.trim() || null, status: "in_stock", is_second_hand: true,
    acquired_on: new Date().toISOString().slice(0, 10), supplier_account_id: input.supplierId || null,
  }).select("id, stock_no").single();
  if (error) return { error: error.message.includes("duplicate") ? `VIN ${vin} is already in your stock` : cleanError(error.message) };

  const price = n(input.price);
  if (price && price > 0 && input.paidFrom && ctx.can("inventory.costs")) {
    const vatVendor = !!ctx.company.vat_no?.trim();
    const vat = vatVendor && input.privateSeller && ctx.rules.notionalInputTax ? vatFraction(price, ctx.rules) : 0;
    const { error: costError } = await ctx.supabase.rpc("add_unit_cost", {
      p_unit: data.id, p_kind: "purchase", p_amount: Math.round((price - vat) * 100) / 100, p_paid_from: input.paidFrom, p_vat: vat,
      p_description: input.privateSeller ? "Bought from a private seller" : "Purchase price", p_supplier: input.supplierId || null,
    });
    if (costError) return { id: data.id as string, stockNo: data.stock_no as string, error: `Car added, but the price wasn't posted: ${cleanError(costError.message)}` };
  }
  revalidatePath("/inventory/units");
  return { id: data.id as string, stockNo: data.stock_no as string };
}
