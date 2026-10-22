"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { cleanError, done, fail, num, str } from "@/lib/forms";

const BACK = "/sales/commissions";

export async function commissionAction(fd: FormData) {
  const ctx = await getContext();
  if (!ctx.can("ledger.write")) fail(BACK, "Only owners, admins and accountants can approve or pay commission");
  const ids = fd.getAll("ids").filter((v): v is string => typeof v === "string");
  if (!ids.length) fail(BACK, "Tick at least one commission");
  const what = str(fd, "do");
  if (what === "approve") {
    const { data, error } = await ctx.supabase.rpc("approve_commissions", { p_ids: ids, p_date: str(fd, "date") });
    if (error) fail(BACK, cleanError(error.message));
    revalidatePath(BACK);
    done(BACK, `${data} approved and booked as owed`);
  }
  if (what === "pay") {
    const { error } = await ctx.supabase.rpc("pay_commissions", { p_ids: ids, p_bank_account: str(fd, "bank_account_id"), p_date: str(fd, "date"), p_reference: str(fd, "reference") });
    if (error) fail(BACK, cleanError(error.message));
    revalidatePath(BACK);
    done(BACK, "Paid");
  }
  fail(BACK, "Choose approve or pay");
}

export async function cancelCommission(fd: FormData) {
  const ctx = await getContext();
  if (!ctx.can("ledger.write")) fail(BACK, "Only owners, admins and accountants can cancel commission");
  const { error } = await ctx.supabase.rpc("cancel_commission", { p_id: str(fd, "id"), p_reason: str(fd, "reason") });
  if (error) fail(BACK, cleanError(error.message));
  done(BACK, "Commission cancelled");
}

export async function savePlan(fd: FormData) {
  const back = "/settings/members";
  const ctx = await getContext();
  if (!ctx.can("company.manage")) fail(back, "Only owners and admins can set commission plans");
  const user = str(fd, "user_id")!;
  const basis = str(fd, "basis");
  if (!basis) {
    const { error } = await ctx.supabase.from("commission_plans").delete().eq("company_id", ctx.companyId).eq("user_id", user);
    if (error) fail(back, cleanError(error.message));
    done(back, "Commission plan removed");
  }
  if (!["gross_profit_pct", "sale_pct", "flat_per_car"].includes(basis)) fail(back, "Pick how commission is worked out");
  const rate = num(fd, "rate");
  if (rate === null || rate < 0 || (basis !== "flat_per_car" && rate > 100)) fail(back, "Enter a valid rate");
  const { error } = await ctx.supabase.from("commission_plans").upsert({ company_id: ctx.companyId, user_id: user, basis, rate, min_amount: num(fd, "min_amount") ?? 0, updated_at: new Date().toISOString() });
  if (error) fail(back, cleanError(error.message));
  done(back, "Commission plan saved. It applies to invoices issued from now on.");
}

export async function setSalesperson(fd: FormData) {
  const doc = str(fd, "doc_id")!;
  const back = `/sales/doc/${doc}`;
  const ctx = await getContext();
  if (!ctx.can("ledger.write")) fail(back, "Only owners, admins and accountants can change the salesperson");
  const { error } = await ctx.supabase.rpc("set_salesperson", { p_doc: doc, p_user: str(fd, "user_id") });
  if (error) fail(back, cleanError(error.message));
  done(back, "Salesperson changed");
}
