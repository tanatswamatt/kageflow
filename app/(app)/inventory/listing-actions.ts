"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { bool, cleanError, done, fail, num, str } from "@/lib/forms";

const cleanVin = (v: string | null) => (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Advertise a car that stays on an approved supplier's floor until a customer commits */
export async function listSupplierCar(fd: FormData) {
  const back = "/inventory/list-supplier-car";
  const ctx = await getContext();
  if (!ctx.can("inventory.write")) fail(back, "Your role can't add stock");
  const supplier = str(fd, "supplier_id");
  if (!supplier) fail(back, "Choose the supplier whose floor the car is on");
  const make = str(fd, "make");
  if (!make) fail(back, "Enter the make");
  const vin = cleanVin(str(fd, "vin"));
  if (vin && (vin.length !== 17 || /[IOQ]/.test(vin))) fail(back, "A VIN has 17 letters and numbers, without I, O or Q. Leave it blank if you don't have it yet");
  const year = num(fd, "year");
  const price = num(fd, "advert_price");
  const { data: product } = await ctx.supabase.from("products").select("id").eq("company_id", ctx.companyId).eq("tracking", "serial").order("created_at").limit(1).maybeSingle();
  const { data, error } = await ctx.supabase.from("inventory_units").insert({
    company_id: ctx.companyId, product_id: (product as { id: string } | null)?.id ?? null,
    serial_no: vin || `TBC-${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`, vin_confirmed: false,
    make, model: str(fd, "model"), variant: str(fd, "variant"), year: year ? Math.round(year) : null, colour: str(fd, "colour"),
    mileage_km: num(fd, "mileage_km") != null ? Math.round(num(fd, "mileage_km")!) : null,
    transmission: str(fd, "transmission"), fuel_type: str(fd, "fuel_type"), body_type: str(fd, "body_type"),
    registration_no: str(fd, "registration_no")?.toUpperCase() ?? null, location: str(fd, "location"),
    status: "listed", is_second_hand: true, supplier_account_id: supplier,
    supplier_price: num(fd, "supplier_price"), supplier_currency: ctx.company.base_currency,
    list_price: price, advert_price: price, list_currency: ctx.company.base_currency,
    is_published: bool(fd, "publish") && !!price, advert_description: str(fd, "advert_description"),
    acquired_on: new Date().toISOString().slice(0, 10),
  }).select("id").single();
  if (error) fail(back, error.message.includes("duplicate") ? `VIN ${vin} is already in your stock` : cleanError(error.message));
  revalidatePath("/inventory", "layout");
  redirect(`/inventory/units/${data.id}?ok=${encodeURIComponent("Listed. Add photos and the registration document below.")}`);
}

export async function inspectCar(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/inventory/units/${id}`;
  const ctx = await getContext();
  if (!ctx.can("inventory.write")) fail(back, "Your role can't change stock");
  const { data, error } = await ctx.supabase.rpc("inspect_vehicle", { p_unit: id, p_vin: str(fd, "vin"), p_override: bool(fd, "override") });
  if (error) fail(back, cleanError(error.message));
  revalidatePath(back);
  done(back, (data as { changed: boolean }).changed ? "VIN corrected to the one on the car and marked inspected" : "Inspected: the VIN is confirmed");
}

export async function buyListedCar(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/inventory/units/${id}`;
  const ctx = await getContext();
  if (!ctx.can("inventory.costs")) fail(back, "Only owners, admins and accountants can buy stock");
  const amount = num(fd, "amount");
  if (!amount || amount <= 0) fail(back, "Enter what you are paying, excluding VAT");
  const { error } = await ctx.supabase.rpc("buy_listed_vehicle", {
    p_unit: id, p_amount: amount, p_vat: ctx.company.vat_no?.trim() ? (num(fd, "vat") ?? 0) : 0,
    p_paid_from: str(fd, "paid_from"), p_date: str(fd, "date") ?? new Date().toISOString().slice(0, 10), p_reference: str(fd, "reference"),
  });
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/", "layout");
  done(back, "Bought: the car is now your stock and the supplier is in Payables until you pay them");
}

export async function removeListingAction(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/inventory/units/${id}`;
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("remove_listing", { p_unit: id });
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/inventory", "layout");
  done("/inventory/units?v=listed", "Listing removed and taken off your feeds");
}

/** Record the registration document uploaded to the private bucket */
export async function saveRegDoc(unitId: string, path: string): Promise<{ error?: string }> {
  const ctx = await getContext();
  if (!ctx.can("inventory.write")) return { error: "Your role can't change stock" };
  if (!path.startsWith(`${ctx.companyId}/${unitId}/`)) return { error: "That file isn't in this car's folder" };
  const { data: old } = await ctx.supabase.from("inventory_units").select("reg_doc_path").eq("id", unitId).eq("company_id", ctx.companyId).maybeSingle();
  const { error } = await ctx.supabase.from("inventory_units").update({ reg_doc_path: path }).eq("id", unitId).eq("company_id", ctx.companyId);
  if (error) return { error: cleanError(error.message) };
  const prev = (old as { reg_doc_path: string | null } | null)?.reg_doc_path;
  if (prev && prev !== path) await ctx.supabase.storage.from("vehicle-documents").remove([prev]);
  revalidatePath(`/inventory/units/${unitId}`);
  return {};
}

export async function setApprovedSupplier(fd: FormData) {
  const id = str(fd, "account_id")!;
  const back = `/crm/accounts/${id}`;
  const ctx = await getContext();
  if (!ctx.can("company.manage")) fail(back, "Only owners and admins can approve suppliers");
  const approved = bool(fd, "approved");
  const { error } = await ctx.supabase.from("crm_accounts").update({ approved_supplier: approved }).eq("id", id).eq("company_id", ctx.companyId);
  if (error) fail(back, cleanError(error.message));
  revalidatePath(back);
  done(back, approved ? "Approved: you can now list this supplier's cars" : "No longer an approved supplier. Cars already listed stay until you remove them");
}

/** The supplier side: let another dealer on Kageflow advertise this car at a trade price */
export async function shareCar(fd: FormData) {
  const id = str(fd, "unit_id")!;
  const back = `/inventory/units/${id}`;
  const ctx = await getContext();
  if (!ctx.can("inventory.write")) fail(back, "Your role can't share stock");
  const price = num(fd, "price");
  if (!price || price <= 0) fail(back, "Enter the price the dealer would pay you");
  const { data, error } = await ctx.supabase.rpc("share_vehicle", { p_unit: id, p_code: str(fd, "code") ?? "", p_price: price, p_note: str(fd, "note") });
  if (error) fail(back, cleanError(error.message));
  revalidatePath(back);
  done(back, `Shared with ${data as string}. They see it under Shared with you, and it comes off their site if you sell it`);
}

export async function withdrawShareAction(fd: FormData) {
  const back = str(fd, "back") ?? "/inventory/units";
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("withdraw_share", { p_id: str(fd, "id") });
  if (error) fail(back, cleanError(error.message));
  revalidatePath(back);
  done(back, "Withdrawn. It's off their listings");
}

/** The dealer side: list a car a supplier shared */
export async function acceptShareAction(fd: FormData) {
  const back = "/inventory/shared";
  const ctx = await getContext();
  if (!ctx.can("inventory.write")) fail(back, "Your role can't add stock");
  const { data, error } = await ctx.supabase.rpc("accept_share", { p_id: str(fd, "id"), p_price: num(fd, "price"), p_publish: bool(fd, "publish") });
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/", "layout");
  redirect(`/inventory/units/${data as string}?ok=${encodeURIComponent("Listed. It stays in step with the supplier's car, and comes off your feeds if they sell it.")}`);
}

export async function declineShareAction(fd: FormData) {
  const back = "/inventory/shared";
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("decline_share", { p_id: str(fd, "id") });
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/", "layout");
  done(back, "Declined");
}
