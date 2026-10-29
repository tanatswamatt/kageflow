"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { cleanError, done, fail, num, str } from "@/lib/forms";
import type { DraftLine } from "@/lib/purchases";

async function buyer(back: string) {
  const ctx = await getContext();
  if (!ctx.can("purchases.write")) fail(back, "Only owners, admins and accountants can enter bills and pay suppliers");
  return ctx;
}

const clean = (v: unknown) => String(v ?? "").replace(/[\s,]/g, "");

export async function saveBill(_prev: { error?: string } | null, fd: FormData): Promise<{ error?: string }> {
  const ctx = await getContext();
  if (!ctx.can("purchases.write")) return { error: "Only owners, admins and accountants can enter bills" };
  const id = str(fd, "id");
  const post = str(fd, "intent") === "post";
  const expense = str(fd, "mode") === "expense";

  let raw: DraftLine[] = [];
  try {
    raw = JSON.parse(str(fd, "lines") ?? "[]") as DraftLine[];
  } catch {
    return { error: "Couldn't read the lines. Reload the page and try again." };
  }
  const lines = raw
    .filter((l) => (l.description ?? "").trim() || l.account_id || l.product_id || l.unit_id)
    .map((l) => ({
      kind: l.kind,
      account_id: l.kind === "account" ? l.account_id || "" : "",
      product_id: l.kind === "stock" ? l.product_id || "" : "",
      unit_id: l.kind === "vehicle" ? l.unit_id || "" : "",
      cost_kind: l.kind === "vehicle" ? l.cost_kind || "other" : "",
      description: (l.description ?? "").trim(),
      quantity: clean(l.quantity) || "1",
      unit_price: clean(l.unit_price) || "0",
      tax_rate_id: l.tax_rate_id || "",
      ...(l.vat !== undefined && clean(l.vat) !== "" ? { vat: clean(l.vat) } : {}),
    }));
  for (const [i, l] of lines.entries()) {
    const n = i + 1;
    if (!["account", "stock", "vehicle"].includes(l.kind)) return { error: `Line ${n}: choose what it is for` };
    if (l.kind === "account" && !l.account_id) return { error: `Line ${n}: choose the expense or asset account` };
    if (l.kind === "stock" && !l.product_id) return { error: `Line ${n}: choose the stock item` };
    if (l.kind === "vehicle" && !l.unit_id) return { error: `Line ${n}: choose the vehicle` };
    if (!l.description) return { error: `Line ${n} needs a description` };
    const q = Number(l.quantity), p = Number(l.unit_price);
    if (!Number.isFinite(q) || q <= 0) return { error: `Line ${n}: quantity must be more than zero` };
    if (!Number.isFinite(p) || p < 0) return { error: `Line ${n}: price must be zero or more` };
  }
  if (post && lines.length === 0) return { error: "Add at least one line" };

  // supplier: existing or typed in
  let supplierId = str(fd, "supplier_id");
  const newName = str(fd, "new_supplier_name");
  if (!supplierId && newName) {
    const { data, error } = await ctx.supabase
      .from("crm_accounts")
      .insert({ company_id: ctx.companyId, name: newName, kind: "supplier", vat_no: str(fd, "new_supplier_vat") })
      .select("id")
      .single();
    if (error) return { error: cleanError(error.message) };
    supplierId = data.id as string;
  }
  if (!supplierId) return { error: "Pick the supplier, or type a new one" };

  const currency = str(fd, "currency") ?? ctx.company.base_currency;
  const fx = currency === ctx.company.base_currency ? 1 : num(fd, "fx_rate");
  if (!fx || fx <= 0) return { error: `Enter the exchange rate: how many ${ctx.company.base_currency} is 1 ${currency}` };
  const paidFrom = expense ? str(fd, "paid_from") : null;
  if (expense && !paidFrom) return { error: "Choose the bank or card account it was paid from" };

  const { data: savedId, error } = await ctx.supabase.rpc("save_bill", {
    p_id: id,
    p_company: ctx.companyId,
    p_supplier: supplierId,
    p_supplier_ref: str(fd, "supplier_ref"),
    p_bill_date: str(fd, "bill_date"),
    p_due_date: expense ? null : str(fd, "due_date"),
    p_currency: currency,
    p_fx_rate: fx,
    p_paid_from: paidFrom,
    p_notes: str(fd, "notes"),
    p_lines: lines,
  });
  if (error) return { error: cleanError(error.message) };
  const billId = savedId as string;
  const page = `/purchases/bills/${billId}`;

  if (post) {
    const { error: postError } = await ctx.supabase.rpc("post_bill", { p_id: billId });
    revalidatePath("/purchases/bills");
    if (postError) fail(page, cleanError(postError.message));
    done(page, expense ? "Expense recorded" : "Bill posted. Pay it from here when it's due.");
  }
  revalidatePath("/purchases/bills");
  if (!id) redirect(`${page}?ok=${encodeURIComponent("Draft saved")}`);
  done(page, "Draft saved");
}

export async function discardBill(fd: FormData) {
  const id = str(fd, "id")!;
  const ctx = await buyer(`/purchases/bills/${id}`);
  const { error } = await ctx.supabase.rpc("discard_bill", { p_id: id });
  if (error) fail(`/purchases/bills/${id}`, cleanError(error.message));
  revalidatePath("/purchases/bills");
  done("/purchases/bills", "Draft discarded");
}

export async function voidBill(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/purchases/bills/${id}`;
  const ctx = await buyer(back);
  const { error } = await ctx.supabase.rpc("void_bill", { p_id: id, p_reason: str(fd, "reason") });
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/purchases/bills");
  done(back, "Bill voided and its entries reversed");
}

export async function paySupplier(fd: FormData) {
  const supplier = str(fd, "supplier_id")!;
  const ctx0 = await getContext();
  const currency = str(fd, "currency") ?? ctx0.company.base_currency;
  const back = `/purchases/payments/new?supplier=${supplier}&currency=${currency}`;
  const ctx = await buyer(back);
  const allocations: { bill_id: string; amount: number }[] = [];
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith("pay_") || typeof v !== "string") continue;
    const amt = Number(v.replace(/[\s,]/g, ""));
    if (!Number.isFinite(amt) || amt < 0) fail(back, "Amounts must be numbers");
    if (amt > 0) allocations.push({ bill_id: k.slice(4), amount: amt });
  }
  if (!allocations.length) fail(back, "Enter an amount against at least one bill");
  const fx = currency === ctx.company.base_currency ? 1 : num(fd, "fx_rate");
  if (!fx || fx <= 0) fail(back, `Enter the exchange rate on the day you paid: how many ${ctx.company.base_currency} is 1 ${currency}`);
  const { error } = await ctx.supabase.rpc("pay_supplier", {
    p_supplier: supplier,
    p_bank_account: str(fd, "bank_account_id"),
    p_allocations: allocations,
    p_date: str(fd, "payment_date"),
    p_currency: currency,
    p_fx_rate: fx,
    p_reference: str(fd, "reference"),
    p_bank_charges: num(fd, "bank_charges") ?? 0,
  });
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/purchases/bills");
  const bill = allocations.length === 1 ? allocations[0]!.bill_id : null;
  done(bill ? `/purchases/bills/${bill}` : "/purchases/payments", "Payment recorded");
}

export async function reverseSupplierPayment(fd: FormData) {
  const id = str(fd, "id")!;
  const ctx = await buyer("/purchases/payments");
  const { error } = await ctx.supabase.rpc("reverse_supplier_payment", { p_id: id, p_reason: str(fd, "reason") });
  if (error) fail("/purchases/payments", cleanError(error.message));
  revalidatePath("/purchases/bills");
  done("/purchases/payments", "Payment reversed. The bills it paid are open again.");
}
