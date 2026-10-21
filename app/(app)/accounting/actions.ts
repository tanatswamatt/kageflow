"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { cleanError, done, fail, str } from "@/lib/forms";
import type { AccountType } from "@/lib/types";

async function ledger(back: string) {
  const ctx = await getContext();
  if (!ctx.can("ledger.write")) fail(back, "Only owners, admins and accountants can change the books");
  return ctx;
}

// ---------- chart of accounts ----------

export async function createLedgerAccount(fd: FormData) {
  const back = "/accounting/accounts";
  const ctx = await ledger(back);
  const row = {
    company_id: ctx.companyId,
    code: str(fd, "code"),
    name: str(fd, "name"),
    type: str(fd, "type") as AccountType | null,
    description: str(fd, "description"),
  };
  if (!row.code || !row.name || !row.type) fail(back, "Code, name and type are required");
  const { error } = await ctx.supabase.from("accounts").insert(row);
  if (error) fail(back, error.message.includes("duplicate") ? `Account code ${row.code} is already used` : cleanError(error.message));
  revalidatePath(back);
  done(back, `Account ${row.code} added`);
}

export async function updateLedgerAccount(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/accounting/accounts/${id}`;
  const ctx = await ledger(back);
  const name = str(fd, "name");
  if (!name) fail(back, "Name is required");
  const { error } = await ctx.supabase
    .from("accounts")
    .update({ name, description: str(fd, "description"), is_active: fd.get("is_active") === "on" })
    .eq("id", id)
    .eq("company_id", ctx.companyId);
  if (error) fail(back, cleanError(error.message));
  done(back, "Account saved");
}

// ---------- journals ----------

type LineInput = { account_id: string; description?: string; debit?: string | number; credit?: string | number };

function toCents(v: string | number | undefined): number {
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(String(v).replace(/[\s,]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

export async function saveJournal(fd: FormData) {
  const back = "/accounting/journals/new";
  const ctx = await ledger(back);
  const intent = str(fd, "intent");
  const description = str(fd, "description");
  const journalDate = str(fd, "journal_date");
  if (!description) fail(back, "Add a description");
  if (!journalDate) fail(back, "Pick a date");

  let raw: LineInput[];
  try {
    raw = JSON.parse(str(fd, "lines") ?? "[]") as LineInput[];
  } catch {
    raw = [];
  }
  const lines = raw
    .map((l) => ({ account_id: l.account_id, description: l.description?.trim() || null, debit: toCents(l.debit), credit: toCents(l.credit) }))
    .filter((l) => l.account_id && (l.debit || l.credit));
  if (lines.some((l) => Number.isNaN(l.debit) || Number.isNaN(l.credit) || l.debit < 0 || l.credit < 0)) fail(back, "Amounts must be positive numbers");
  if (lines.some((l) => l.debit && l.credit)) fail(back, "A line is either a debit or a credit, not both");
  if (lines.length < 2) fail(back, "A journal needs at least two lines with an account and an amount");

  const { data: journal, error } = await ctx.supabase
    .from("journals")
    .insert({ company_id: ctx.companyId, description, journal_date: journalDate, source_type: "manual" })
    .select("id")
    .single();
  if (error) fail(back, cleanError(error.message));

  const { error: lineError } = await ctx.supabase.from("journal_lines").insert(
    lines.map((l, i) => ({
      company_id: ctx.companyId,
      journal_id: journal.id,
      line_no: i + 1,
      account_id: l.account_id,
      description: l.description,
      debit: l.debit / 100,
      credit: l.credit / 100,
    })),
  );
  if (lineError) {
    await ctx.supabase.from("journals").delete().eq("id", journal.id);
    fail(back, cleanError(lineError.message));
  }

  const target = `/accounting/journals/${journal.id}`;
  if (intent === "post") {
    const { error: postError } = await ctx.supabase.rpc("post_journal", { p_journal: journal.id });
    if (postError) fail(target, `Saved as a draft but not posted: ${cleanError(postError.message)}`);
    revalidatePath("/accounting", "layout");
    done(target, "Journal posted");
  }
  revalidatePath("/accounting/journals");
  done(target, "Draft saved");
}

export async function postJournal(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/accounting/journals/${id}`;
  const ctx = await ledger(back);
  const { error } = await ctx.supabase.rpc("post_journal", { p_journal: id });
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/accounting", "layout");
  done(back, "Journal posted");
}

export async function reverseJournal(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/accounting/journals/${id}`;
  const ctx = await ledger(back);
  const { data, error } = await ctx.supabase.rpc("reverse_journal", {
    p_journal: id,
    p_date: str(fd, "reversal_date") ?? new Date().toISOString().slice(0, 10),
    p_reason: str(fd, "reason"),
  });
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/accounting", "layout");
  done(`/accounting/journals/${data as string}`, "Reversal posted");
}

export async function deleteJournal(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/accounting/journals/${id}`;
  const ctx = await ledger(back);
  const { error } = await ctx.supabase.from("journals").delete().eq("id", id).eq("company_id", ctx.companyId);
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/accounting/journals");
  done("/accounting/journals", "Draft deleted");
}

// ---------- periods ----------

export async function createPeriod(fd: FormData) {
  const back = "/accounting/periods";
  const ctx = await ledger(back);
  const row = { company_id: ctx.companyId, name: str(fd, "name"), start_date: str(fd, "start_date"), end_date: str(fd, "end_date") };
  if (!row.name || !row.start_date || !row.end_date) fail(back, "Name, start and end date are required");
  const { error } = await ctx.supabase.from("fiscal_periods").insert(row);
  if (error) fail(back, error.message.includes("no_overlap") ? "That period overlaps an existing one" : cleanError(error.message));
  done(back, `Period ${row.name} added`);
}

export async function setPeriodStatus(fd: FormData) {
  const id = str(fd, "id")!;
  const back = "/accounting/periods";
  const ctx = await ledger(back);
  const status = str(fd, "status");
  if (!status || !["open", "closed", "locked"].includes(status)) fail(back, "Unknown status");
  const { error } = await ctx.supabase.from("fiscal_periods").update({ status }).eq("id", id).eq("company_id", ctx.companyId);
  if (error) fail(back, cleanError(error.message));
  revalidatePath(back);
  redirect(back);
}

export async function deletePeriod(fd: FormData) {
  const id = str(fd, "id")!;
  const back = "/accounting/periods";
  const ctx = await ledger(back);
  const { error, count } = await ctx.supabase.from("fiscal_periods").delete({ count: "exact" }).eq("id", id).eq("company_id", ctx.companyId);
  if (error) fail(back, cleanError(error.message));
  if (!count) fail(back, "Only open periods can be deleted, by an owner or admin");
  done(back, "Period deleted");
}
