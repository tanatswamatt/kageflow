"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { bool, cleanError, done, fail, num, str } from "@/lib/forms";
import { resolveAccount } from "@/lib/accounts";
import { FINANCE_DOCS } from "@/lib/finance";

async function seller(back: string) {
  const ctx = await getContext();
  if (!ctx.can("sales.write")) fail(back, "Your role can't work on finance applications");
  return ctx;
}

export async function createApplication(fd: FormData) {
  const back = "/sales/finance/new";
  const ctx = await seller(back);
  const orderId = str(fd, "order_id");
  let accountId = str(fd, "order_id") ? null : await resolveAccount(ctx, fd, back);
  let unitId = str(fd, "unit_id");
  let price: number | null = null;
  let deposit = 0;
  let tradeIn = 0;
  if (orderId) {
    const { data: o } = await ctx.supabase.from("sales_docs").select("id, account_id, total, currency, doc_type").eq("id", orderId).eq("company_id", ctx.companyId).maybeSingle();
    if (!o) fail(back, "Order not found");
    accountId = o.account_id as string;
    price = Number(o.total);
    const [{ data: lines }, { data: pays }] = await Promise.all([
      ctx.supabase.from("sales_doc_lines").select("unit_id").eq("doc_id", orderId).not("unit_id", "is", null).limit(1),
      ctx.supabase.from("customer_payments").select("amount, method").eq("order_id", orderId).is("reversal_journal_id", null),
    ]);
    unitId = unitId ?? ((lines ?? [])[0]?.unit_id as string | undefined) ?? null;
    for (const p of (pays ?? []) as { amount: number; method: string }[]) {
      if (p.method === "trade_in") tradeIn += Number(p.amount);
      else if (p.method !== "bank_payout") deposit += Number(p.amount);
    }
  }
  if (!accountId) fail(back, "Pick the customer");
  if (!price && unitId) {
    const { data: u } = await ctx.supabase.from("inventory_units").select("advert_price, list_price").eq("id", unitId).maybeSingle();
    price = u ? Number(u.advert_price ?? u.list_price ?? 0) || null : null;
  }
  const [{ data: acc }, { data: contact }] = await Promise.all([
    ctx.supabase.from("crm_accounts").select("name, email, phone, billing_address").eq("id", accountId).eq("company_id", ctx.companyId).maybeSingle(),
    ctx.supabase.from("crm_contacts").select("first_name, last_name, email, phone").eq("company_id", ctx.companyId).eq("account_id", accountId).order("created_at").limit(1).maybeSingle(),
  ]);
  if (!acc) fail(back, "Customer not found");
  const nameParts = String(acc.name).split(/\s+/);
  const { data, error } = await ctx.supabase.from("finance_applications").insert({
    company_id: ctx.companyId, account_id: accountId, order_id: orderId, unit_id: unitId, deal_id: str(fd, "deal_id"),
    first_name: contact?.first_name ?? nameParts[0] ?? null, last_name: contact?.last_name ?? (nameParts.slice(1).join(" ") || null),
    email: contact?.email ?? acc.email, phone: contact?.phone ?? acc.phone, address: acc.billing_address,
    purchase_price: price, deposit, trade_in_credit: tradeIn, term_months: 72,
  }).select("id").single();
  if (error) fail(back, cleanError(error.message));
  redirect(`/sales/finance/${data.id}?ok=${encodeURIComponent("Application started. Fill in the buyer's details, then send it to the banks.")}`);
}

export async function saveApplication(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/sales/finance/${id}`;
  const ctx = await seller(back);
  const r = ctx.rules;
  const idNo = (r.code === "ZW" ? str(fd, "id_number")?.toUpperCase() : str(fd, "id_number")?.replace(/\s/g, "")) ?? null;
  // a passport number is allowed; a number that looks like the national ID must be valid
  if (idNo && r.code === "ZA" && /^\d{13}$/.test(idNo) && !r.validId(idNo)) fail(back, "That ID number fails the check digit. Check it against the ID document.");
  if (idNo && r.code === "ZW" && /^\d{2}-?\d{5,}/.test(idNo) && !r.validId(idNo)) fail(back, `That national ID doesn't look right. Enter it like ${r.idHint.replace("For example ", "")}, or enter a passport number.`);
  const documents: Record<string, boolean> = {};
  for (const [k] of FINANCE_DOCS) documents[k] = bool(fd, `doc_${k}`);
  const consent = bool(fd, "consent");
  const { data: current } = await ctx.supabase.from("finance_applications").select("consent_at").eq("id", id).maybeSingle();
  const { error } = await ctx.supabase.from("finance_applications").update({
    first_name: str(fd, "first_name"), last_name: str(fd, "last_name"), id_number: idNo, email: str(fd, "email"), phone: str(fd, "phone"),
    marital_status: str(fd, "marital_status"), dependants: num(fd, "dependants"), address: str(fd, "address"), residential_status: str(fd, "residential_status"),
    years_at_address: num(fd, "years_at_address"), employer: str(fd, "employer"), occupation: str(fd, "occupation"), employment_type: str(fd, "employment_type"),
    employed_since: str(fd, "employed_since"), gross_income: num(fd, "gross_income"), net_income: num(fd, "net_income"), other_income: num(fd, "other_income"),
    expenses: num(fd, "expenses"), purchase_price: num(fd, "purchase_price"), deposit: num(fd, "deposit") ?? 0, trade_in_credit: num(fd, "trade_in_credit") ?? 0,
    extras: num(fd, "extras") ?? 0, term_months: num(fd, "term_months"), balloon_pct: num(fd, "balloon_pct") ?? 0, est_rate: num(fd, "est_rate"),
    documents, notes: str(fd, "notes"),
    consent_at: consent ? (current?.consent_at ?? new Date().toISOString()) : null,
    consent_text: consent ? "Customer consented to a credit check and to sharing their details with the selected banks" : null,
  }).eq("id", id).eq("company_id", ctx.companyId);
  if (error) fail(back, cleanError(error.message));
  revalidatePath(back);
  done(back, "Application saved");
}

export async function setApplicationCancelled(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/sales/finance/${id}`;
  const ctx = await seller(back);
  const cancel = str(fd, "cancel") === "true";
  const { error } = await ctx.supabase.from("finance_applications").update({ status: cancel ? "cancelled" : "draft" }).eq("id", id).eq("company_id", ctx.companyId);
  if (error) fail(back, cleanError(error.message));
  if (!cancel) {
    // put the status back in line with the banks' answers
    const { data: s } = await ctx.supabase.from("finance_submissions").select("id, status").eq("application_id", id).limit(1);
    if (s?.[0]) await ctx.supabase.from("finance_submissions").update({ status: s[0].status }).eq("id", s[0].id);
  }
  done(back, cancel ? "Application cancelled" : "Application reopened");
}

export async function addSubmission(fd: FormData) {
  const id = str(fd, "application_id")!;
  const back = `/sales/finance/${id}`;
  const ctx = await seller(back);
  const { data: app } = await ctx.supabase.from("finance_applications").select("consent_at, id_number, status").eq("id", id).maybeSingle();
  if (!app) fail(back, "Application not found");
  if (!app.consent_at) fail(back, "Tick the customer's credit check consent before sending to a bank");
  if (!app.id_number) fail(back, "Add the customer's ID number before sending to a bank");
  if (app.status === "cancelled") fail(back, "Reopen the application first");
  const bank = str(fd, "bank_other") ?? str(fd, "bank");
  if (!bank || bank === "Other") fail(back, "Pick the bank, or type its name");
  const { error } = await ctx.supabase.from("finance_submissions").insert({ company_id: ctx.companyId, application_id: id, bank, reference: str(fd, "reference") });
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/sales/finance");
  done(back, `Sent to ${bank}. Record their answer here when it comes in.`);
}

type Ctx = Awaited<ReturnType<typeof getContext>>;

/**
 * The bank said yes: turn the application into a confirmed order for its car, so the car is reserved
 * and the payout lands on the order. Returns the order number, or why it couldn't be made.
 */
async function orderFromApplication(ctx: Ctx, appId: string, unitOverride?: string | null): Promise<{ number?: string | null; error?: string; existing?: boolean }> {
  const { data: a } = await ctx.supabase.from("finance_applications").select("id, account_id, order_id, unit_id, deal_id, purchase_price").eq("id", appId).eq("company_id", ctx.companyId).maybeSingle();
  if (!a) return { error: "Application not found" };
  if (a.order_id) return { existing: true };
  const unitId = (unitOverride ?? a.unit_id) as string | null;
  if (!unitId) return { error: "choose the car on the application to create the order" };
  const [{ data: u }, { data: acct }, { data: taxes }] = await Promise.all([
    ctx.supabase.from("inventory_units").select("id, product_id, stock_no, serial_no, vin_confirmed, make, model, variant, year, colour, mileage_km, is_second_hand, status, advert_price, list_price, list_currency").eq("id", unitId).eq("company_id", ctx.companyId).maybeSingle(),
    ctx.supabase.from("crm_accounts").select("country").eq("id", a.account_id).maybeSingle(),
    ctx.supabase.from("tax_rates").select("id, code, rate").eq("company_id", ctx.companyId).eq("is_active", true),
  ]);
  if (!u) return { error: "the car isn't in your stock" };
  if (!["in_stock", "in_transit", "listed", "on_order"].includes(u.status as string)) return { error: u.status === "reserved" ? "the car is already reserved on another order" : `the car is ${String(u.status).replace("_", " ")}` };
  const tax = (code: string) => ((taxes ?? []) as { id: string; code: string; rate: number }[]).find((t) => t.code === code);
  const vatVendor = !!ctx.company.vat_no?.trim();
  const abroad = !!acct?.country && acct.country !== ctx.company.country;
  const rate = !vatVendor ? (tax("NONE") ?? tax("ZERO")) : abroad ? tax("ZERO") : tax("STD");
  if (!rate) return { error: "no matching VAT rate is set up" };
  // the finance purchase price is what the buyer pays, VAT included
  const gross = Number(a.purchase_price ?? u.advert_price ?? u.list_price ?? 0);
  if (!gross) return { error: "the application has no purchase price" };
  const net = Math.round((gross / (1 + Number(rate.rate))) * 100) / 100;
  const description = [[u.year, u.make, u.model].filter(Boolean).join(" ") + (u.is_second_hand ? " (used)" : ""), u.vin_confirmed ? `VIN ${u.serial_no}` : null, u.variant, u.colour, u.stock_no].filter(Boolean).join("\n");

  const { data: doc, error } = await ctx.supabase.from("sales_docs").insert({
    company_id: ctx.companyId, doc_type: "order", account_id: a.account_id, deal_id: a.deal_id, currency: ctx.company.base_currency, fx_rate: 1,
    issue_date: new Date().toISOString().slice(0, 10), reference: "Bank finance", notes: "Created from the approved finance application",
  }).select("id").single();
  if (error) return { error: cleanError(error.message) };
  const docId = (doc as { id: string }).id;
  const { error: le } = await ctx.supabase.from("sales_doc_lines").insert({
    company_id: ctx.companyId, doc_id: docId, line_no: 1, product_id: u.product_id, unit_id: u.id, description, quantity: 1, unit_price: net, tax_rate_id: rate.id,
  });
  if (le) {
    await ctx.supabase.from("sales_docs").delete().eq("id", docId).eq("status", "draft");
    return { error: cleanError(le.message) };
  }
  const { error: oe } = await ctx.supabase.from("sales_docs").update({ status: "open" }).eq("id", docId).eq("company_id", ctx.companyId);
  if (oe) return { error: `the order was saved as a draft but not confirmed: ${cleanError(oe.message)}` };
  await ctx.supabase.from("finance_applications").update({ order_id: docId, unit_id: u.id }).eq("id", appId).eq("company_id", ctx.companyId);
  const { data: num } = await ctx.supabase.from("sales_docs").select("number").eq("id", docId).maybeSingle();
  revalidatePath("/sales", "layout");
  revalidatePath("/inventory", "layout");
  return { number: (num as { number: string | null } | null)?.number ?? null };
}

export async function createOrderFromApplication(fd: FormData) {
  const appId = str(fd, "application_id")!;
  const back = `/sales/finance/${appId}`;
  const ctx = await seller(back);
  const r = await orderFromApplication(ctx, appId, str(fd, "unit_id"));
  if (r.error) fail(back, `Couldn't create the order: ${r.error}`);
  revalidatePath(back);
  done(back, r.existing ? "This application already has an order" : `Order ${r.number ?? ""} created and the car reserved`);
}

export async function updateSubmission(fd: FormData) {
  const appId = str(fd, "application_id")!;
  const back = `/sales/finance/${appId}`;
  const ctx = await seller(back);
  const status = str(fd, "status");
  const { data: cur } = await ctx.supabase.from("finance_submissions").select("status, dic_amount, dic_journal_id").eq("id", str(fd, "id") ?? "").eq("company_id", ctx.companyId).maybeSingle();
  const c0 = cur as { status: string; dic_amount: number | null; dic_journal_id: string | null } | null;
  if (!c0) fail(back, "Bank answer not found");
  // a paid-out deal keeps its status; only its DIC can still be filled in
  const allowed = c0.status === "paid_out" ? ["paid_out"] : ["submitted", "approved", "counter_offer", "declined", "contracted", "withdrawn"];
  if (!status || !allowed.includes(status)) fail(back, "Pick the bank's answer");
  if (c0?.dic_journal_id && Number(c0.dic_amount ?? 0) !== Number(num(fd, "dic_amount") ?? 0)) fail(back, "The DIC is already in the books. Click Undo DIC first, then change it");
  const { error } = await ctx.supabase.from("finance_submissions").update({
    status, reference: str(fd, "reference"),
    approved_amount: num(fd, "approved_amount"), rate: num(fd, "rate"), term_months: num(fd, "term_months"),
    balloon_amount: num(fd, "balloon_amount"), instalment: num(fd, "instalment"), conditions: str(fd, "conditions"), dic_amount: num(fd, "dic_amount"),
    ...(status === "paid_out" ? {} : { decided_at: status === "submitted" ? null : new Date().toISOString() }),
  }).eq("id", str(fd, "id")).eq("company_id", ctx.companyId);
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/sales/finance");
  // approved or signed: the deal is on, so the car gets an order (once)
  if (status === "approved" || status === "contracted") {
    const r = await orderFromApplication(ctx, appId);
    if (r.error) done(back, `Bank answer saved. No order yet: ${r.error}.`);
    if (!r.existing) done(back, `Bank answer saved. Order ${r.number ?? ""} created and the car reserved, so the payout lands on it.`);
  }
  done(back, "Bank answer saved");
}

export async function recordPayout(fd: FormData) {
  const appId = str(fd, "application_id")!;
  const back = `/sales/finance/${appId}`;
  const ctx = await getContext();
  if (!ctx.can("payments.write")) fail(back, "Only owners, admins and accountants can record bank payouts");
  const amount = num(fd, "amount");
  if (!amount || amount <= 0) fail(back, "Enter the amount the bank paid");
  const { error } = await ctx.supabase.rpc("record_finance_payout", { p_submission: str(fd, "id"), p_amount: amount, p_bank_account: str(fd, "bank_account_id"), p_date: str(fd, "date") });
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/sales/finance");
  done(back, "Payout recorded on the order. It's applied when you issue the invoice.");
}

// ---------- finance house commission (DIC) in the books ----------

async function books(back: string) {
  const ctx = await getContext();
  if (!ctx.can("payments.write")) fail(back, "Only owners, admins and accountants can post finance commission");
  return ctx;
}

export async function postDic(fd: FormData) {
  const back = str(fd, "back") ?? "/sales/finance/commission";
  const ctx = await books(back);
  const { error } = await ctx.supabase.rpc("post_finance_dic", { p_submission: str(fd, "id"), p_date: str(fd, "date") });
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/sales/finance", "layout");
  done(back, "DIC posted: it's income now, and owed by the bank until they pay it");
}

export async function undoDic(fd: FormData) {
  const back = str(fd, "back") ?? "/sales/finance/commission";
  const ctx = await books(back);
  const { error } = await ctx.supabase.rpc("undo_finance_dic", { p_submission: str(fd, "id") });
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/sales/finance", "layout");
  done(back, "DIC reversed. Correct it on the bank's answer, then post it again");
}

export async function receiveDic(fd: FormData) {
  const back = "/sales/finance/commission";
  const ctx = await books(back);
  const ids = fd.getAll("ids").filter((x): x is string => typeof x === "string" && x.length > 0);
  if (ids.length === 0) fail(back, "Tick the commission the bank paid");
  const { error } = await ctx.supabase.rpc("receive_finance_dic", { p_submissions: ids, p_bank_account: str(fd, "bank_account_id"), p_date: str(fd, "date"), p_reference: str(fd, "reference") });
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/sales/finance", "layout");
  done(back, `Recorded: ${ids.length} commission${ids.length === 1 ? "" : "s"} received`);
}
