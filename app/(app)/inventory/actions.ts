"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { bool, cleanError, done, fail, num, str } from "@/lib/forms";
import type { UnitCostKind, UnitStatus } from "@/lib/types";

function unitFields(fd: FormData) {
  const year = num(fd, "year");
  const mileage = num(fd, "mileage_km");
  return {
    product_id: str(fd, "product_id"),
    serial_no: str(fd, "serial_no")?.toUpperCase().replace(/\s+/g, "") ?? null,
    make: str(fd, "make"),
    model: str(fd, "model"),
    variant: str(fd, "variant"),
    year: year ? Math.round(year) : null,
    colour: str(fd, "colour"),
    engine_no: str(fd, "engine_no"),
    mileage_km: mileage ? Math.round(mileage) : null,
    is_second_hand: bool(fd, "is_second_hand"),
    location: str(fd, "location"),
    list_price: num(fd, "list_price"),
    list_currency: str(fd, "list_currency") ?? "ZAR",
    supplier_account_id: str(fd, "supplier_account_id"),
    acquired_on: str(fd, "acquired_on"),
    notes: str(fd, "notes"),
  };
}

export async function createUnit(fd: FormData) {
  const back = "/inventory/units/new";
  const ctx = await getContext();
  if (!ctx.can("inventory.write")) fail(back, "Your role can't add stock");
  const f = unitFields(fd);
  if (!f.serial_no) fail(back, "VIN or serial number is required");
  const status = (str(fd, "status") ?? "in_stock") as UnitStatus;
  const { data, error } = await ctx.supabase.from("inventory_units").insert({ ...f, status, company_id: ctx.companyId }).select("id").single();
  if (error) fail(back, error.message.includes("duplicate") ? `VIN ${f.serial_no} is already in stock records` : cleanError(error.message));
  redirect(`/inventory/units/${data.id}`);
}

export async function updateUnit(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/inventory/units/${id}`;
  const ctx = await getContext();
  if (!ctx.can("inventory.write")) fail(back, "Your role can't change stock");
  const parsed = unitFields(fd);
  const { serial_no: serialIn, ...rest } = parsed;
  const f = serialIn ? { ...rest, serial_no: serialIn } : { ...rest, serial_no: "" };
  const status = str(fd, "status") as UnitStatus | null;
  const confirmed = !f.serial_no.startsWith("TBC-") && f.serial_no.length >= 11;
  const { error } = await ctx.supabase
    .from("inventory_units")
    .update({ ...(serialIn ? f : rest), ...(status ? { status } : {}), ...(confirmed ? { vin_confirmed: true } : {}) })
    .eq("id", id)
    .eq("company_id", ctx.companyId);
  if (error) fail(back, cleanError(error.message));
  done(back, "Vehicle saved");
}

export async function addCost(fd: FormData) {
  const unit = str(fd, "unit_id")!;
  const back = `/inventory/units/${unit}`;
  const ctx = await getContext();
  if (!ctx.can("inventory.costs")) fail(back, "Only owners, admins and accountants can post costs");
  const amount = num(fd, "amount");
  if (!amount || amount <= 0) fail(back, "Enter the cost excluding VAT");
  const { error } = await ctx.supabase.rpc("add_unit_cost", {
    p_unit: unit,
    p_kind: (str(fd, "kind") ?? "other") as UnitCostKind,
    p_amount: amount,
    p_paid_from: str(fd, "paid_from_account_id"),
    p_vat: num(fd, "vat_amount") ?? 0,
    p_date: str(fd, "cost_date") ?? new Date().toISOString().slice(0, 10),
    p_description: str(fd, "description"),
    p_supplier: str(fd, "supplier_account_id"),
    p_reference: str(fd, "reference"),
  });
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/inventory", "layout");
  done(back, "Cost posted to inventory");
}

export async function reverseCost(fd: FormData) {
  const unit = str(fd, "unit_id")!;
  const back = `/inventory/units/${unit}`;
  const ctx = await getContext();
  if (!ctx.can("inventory.costs")) fail(back, "Only owners, admins and accountants can reverse costs");
  const { error } = await ctx.supabase.rpc("reverse_unit_cost", { p_cost: str(fd, "cost_id"), p_reason: str(fd, "reason") });
  if (error) fail(back, cleanError(error.message));
  done(back, "Cost reversed");
}

export async function saveProduct(fd: FormData) {
  const id = str(fd, "id");
  const back = id ? `/inventory/products/${id}` : "/inventory/products/new";
  const ctx = await getContext();
  if (!ctx.can("inventory.write")) fail(back, "Your role can't change products");
  const tracking = (str(fd, "tracking") ?? "none") as "serial" | "none" | "stock";
  const row = {
    sku: str(fd, "sku")?.toUpperCase().replace(/\s+/g, "-") ?? null,
    name: str(fd, "name"),
    description: str(fd, "description"),
    tracking,
    sale_price: num(fd, "sale_price"),
    currency: str(fd, "currency") ?? ctx.company.base_currency,
    tax_rate_id: str(fd, "tax_rate_id"),
    unit_label: str(fd, "unit_label"),
    reorder_level: num(fd, "reorder_level"),
    ...(id ? { is_active: bool(fd, "is_active") } : {}),
  };
  if (!row.name) fail(back, "Give the product a name");
  if (!row.sku) row.sku = `${row.name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  if (id) {
    const { error } = await ctx.supabase.from("products").update(row).eq("id", id).eq("company_id", ctx.companyId);
    if (error) fail(back, error.message.includes("duplicate") ? `Code ${row.sku} is already used` : cleanError(error.message));
    done(back, `${row.name} saved`);
  }
  const { data, error } = await ctx.supabase.from("products").insert({ ...row, company_id: ctx.companyId }).select("id").single();
  if (error) fail(back, error.message.includes("duplicate") ? `Code ${row.sku} is already used` : cleanError(error.message));
  done(`/inventory/products/${data.id}`, tracking === "stock" ? `${row.name} added. Receive your opening stock below.` : `${row.name} added`);
}

export async function receiveStock(fd: FormData) {
  const id = str(fd, "product_id")!;
  const back = `/inventory/products/${id}`;
  const ctx = await getContext();
  if (!ctx.can("inventory.costs")) fail(back, "Only owners, admins and accountants can receive stock");
  const qty = num(fd, "qty");
  const cost = num(fd, "unit_cost");
  if (!qty || qty <= 0) fail(back, "Enter how many you received");
  if (cost === null || cost < 0) fail(back, "Enter the cost per item excluding VAT");
  const { error } = await ctx.supabase.rpc("receive_stock", {
    p_product: id, p_qty: qty, p_unit_cost: cost, p_paid_from: str(fd, "paid_from_account_id"),
    p_vat: num(fd, "vat_amount") ?? 0, p_date: str(fd, "date") ?? new Date().toISOString().slice(0, 10), p_reference: str(fd, "reference"),
  });
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/inventory", "layout");
  done(back, `${qty} received and posted to inventory`);
}

export async function countStock(fd: FormData) {
  const id = str(fd, "product_id")!;
  const back = `/inventory/products/${id}`;
  const ctx = await getContext();
  if (!ctx.can("inventory.costs")) fail(back, "Only owners, admins and accountants can adjust stock");
  const counted = num(fd, "counted");
  if (counted === null || counted < 0) fail(back, "Enter the quantity you counted");
  const { error } = await ctx.supabase.rpc("count_stock", { p_product: id, p_counted: counted, p_reason: str(fd, "reason") });
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/inventory", "layout");
  done(back, "Stock count saved and the difference posted");
}

// ---------- adverts and photos ----------

export async function saveAdvert(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/inventory/units/${id}`;
  const ctx = await getContext();
  if (!ctx.can("inventory.write")) fail(back, "Your role can't change adverts");
  const price = num(fd, "advert_price");
  if (price !== null && price < 0) fail(back, "Price can't be negative");
  const features = (str(fd, "features") ?? "").split(/[\n,]/).map((f) => f.trim()).filter(Boolean).slice(0, 60);
  const publish = bool(fd, "is_published");
  const { data: u } = await ctx.supabase.from("inventory_units").select("status, list_price").eq("id", id).eq("company_id", ctx.companyId).maybeSingle();
  if (!u) fail(back, "Vehicle not found");
  if (publish && ["sold", "written_off"].includes(u.status as string)) fail(back, "Sold vehicles can't be advertised");
  if (publish && price === null && u.list_price === null) fail(back, "Add a price before publishing");
  const { error } = await ctx.supabase.from("inventory_units").update({
    is_published: publish,
    advert_price: price,
    advert_title: str(fd, "advert_title"),
    advert_description: str(fd, "advert_description"),
    features,
    transmission: str(fd, "transmission"),
    fuel_type: str(fd, "fuel_type"),
    body_type: str(fd, "body_type"),
  }).eq("id", id).eq("company_id", ctx.companyId);
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/inventory/units");
  done(back, publish ? "Advert saved and live on your feeds" : "Advert saved (not published)");
}

export async function registerPhotos(unitId: string, photos: { url: string; path: string }[]): Promise<{ error?: string }> {
  const ctx = await getContext();
  if (!ctx.can("inventory.write")) return { error: "Your role can't add photos" };
  const { data: last } = await ctx.supabase.from("vehicle_photos").select("position").eq("unit_id", unitId).order("position", { ascending: false }).limit(1).maybeSingle();
  let pos = last ? Number(last.position) + 1 : 0;
  const rows = photos.filter((p) => p.url.startsWith("https://") && p.path.startsWith(`${ctx.companyId}/`)).map((p) => ({ company_id: ctx.companyId, unit_id: unitId, url: p.url, storage_path: p.path, position: pos++ }));
  if (!rows.length) return { error: "No photos to add" };
  const { error } = await ctx.supabase.from("vehicle_photos").insert(rows);
  if (error) return { error: cleanError(error.message) };
  revalidatePath(`/inventory/units/${unitId}`);
  return {};
}

export async function removePhoto(fd: FormData) {
  const unitId = str(fd, "unit_id")!;
  const back = `/inventory/units/${unitId}`;
  const ctx = await getContext();
  if (!ctx.can("inventory.write")) fail(back, "Your role can't remove photos");
  const { data: p } = await ctx.supabase.from("vehicle_photos").select("id, storage_path").eq("id", str(fd, "id")).eq("company_id", ctx.companyId).maybeSingle();
  if (!p) fail(back, "Photo not found");
  const { error } = await ctx.supabase.from("vehicle_photos").delete().eq("id", p.id);
  if (error) fail(back, cleanError(error.message));
  if (p.storage_path) {
    const { error: se } = await ctx.supabase.storage.from("vehicle-photos").remove([p.storage_path as string]);
    // the record is gone either way; say so if the public file could not be deleted (security review KF-I01)
    if (se) fail(back, "Photo removed from the car, but the file could not be deleted from storage. Try again or tell Kageflow support.");
  }
  done(back, "Photo removed");
}

export async function makeMainPhoto(fd: FormData) {
  const unitId = str(fd, "unit_id")!;
  const back = `/inventory/units/${unitId}`;
  const ctx = await getContext();
  if (!ctx.can("inventory.write")) fail(back, "Your role can't change photos");
  const { data } = await ctx.supabase.from("vehicle_photos").select("id").eq("unit_id", unitId).eq("company_id", ctx.companyId).order("position").order("created_at");
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  const chosen = str(fd, "id")!;
  const order = [chosen, ...ids.filter((i) => i !== chosen)];
  for (const [i, pid] of order.entries()) {
    const { error } = await ctx.supabase.from("vehicle_photos").update({ position: i }).eq("id", pid);
    if (error) fail(back, cleanError(error.message));
  }
  done(back, "Main photo changed");
}
