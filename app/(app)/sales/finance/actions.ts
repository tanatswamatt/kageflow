"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { bool, cleanError, done, fail, num, str } from "@/lib/forms";
import { FINANCE_DOCS } from "@/lib/finance";

async function seller(back: string) {
  const ctx = await getContext();
  if (!ctx.can("sales.write")) fail(back, "Your role can't work on finance applications");
  return ctx;
}

/** South African ID: 13 digits with a Luhn check digit */
function validSaId(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    let d = Number(id[12 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

export async function createApplication(fd: FormData) {
  const back = "/sales/finance/new";
  const ctx = await seller(back);
  const orderId = str(fd, "order_id");
  let accountId = str(fd, "account_id");
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
  const idNo = str(fd, "id_number")?.replace(/\s/g, "") ?? null;
  if (idNo && /^\d{13}$/.test(idNo) && !validSaId(idNo)) fail(back, "That ID number fails the check digit. Check it against the ID document.");
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

export async function updateSubmission(fd: FormData) {
  const appId = str(fd, "application_id")!;
  const back = `/sales/finance/${appId}`;
  const ctx = await seller(back);
  const status = str(fd, "status");
  if (!status || !["submitted", "approved", "counter_offer", "declined", "contracted", "withdrawn"].includes(status)) fail(back, "Pick the bank's answer");
  const { error } = await ctx.supabase.from("finance_submissions").update({
    status, reference: str(fd, "reference"),
    approved_amount: num(fd, "approved_amount"), rate: num(fd, "rate"), term_months: num(fd, "term_months"),
    balloon_amount: num(fd, "balloon_amount"), instalment: num(fd, "instalment"), conditions: str(fd, "conditions"),
    decided_at: status === "submitted" ? null : new Date().toISOString(),
  }).eq("id", str(fd, "id")).eq("company_id", ctx.companyId);
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/sales/finance");
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
