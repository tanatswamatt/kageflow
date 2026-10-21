"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { cleanError, done, fail, str } from "@/lib/forms";

async function banker(back: string) {
  const ctx = await getContext();
  if (!ctx.can("banking.write")) fail(back, "Only owners, admins and accountants can reconcile the bank");
  return ctx;
}

export async function importStatement(fd: FormData) {
  const bank = str(fd, "bank_id")!;
  const back = `/banking/${bank}`;
  const ctx = await banker(back);
  let rows: unknown[] = [];
  try {
    rows = JSON.parse(str(fd, "rows") ?? "[]") as unknown[];
  } catch {
    fail(back, "Couldn't read the file. Try downloading it again as CSV.");
  }
  if (!rows.length) fail(back, "No transactions found in that file");
  const { data, error } = await ctx.supabase.rpc("import_bank_statement", { p_bank: bank, p_rows: rows });
  if (error) fail(back, cleanError(error.message));
  const r = data as { added: number; duplicates: number; unreadable: number };
  const { data: matched } = await ctx.supabase.rpc("auto_match_bank", { p_bank: bank });
  revalidatePath(back);
  done(back, `Imported ${r.added} transactions${r.duplicates ? `, skipped ${r.duplicates} already imported` : ""}. ${Number(matched ?? 0)} matched automatically.`);
}

export async function autoMatch(fd: FormData) {
  const bank = str(fd, "bank_id")!;
  const back = `/banking/${bank}`;
  const ctx = await banker(back);
  const { data, error } = await ctx.supabase.rpc("auto_match_bank", { p_bank: bank });
  if (error) fail(back, cleanError(error.message));
  done(back, `${Number(data ?? 0)} matched`);
}

export async function matchLine(fd: FormData) {
  const bank = str(fd, "bank_id")!;
  const back = `/banking/${bank}`;
  const ctx = await banker(back);
  const { error } = await ctx.supabase.rpc("match_bank_line", { p_line: str(fd, "line_id"), p_journal_line: str(fd, "journal_line_id") });
  if (error) fail(back, cleanError(error.message));
  done(back, "Matched");
}

export async function unmatchLine(fd: FormData) {
  const bank = str(fd, "bank_id")!;
  const back = `/banking/${bank}`;
  const ctx = await banker(back);
  const { error } = await ctx.supabase.rpc("unmatch_bank_line", { p_line: str(fd, "line_id") });
  if (error) fail(back, cleanError(error.message));
  done(back, "Unmatched");
}

export async function ignoreLine(fd: FormData) {
  const bank = str(fd, "bank_id")!;
  const back = `/banking/${bank}`;
  const ctx = await banker(back);
  const { error } = await ctx.supabase.rpc("ignore_bank_line", { p_line: str(fd, "line_id"), p_ignore: str(fd, "ignore") !== "false" });
  if (error) fail(back, cleanError(error.message));
  done(back, str(fd, "ignore") === "false" ? "Line restored" : "Line ignored");
}

export async function postLine(fd: FormData) {
  const bank = str(fd, "bank_id")!;
  const back = `/banking/${bank}`;
  const ctx = await banker(back);
  const account = str(fd, "account_id");
  if (!account) fail(back, "Choose the account to post it to");
  const { error } = await ctx.supabase.rpc("post_bank_line", { p_line: str(fd, "line_id"), p_account: account, p_tax_rate: str(fd, "tax_rate_id"), p_description: str(fd, "description") });
  if (error) fail(back, cleanError(error.message));
  done(back, "Posted and matched");
}
