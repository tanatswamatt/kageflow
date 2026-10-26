"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { cleanError, done, fail, str } from "@/lib/forms";
import { cleanVin } from "@/lib/vin";

export async function startCheck(fd: FormData) {
  const back = "/inventory/stock-check";
  const ctx = await getContext();
  if (!ctx.can("inventory.write")) fail(back, "Your role can't run stock checks");
  const name = str(fd, "name") ?? `Stock check ${new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}`;
  const { data, error } = await ctx.supabase.from("stock_checks").insert({ company_id: ctx.companyId, name, location: str(fd, "location") }).select("id").single();
  if (error) fail(back, cleanError(error.message));
  redirect(`/inventory/stock-check/${data.id}`);
}

export type ScanResult = { vin: string; label: string | null; unitId: string | null; duplicate?: boolean; error?: string };

export async function addScan(checkId: string, raw: string): Promise<ScanResult> {
  const ctx = await getContext();
  const vin = cleanVin(raw);
  if (vin.length < 6) return { vin, label: null, unitId: null, error: "That doesn't look like a VIN" };
  const { error } = await ctx.supabase.from("stock_check_scans").insert({ company_id: ctx.companyId, check_id: checkId, vin });
  if (error && !error.message.includes("duplicate")) return { vin, label: null, unitId: null, error: cleanError(error.message) };
  const { data: u } = await ctx.supabase.from("inventory_units").select("id, stock_no, make, model, year, status").eq("company_id", ctx.companyId).eq("serial_no", vin).maybeSingle();
  revalidatePath(`/inventory/stock-check/${checkId}`);
  return {
    vin,
    unitId: (u?.id as string) ?? null,
    label: u ? `${u.stock_no} ${[u.year, u.make, u.model].filter(Boolean).join(" ")}${u.status !== "in_stock" ? ` (${String(u.status).replace(/_/g, " ")})` : ""}` : null,
    duplicate: !!error,
  };
}

export async function removeScan(fd: FormData) {
  const id = str(fd, "check_id")!;
  const ctx = await getContext();
  await ctx.supabase.from("stock_check_scans").delete().eq("id", str(fd, "id")).eq("company_id", ctx.companyId);
  revalidatePath(`/inventory/stock-check/${id}`);
}

export async function closeCheck(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/inventory/stock-check/${id}`;
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("close_stock_check", { p_id: id });
  if (error) fail(back, cleanError(error.message));
  done(back, "Stock check closed");
}
