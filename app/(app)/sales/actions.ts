"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { cleanError, done, fail, num, str } from "@/lib/forms";
import { DOC_LABEL } from "@/lib/sales";
import { deliverEmail, documentEmail } from "@/lib/email";
import { date, money } from "@/lib/format";
import type { DocType, PaymentMethod } from "@/lib/types";

async function sales(back: string) {
  const ctx = await getContext();
  if (!ctx.can("sales.write")) fail(back, "Your role can view sales documents but not change them");
  return ctx;
}

const DOC_TYPES: DocType[] = ["quote", "order", "invoice", "credit_note"];

function rateFor(currency: string, base: string, raw: number | null): number | null {
  if (currency === base) return 1;
  return raw && raw > 0 ? raw : null;
}

// ---------- documents ----------

export async function createSalesDoc(fd: FormData) {
  const type = str(fd, "doc_type") as DocType;
  const back = `/sales/new?type=${type}`;
  const ctx = await sales(back);
  if (!DOC_TYPES.includes(type) || type === "credit_note") fail(back, "Credit notes are created from an issued invoice");
  const accountId = str(fd, "account_id");
  if (!accountId) fail(back, "Pick the customer");
  const currency = str(fd, "currency") ?? ctx.company.base_currency;
  const fx = rateFor(currency, ctx.company.base_currency, num(fd, "fx_rate"));
  if (!fx) fail(back, `Enter the exchange rate: how many ${ctx.company.base_currency} is 1 ${currency}`);
  const { data, error } = await ctx.supabase
    .from("sales_docs")
    .insert({
      company_id: ctx.companyId,
      doc_type: type,
      account_id: accountId,
      contact_id: str(fd, "contact_id"),
      deal_id: str(fd, "deal_id"),
      currency,
      fx_rate: fx,
      issue_date: str(fd, "issue_date") ?? undefined,
      due_date: type === "invoice" ? str(fd, "due_date") : null,
      valid_until: type === "quote" ? str(fd, "valid_until") : null,
      reference: str(fd, "reference"),
      notes: str(fd, "notes"),
    })
    .select("id")
    .single();
  if (error) fail(back, cleanError(error.message));
  redirect(`/sales/doc/${data.id}`);
}

export async function updateSalesDoc(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/sales/doc/${id}`;
  const ctx = await sales(back);
  const currency = str(fd, "currency") ?? ctx.company.base_currency;
  const fx = rateFor(currency, ctx.company.base_currency, num(fd, "fx_rate"));
  if (!fx) fail(back, `Enter the exchange rate: how many ${ctx.company.base_currency} is 1 ${currency}`);
  const { error } = await ctx.supabase
    .from("sales_docs")
    .update({
      contact_id: str(fd, "contact_id"),
      currency,
      fx_rate: fx,
      issue_date: str(fd, "issue_date") ?? undefined,
      due_date: str(fd, "due_date"),
      valid_until: str(fd, "valid_until"),
      reference: str(fd, "reference"),
      notes: str(fd, "notes"),
      terms: str(fd, "terms"),
      credit_reason: str(fd, "credit_reason"),
    })
    .eq("id", id)
    .eq("company_id", ctx.companyId);
  if (error) fail(back, cleanError(error.message));
  done(back, "Details saved");
}

type LineInput = { product_id?: string; unit_id?: string; description?: string; quantity?: string; unit_price?: string; discount_pct?: string; tax_rate_id?: string };

export async function saveLines(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/sales/doc/${id}`;
  const ctx = await sales(back);
  let raw: LineInput[] = [];
  try {
    raw = JSON.parse(str(fd, "lines") ?? "[]") as LineInput[];
  } catch {
    fail(back, "Couldn't read the lines; reload and try again");
  }
  const n = (v: string | undefined, d = 0) => {
    if (v === undefined || v === "") return d;
    const x = Number(String(v).replace(/[\s,]/g, ""));
    return Number.isFinite(x) ? x : NaN;
  };
  const lines = raw
    .filter((l) => (l.description ?? "").trim() || l.unit_id || l.product_id)
    .map((l, i) => ({
      company_id: ctx.companyId,
      doc_id: id,
      line_no: i + 1,
      product_id: l.product_id || null,
      unit_id: l.unit_id || null,
      description: (l.description ?? "").trim(),
      quantity: l.unit_id ? 1 : n(l.quantity, 1),
      unit_price: n(l.unit_price),
      discount_pct: n(l.discount_pct),
      tax_rate_id: l.tax_rate_id ?? "",
    }));
  for (const l of lines) {
    if (!l.description) fail(back, `Line ${l.line_no} needs a description`);
    if (!l.tax_rate_id) fail(back, `Line ${l.line_no} needs a VAT rate`);
    if ([l.quantity, l.unit_price, l.discount_pct].some((x) => Number.isNaN(x) || x < 0)) fail(back, `Line ${l.line_no} has an amount that isn't a positive number`);
    if (l.quantity === 0) fail(back, `Line ${l.line_no} needs a quantity`);
  }
  const units = lines.map((l) => l.unit_id).filter(Boolean);
  if (new Set(units).size !== units.length) fail(back, "The same vehicle is on two lines");

  const { error: clearError } = await ctx.supabase.from("sales_doc_lines").delete().eq("doc_id", id).eq("company_id", ctx.companyId);
  if (clearError) fail(back, cleanError(clearError.message));
  if (lines.length) {
    const { error } = await ctx.supabase.from("sales_doc_lines").insert(lines);
    if (error) fail(back, cleanError(error.message));
  }
  done(back, "Lines saved");
}

export async function setDocStatus(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/sales/doc/${id}`;
  const ctx = await sales(back);
  const status = str(fd, "status");
  const { error } = await ctx.supabase.from("sales_docs").update({ status }).eq("id", id).eq("company_id", ctx.companyId);
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/sales", "layout");
  done(back, "Status updated");
}

export async function setTrackingStage(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/sales/doc/${id}`;
  const ctx = await sales(back);
  const { error } = await ctx.supabase
    .from("sales_docs")
    .update({ tracking_stage: str(fd, "tracking_stage") })
    .eq("id", id)
    .eq("company_id", ctx.companyId);
  if (error) fail(back, cleanError(error.message));
  done(back, "Tracking stage updated and sent to connected systems");
}

export async function convertDoc(fd: FormData) {
  const id = str(fd, "id")!;
  const to = str(fd, "to") as DocType;
  const back = `/sales/doc/${id}`;
  const ctx = await sales(back);
  const { data, error } = await ctx.supabase.rpc("convert_sales_doc", { p_doc: id, p_to: to });
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/sales", "layout");
  done(`/sales/doc/${data as string}`, `${DOC_LABEL[to].one} created as a draft. Check it, then ${to === "order" ? "confirm" : "issue"} it.`);
}

export async function issueDoc(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/sales/doc/${id}`;
  const ctx = await sales(back);
  const { data, error } = await ctx.supabase.rpc("issue_sales_doc", { p_doc: id });
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/", "layout");
  done(back, `${(data as { number: string }).number} issued and posted to the ledger`);
}

export async function deleteDraft(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/sales/doc/${id}`;
  const ctx = await sales(back);
  const { data: doc } = await ctx.supabase.from("sales_docs").select("doc_type").eq("id", id).single();
  const { error, count } = await ctx.supabase.from("sales_docs").delete({ count: "exact" }).eq("id", id).eq("company_id", ctx.companyId);
  if (error) fail(back, cleanError(error.message));
  if (!count) fail(back, "Only drafts can be discarded");
  const slug = { quote: "quotes", order: "orders", invoice: "invoices", credit_note: "credit-notes" }[(doc?.doc_type as DocType) ?? "invoice"];
  done(`/sales/${slug}`, "Draft discarded");
}

export async function emailDoc(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/sales/doc/${id}`;
  const ctx = await sales(back);
  const to = str(fd, "to")?.trim();
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) fail(back, "Enter a valid email address");

  const { data } = await ctx.supabase.from("sales_docs").select("doc_type, number, share_token, total, currency, due_date").eq("id", id).eq("company_id", ctx.companyId).single();
  if (!data?.number) fail(back, "Send the document first so it has a number");
  const h = await headers();
  const origin = process.env.NEXT_PUBLIC_SITE_URL || h.get("origin") || `https://${h.get("x-forwarded-host") ?? h.get("host") ?? "app.kageflow.co.za"}`;
  const label = DOC_LABEL[data.doc_type as DocType].one;
  const mail = documentEmail({
    company: ctx.company.name, label, number: data.number, message: str(fd, "message"),
    link: `${origin.replace(/\/$/, "")}/d/${data.share_token}`,
    total: money(data.total, data.currency), due: data.doc_type === "invoice" && data.due_date ? date(data.due_date) : null,
    companyEmail: ctx.company.email, companyPhone: ctx.company.phone,
  });
  const sent = await deliverEmail({ to, ...mail, replyTo: ctx.company.email ?? ctx.user.email ?? null, fromName: ctx.company.name });
  if (!sent.ok) fail(back, `${sent.error}. Copy the share link and send it yourself for now.`);
  if (data.doc_type === "quote") {
    await ctx.supabase.from("sales_docs").update({ status: "sent" }).eq("id", id).eq("status", "draft");
  }
  done(back, `Emailed to ${to}`);
}

// ---------- payments ----------

async function payments(back: string) {
  const ctx = await getContext();
  if (!ctx.can("payments.write")) fail(back, "Only owners, admins and accountants can record payments");
  return ctx;
}

export async function recordPayment(fd: FormData) {
  const accountId = str(fd, "account_id");
  const back = `/sales/payments/new${accountId ? `?account=${accountId}` : ""}`;
  const ctx = await payments(back);
  if (!accountId) fail(back, "Pick the customer");
  const amount = num(fd, "amount");
  if (!amount || amount <= 0) fail(back, "Enter the amount received");
  const currency = str(fd, "currency") ?? ctx.company.base_currency;
  const fx = rateFor(currency, ctx.company.base_currency, num(fd, "fx_rate"));
  if (!fx) fail(back, `Enter the rate the bank used: how many ${ctx.company.base_currency} for 1 ${currency}`);
  const allocations: { invoice_id: string; amount: number }[] = [];
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("alloc_") && typeof v === "string" && v.trim()) {
      const a = Number(v.replace(/[\s,]/g, ""));
      if (!Number.isFinite(a) || a < 0) fail(back, "Allocation amounts must be positive numbers");
      if (a > 0) allocations.push({ invoice_id: k.slice(6), amount: a });
    }
  }
  if (allocations.reduce((s, a) => s + a.amount, 0) > amount + 0.001) fail(back, "You've allocated more than was received");
  const { data, error } = await ctx.supabase.rpc("record_customer_payment", {
    p_account: accountId,
    p_amount: amount,
    p_bank_account: str(fd, "bank_account_id"),
    p_currency: currency,
    p_fx_rate: fx,
    p_date: str(fd, "payment_date") ?? new Date().toISOString().slice(0, 10),
    p_method: (str(fd, "method") ?? "eft") as PaymentMethod,
    p_reference: str(fd, "reference"),
    p_order: str(fd, "order_id"),
    p_allocations: allocations,
  });
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/", "layout");
  done(`/sales/payments/${data as string}`, "Payment recorded and posted");
}

export async function allocate(fd: FormData) {
  const id = str(fd, "payment_id")!;
  const back = `/sales/payments/${id}`;
  const ctx = await payments(back);
  const invoice = str(fd, "invoice_id");
  const amount = num(fd, "amount");
  if (!invoice || !amount || amount <= 0) fail(back, "Pick an invoice and an amount");
  const { error } = await ctx.supabase.rpc("allocate_payment", { p_payment: id, p_invoice: invoice, p_amount: amount });
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/", "layout");
  done(back, "Payment applied");
}

export async function reversePayment(fd: FormData) {
  const id = str(fd, "payment_id")!;
  const back = `/sales/payments/${id}`;
  const ctx = await payments(back);
  const { error } = await ctx.supabase.rpc("reverse_customer_payment", { p_payment: id, p_reason: str(fd, "reason") });
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/", "layout");
  done(back, "Payment reversed");
}

// ---------- one-step save (and issue) from the document editor ----------

type EditorLineInput = { product_id?: string; unit_id?: string; description?: string; quantity?: string; unit_price?: string; tax_rate_id?: string; save_as_product?: boolean };

function skuFrom(name: string): string {
  const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "ITEM";
  return `${base}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export async function saveDocument(_prev: { error?: string } | null, fd: FormData): Promise<{ error?: string }> {
  const ctx = await getContext();
  if (!ctx.can("sales.write")) return { error: "Your role can view sales documents but not change them" };
  const id = str(fd, "id");
  const type = str(fd, "doc_type") as DocType;
  if (!DOC_TYPES.includes(type)) return { error: "Unknown document type" };
  if (!id && type === "credit_note") return { error: "Credit notes are created from an issued invoice" };
  const intent = str(fd, "intent") === "primary" ? "primary" : "draft";

  // lines first, so nothing is written if they're wrong
  let raw: EditorLineInput[] = [];
  try {
    raw = JSON.parse(str(fd, "lines") ?? "[]") as EditorLineInput[];
  } catch {
    return { error: "Couldn't read the lines. Reload the page and try again." };
  }
  const n = (v: string | undefined, d = 0) => {
    if (v === undefined || v === "") return d;
    const x = Number(String(v).replace(/[\s,]/g, ""));
    return Number.isFinite(x) ? x : NaN;
  };
  const lines = raw
    .filter((l) => (l.description ?? "").trim() || l.unit_id || l.product_id)
    .map((l) => ({
      product_id: l.product_id || null,
      unit_id: l.unit_id || null,
      description: (l.description ?? "").trim(),
      quantity: l.unit_id ? 1 : n(l.quantity, 1),
      unit_price: n(l.unit_price),
      tax_rate_id: l.tax_rate_id ?? "",
      save_as_product: !!l.save_as_product && !l.product_id && !l.unit_id,
    }));
  for (const [i, l] of lines.entries()) {
    if (!l.description) return { error: `Line ${i + 1} needs a description` };
    if (!l.tax_rate_id) return { error: `Line ${i + 1} needs a VAT rate` };
    if ([l.quantity, l.unit_price].some((x) => Number.isNaN(x) || x < 0)) return { error: `Line ${i + 1}: quantity and price must be positive numbers` };
    if (l.quantity === 0) return { error: `Line ${i + 1} needs a quantity` };
  }
  if (intent === "primary" && (type === "invoice" || type === "credit_note") && !lines.some((l) => l.quantity * l.unit_price > 0)) {
    return { error: "Add at least one line with a price before issuing" };
  }
  const units = lines.map((l) => l.unit_id).filter(Boolean);
  if (new Set(units).size !== units.length) return { error: "The same vehicle is on two lines" };

  const currency = str(fd, "currency") ?? ctx.company.base_currency;
  const fx = rateFor(currency, ctx.company.base_currency, num(fd, "fx_rate"));
  if (!fx) return { error: `Enter the exchange rate: how many ${ctx.company.base_currency} is 1 ${currency} (under Dates, currency and notes)` };

  // customer
  let accountId = str(fd, "account_id");
  if (str(fd, "new_customer") === "1") {
    const name = str(fd, "new_customer_name");
    if (!name) return { error: "Enter the new customer's name" };
    if (!ctx.can("crm.write")) return { error: "Your role can't add customers" };
    const { data: acct, error } = await ctx.supabase
      .from("crm_accounts")
      .insert({ company_id: ctx.companyId, name, kind: "customer", email: str(fd, "new_customer_email"), phone: str(fd, "new_customer_phone"), billing_address: str(fd, "new_customer_address"), owner_id: ctx.user.id })
      .select("id")
      .single();
    if (error) return { error: cleanError(error.message) };
    accountId = acct.id as string;
  }
  if (!accountId) return { error: "Choose the customer, or add a new one" };

  // free-text lines the user asked to keep as products
  for (const l of lines) {
    if (!l.save_as_product) continue;
    if (!ctx.can("inventory.write")) return { error: "Your role can't create products. Untick “Save as a product”." };
    const { data: prod, error } = await ctx.supabase
      .from("products")
      .insert({ company_id: ctx.companyId, sku: skuFrom(l.description), name: l.description.split("\n")[0]!.slice(0, 200), tracking: "none", sale_price: l.unit_price || null, currency, tax_rate_id: l.tax_rate_id })
      .select("id")
      .single();
    if (error) return { error: cleanError(error.message) };
    l.product_id = prod.id as string;
  }

  const header = {
    account_id: accountId,
    currency,
    fx_rate: fx,
    issue_date: str(fd, "issue_date") ?? new Date().toISOString().slice(0, 10),
    due_date: type === "invoice" ? str(fd, "due_date") : null,
    valid_until: type === "quote" ? str(fd, "valid_until") : null,
    reference: str(fd, "reference"),
    notes: str(fd, "notes"),
    terms: str(fd, "terms"),
    credit_reason: type === "credit_note" ? str(fd, "credit_reason") : null,
  };

  let docId = id;
  if (!docId) {
    const { data: created, error } = await ctx.supabase
      .from("sales_docs")
      .insert({ ...header, company_id: ctx.companyId, doc_type: type, deal_id: str(fd, "deal_id"), contact_id: str(fd, "contact_id") })
      .select("id")
      .single();
    if (error) return { error: cleanError(error.message) };
    docId = created.id as string;
  } else {
    const { error } = await ctx.supabase.from("sales_docs").update(header).eq("id", docId).eq("company_id", ctx.companyId).eq("status", "draft");
    if (error) return { error: cleanError(error.message) };
  }

  const back = `/sales/doc/${docId}`;
  const { error: clearError } = await ctx.supabase.from("sales_doc_lines").delete().eq("doc_id", docId).eq("company_id", ctx.companyId);
  if (clearError) fail(back, cleanError(clearError.message));
  if (lines.length) {
    const { error } = await ctx.supabase.from("sales_doc_lines").insert(
      lines.map((l, i) => ({
        company_id: ctx.companyId, doc_id: docId, line_no: i + 1, product_id: l.product_id, unit_id: l.unit_id,
        description: l.description, quantity: l.quantity, unit_price: l.unit_price, tax_rate_id: l.tax_rate_id,
      })),
    );
    if (error) fail(back, `Saved as a draft, but the lines need fixing: ${cleanError(error.message)}`);
  }

  revalidatePath("/sales", "layout");
  if (intent === "draft") done(back, "Draft saved");

  if (type === "invoice" || type === "credit_note") {
    const { data, error } = await ctx.supabase.rpc("issue_sales_doc", { p_doc: docId });
    if (error) fail(back, `Saved as a draft but not issued: ${cleanError(error.message)}`);
    revalidatePath("/", "layout");
    done(back, `${(data as { number: string }).number} issued and posted to the ledger`);
  }
  const { error } = await ctx.supabase.from("sales_docs").update({ status: type === "quote" ? "sent" : "open" }).eq("id", docId).eq("company_id", ctx.companyId);
  if (error) fail(back, `Saved as a draft: ${cleanError(error.message)}`);
  done(back, type === "quote" ? "Quote saved and marked as sent" : "Order confirmed. Its vehicles are now reserved.");
}
