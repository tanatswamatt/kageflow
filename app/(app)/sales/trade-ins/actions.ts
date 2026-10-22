"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { bool, cleanError, done, fail, num, str } from "@/lib/forms";

function fields(fd: FormData) {
  const year = num(fd, "year");
  const km = num(fd, "mileage_km");
  return {
    vin: str(fd, "vin")?.toUpperCase().replace(/\s+/g, "") ?? null,
    make: str(fd, "make"), model: str(fd, "model"), variant: str(fd, "variant"),
    year: year ? Math.round(year) : null, mileage_km: km !== null ? Math.round(km) : null,
    colour: str(fd, "colour"), registration: str(fd, "registration"), condition_notes: str(fd, "condition_notes"),
    valuation: num(fd, "valuation"), allowance: num(fd, "allowance"),
    settlement_amount: num(fd, "settlement_amount") ?? 0, settlement_bank: str(fd, "settlement_bank"), settlement_ref: str(fd, "settlement_ref"),
    seller_is_vendor: bool(fd, "seller_is_vendor"),
  };
}

export async function createTradeIn(fd: FormData) {
  const back = "/sales/trade-ins/new";
  const ctx = await getContext();
  if (!ctx.can("sales.write")) fail(back, "Your role can't record trade-ins");
  let accountId = str(fd, "account_id");
  const orderId = str(fd, "order_id");
  if (orderId) {
    const { data: o } = await ctx.supabase.from("sales_docs").select("account_id").eq("id", orderId).eq("company_id", ctx.companyId).maybeSingle();
    if (!o) fail(back, "Order not found");
    accountId = o.account_id as string;
  }
  if (!accountId) fail(back, "Pick the customer, or the order");
  const f = fields(fd);
  if (!f.make) fail(back, "Enter at least the make");
  const { data, error } = await ctx.supabase.from("trade_ins").insert({ company_id: ctx.companyId, account_id: accountId, order_id: orderId, deal_id: str(fd, "deal_id"), ...f }).select("id").single();
  if (error) fail(back, cleanError(error.message));
  redirect(`/sales/trade-ins/${data.id}?ok=${encodeURIComponent("Trade-in saved. Accept it once the customer agrees.")}`);
}

export async function saveTradeIn(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/sales/trade-ins/${id}`;
  const ctx = await getContext();
  if (!ctx.can("sales.write")) fail(back, "Your role can't change trade-ins");
  const { error } = await ctx.supabase.from("trade_ins").update({ ...fields(fd), order_id: str(fd, "order_id") }).eq("id", id).eq("company_id", ctx.companyId);
  if (error) fail(back, cleanError(error.message));
  revalidatePath(back);
  done(back, "Trade-in saved");
}

export async function acceptTradeIn(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/sales/trade-ins/${id}`;
  const ctx = await getContext();
  if (!ctx.can("sales.write")) fail(back, "Your role can't accept trade-ins");
  const { error } = await ctx.supabase.rpc("accept_trade_in", { p_id: id, p_date: str(fd, "date") });
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/sales/trade-ins");
  done(back, "Trade-in accepted: the car is in stock and the customer's credit is on their account");
}

export async function undoTradeIn(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/sales/trade-ins/${id}`;
  const ctx = await getContext();
  if (!ctx.can("payments.write")) fail(back, "Only owners, admins and accountants can undo trade-ins");
  const { error } = await ctx.supabase.rpc("undo_trade_in", { p_id: id, p_reason: str(fd, "reason") });
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/sales/trade-ins");
  done(back, "Trade-in undone and its entries reversed");
}
