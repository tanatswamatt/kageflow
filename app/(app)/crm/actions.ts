"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { bool, cleanError, done, fail, num, str } from "@/lib/forms";
import type { AccountKind, ActivityType, ConsentBasis, LeadSource, LeadStatus } from "@/lib/types";

async function crm(back: string) {
  const ctx = await getContext();
  if (!ctx.can("crm.write")) fail(back, "Your role can view the CRM but not change it");
  return ctx;
}

/** POPIA basis. consent_at is stamped when the record is created; edits keep the original time. */
function consentFields(fd: FormData, stamp = true) {
  const basis = (str(fd, "consent_basis") ?? "not_recorded") as ConsentBasis;
  return {
    consent_basis: basis,
    consent_source: str(fd, "consent_source"),
    ...(stamp ? { consent_at: basis === "not_recorded" ? null : new Date().toISOString() } : {}),
  };
}

// ---------- leads ----------

export async function createLead(fd: FormData) {
  const back = "/crm/leads/new";
  const ctx = await crm(back);
  const row = {
    company_id: ctx.companyId,
    first_name: str(fd, "first_name"),
    last_name: str(fd, "last_name"),
    company_name: str(fd, "company_name"),
    email: str(fd, "email"),
    phone: str(fd, "phone"),
    source: (str(fd, "source") ?? "manual") as LeadSource,
    source_detail: str(fd, "source_detail"),
    interest: str(fd, "interest"),
    estimated_value: num(fd, "estimated_value"),
    currency: str(fd, "currency") ?? ctx.company.base_currency,
    owner_id: str(fd, "owner_id") ?? ctx.user.id,
    notes: str(fd, "notes"),
    ...consentFields(fd),
  };
  if (!row.first_name && !row.last_name && !row.company_name) fail(back, "Give the lead a name or a company");
  if (!row.email && !row.phone) fail(back, "Add an email or phone number so someone can follow up");

  const { data, error } = await ctx.supabase.from("crm_leads").insert(row).select("id").single();
  if (error) fail(back, cleanError(error.message));
  redirect(`/crm/leads/${data.id}`);
}

export async function updateLead(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/crm/leads/${id}`;
  const ctx = await crm(back);
  const status = str(fd, "status") as LeadStatus | null;
  if (status === "converted") fail(back, "Use Convert to turn a lead into an account and deal");
  const patch = {
    first_name: str(fd, "first_name"),
    last_name: str(fd, "last_name"),
    company_name: str(fd, "company_name"),
    email: str(fd, "email"),
    phone: str(fd, "phone"),
    source: (str(fd, "source") ?? "manual") as LeadSource,
    source_detail: str(fd, "source_detail"),
    interest: str(fd, "interest"),
    estimated_value: num(fd, "estimated_value"),
    owner_id: str(fd, "owner_id"),
    notes: str(fd, "notes"),
    ...(status ? { status } : {}),
    disqualified_reason: status === "disqualified" ? str(fd, "disqualified_reason") : null,
    ...consentFields(fd, false),
  };
  if (status === "disqualified" && !patch.disqualified_reason) fail(back, "Say why the lead is disqualified");
  const { error } = await ctx.supabase.from("crm_leads").update(patch).eq("id", id).eq("company_id", ctx.companyId);
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/crm/leads");
  done(back, "Lead saved");
}

export async function convertLead(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/crm/leads/${id}`;
  const ctx = await crm(back);
  const { data, error } = await ctx.supabase.rpc("convert_lead", {
    p_lead: id,
    p_existing_account: str(fd, "account_id"),
    p_create_deal: bool(fd, "create_deal"),
    p_deal_name: str(fd, "deal_name"),
    p_deal_value: num(fd, "deal_value"),
  });
  if (error) fail(back, cleanError(error.message));
  const result = data as { account_id: string; deal_id: string | null };
  revalidatePath("/crm", "layout");
  redirect(result.deal_id ? `/crm/deals/${result.deal_id}` : `/crm/accounts/${result.account_id}`);
}

export async function deleteLead(fd: FormData) {
  const id = str(fd, "id")!;
  const ctx = await getContext();
  if (!ctx.can("crm.delete")) fail(`/crm/leads/${id}`, "Only owners and admins can delete leads");
  const { error } = await ctx.supabase.from("crm_leads").delete().eq("id", id).eq("company_id", ctx.companyId);
  if (error) fail(`/crm/leads/${id}`, cleanError(error.message));
  done("/crm/leads", "Lead deleted");
}

// ---------- accounts ----------

function accountFields(fd: FormData) {
  return {
    name: str(fd, "name"),
    kind: (str(fd, "kind") ?? "prospect") as AccountKind,
    industry: str(fd, "industry"),
    country: str(fd, "country")?.toUpperCase().slice(0, 2) ?? null,
    city: str(fd, "city"),
    website: str(fd, "website"),
    email: str(fd, "email"),
    phone: str(fd, "phone"),
    vat_no: str(fd, "vat_no"),
    owner_id: str(fd, "owner_id"),
    notes: str(fd, "notes"),
    billing_address: str(fd, "billing_address"),
    payment_days: (() => {
      const d = num(fd, "payment_days");
      return d === null ? null : Math.min(365, Math.max(0, Math.round(d)));
    })(),
  };
}

export async function createAccount(fd: FormData) {
  const back = "/crm/accounts/new";
  const ctx = await crm(back);
  const fields = accountFields(fd);
  if (!fields.name) fail(back, "Account name is required");
  const { data, error } = await ctx.supabase
    .from("crm_accounts")
    .insert({ ...fields, owner_id: fields.owner_id ?? ctx.user.id, company_id: ctx.companyId })
    .select("id")
    .single();
  if (error) fail(back, cleanError(error.message));
  redirect(`/crm/accounts/${data.id}`);
}

export async function updateAccount(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/crm/accounts/${id}`;
  const ctx = await crm(back);
  const fields = accountFields(fd);
  if (!fields.name) fail(back, "Account name is required");
  const { error } = await ctx.supabase.from("crm_accounts").update(fields).eq("id", id).eq("company_id", ctx.companyId);
  if (error) fail(back, cleanError(error.message));
  done(back, "Account saved");
}

export async function deleteAccount(fd: FormData) {
  const id = str(fd, "id")!;
  const ctx = await getContext();
  if (!ctx.can("crm.delete")) fail(`/crm/accounts/${id}`, "Only owners and admins can delete accounts");
  const { error } = await ctx.supabase.from("crm_accounts").delete().eq("id", id).eq("company_id", ctx.companyId);
  if (error) fail(`/crm/accounts/${id}`, cleanError(error.message));
  done("/crm/accounts", "Account deleted with its deals");
}

// ---------- contacts ----------

function contactFields(fd: FormData) {
  return {
    account_id: str(fd, "account_id"),
    first_name: str(fd, "first_name"),
    last_name: str(fd, "last_name"),
    email: str(fd, "email"),
    phone: str(fd, "phone"),
    whatsapp: str(fd, "whatsapp"),
    job_title: str(fd, "job_title"),
    ...consentFields(fd),
  };
}

export async function createContact(fd: FormData) {
  const back = str(fd, "back") ?? "/crm/contacts";
  const ctx = await crm(back);
  const fields = contactFields(fd);
  if (!fields.first_name && !fields.last_name) fail(back, "Give the contact a name");
  const { error } = await ctx.supabase
    .from("crm_contacts")
    .insert({ ...fields, owner_id: ctx.user.id, company_id: ctx.companyId });
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/crm/contacts");
  done(back, "Contact added");
}

export async function updateContact(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/crm/contacts/${id}`;
  const ctx = await crm(back);
  const fields = { ...contactFields(fd), ...consentFields(fd, false) };
  delete (fields as { consent_at?: unknown }).consent_at;
  if (!fields.first_name && !fields.last_name) fail(back, "Give the contact a name");
  const { error } = await ctx.supabase.from("crm_contacts").update(fields).eq("id", id).eq("company_id", ctx.companyId);
  if (error) fail(back, cleanError(error.message));
  done(back, "Contact saved");
}

export async function deleteContact(fd: FormData) {
  const id = str(fd, "id")!;
  const ctx = await getContext();
  if (!ctx.can("crm.delete")) fail(`/crm/contacts/${id}`, "Only owners and admins can delete contacts");
  const { error } = await ctx.supabase.from("crm_contacts").delete().eq("id", id).eq("company_id", ctx.companyId);
  if (error) fail(`/crm/contacts/${id}`, cleanError(error.message));
  done("/crm/contacts", "Contact deleted");
}

// ---------- deals ----------

export async function createDeal(fd: FormData) {
  const back = str(fd, "back") ?? "/crm/deals/new";
  const ctx = await crm(back);
  const row = {
    company_id: ctx.companyId,
    name: str(fd, "name"),
    account_id: str(fd, "account_id"),
    contact_id: str(fd, "contact_id"),
    stage_id: str(fd, "stage_id"),
    value: num(fd, "value") ?? 0,
    currency: str(fd, "currency") ?? ctx.company.base_currency,
    expected_close: str(fd, "expected_close"),
    owner_id: str(fd, "owner_id") ?? ctx.user.id,
  };
  if (!row.name) fail(back, "Deal name is required");
  if (!row.account_id) fail(back, "Pick the account this deal is with");
  if (!row.stage_id) fail(back, "Pick a stage");
  const { data, error } = await ctx.supabase.from("crm_deals").insert(row).select("id").single();
  if (error) fail(back, cleanError(error.message));
  redirect(`/crm/deals/${data.id}`);
}

export async function updateDeal(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/crm/deals/${id}`;
  const ctx = await crm(back);
  const patch = {
    name: str(fd, "name"),
    contact_id: str(fd, "contact_id"),
    value: num(fd, "value") ?? 0,
    currency: str(fd, "currency") ?? ctx.company.base_currency,
    expected_close: str(fd, "expected_close"),
    owner_id: str(fd, "owner_id"),
  };
  if (!patch.name) fail(back, "Deal name is required");
  const { error } = await ctx.supabase.from("crm_deals").update(patch).eq("id", id).eq("company_id", ctx.companyId);
  if (error) fail(back, cleanError(error.message));
  done(back, "Deal saved");
}

export async function moveDeal(fd: FormData) {
  const id = str(fd, "id")!;
  const back = str(fd, "back") ?? `/crm/deals/${id}`;
  const ctx = await crm(back);
  const stageId = str(fd, "stage_id");
  if (!stageId) fail(back, "Pick a stage");
  const { data: stage } = await ctx.supabase
    .from("crm_pipeline_stages")
    .select("is_lost")
    .eq("id", stageId)
    .eq("company_id", ctx.companyId)
    .single();
  const lostReason = str(fd, "lost_reason");
  if (stage?.is_lost && !lostReason) fail(back, "Say why the deal was lost before moving it to a lost stage");
  const { error } = await ctx.supabase
    .from("crm_deals")
    .update({ stage_id: stageId, lost_reason: stage?.is_lost ? lostReason : null })
    .eq("id", id)
    .eq("company_id", ctx.companyId);
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/crm/deals");
  redirect(back);
}

export async function deleteDeal(fd: FormData) {
  const id = str(fd, "id")!;
  const ctx = await getContext();
  if (!ctx.can("crm.delete")) fail(`/crm/deals/${id}`, "Only owners and admins can delete deals");
  const { error } = await ctx.supabase.from("crm_deals").delete().eq("id", id).eq("company_id", ctx.companyId);
  if (error) fail(`/crm/deals/${id}`, cleanError(error.message));
  done("/crm/deals", "Deal deleted");
}

// ---------- activities ----------

export async function logActivity(fd: FormData) {
  const back = str(fd, "back") ?? "/crm/activities";
  const ctx = await crm(back);
  const type = (str(fd, "type") ?? "note") as ActivityType;
  if (type === "system") fail(back, "Pick an activity type");
  const due = str(fd, "due_at");
  const row = {
    company_id: ctx.companyId,
    type,
    subject: str(fd, "subject"),
    body: str(fd, "body"),
    due_at: due ? new Date(due).toISOString() : null,
    completed_at: type === "task" && due ? null : new Date().toISOString(),
    account_id: str(fd, "account_id"),
    contact_id: str(fd, "contact_id"),
    lead_id: str(fd, "lead_id"),
    deal_id: str(fd, "deal_id"),
    owner_id: str(fd, "owner_id") ?? ctx.user.id,
  };
  if (!row.subject) fail(back, "Add a short subject");
  const { error } = await ctx.supabase.from("crm_activities").insert(row);
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/crm/activities");
  redirect(back);
}

export async function completeActivity(fd: FormData) {
  const id = str(fd, "id")!;
  const back = str(fd, "back") ?? "/crm/activities";
  const ctx = await crm(back);
  const reopen = bool(fd, "reopen");
  const { error } = await ctx.supabase
    .from("crm_activities")
    .update({ completed_at: reopen ? null : new Date().toISOString() })
    .eq("id", id)
    .eq("company_id", ctx.companyId);
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/crm/activities");
  redirect(back);
}

export async function deleteActivity(fd: FormData) {
  const id = str(fd, "id")!;
  const back = str(fd, "back") ?? "/crm/activities";
  const ctx = await getContext();
  const { error, count } = await ctx.supabase
    .from("crm_activities")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("company_id", ctx.companyId);
  if (error) fail(back, cleanError(error.message));
  if (!count) fail(back, "You can only delete activities you logged");
  redirect(back);
}
