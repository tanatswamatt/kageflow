"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { cleanError, done, fail, str } from "@/lib/forms";

export async function fileVatReturn(fd: FormData) {
  const from = str(fd, "from")!, to = str(fd, "to")!;
  const back = `/reports/vat?from=${from}&to=${to}`;
  const ctx = await getContext();
  if (!ctx.can("ledger.write")) fail(back, "Only owners, admins and accountants can file VAT returns");
  const { error } = await ctx.supabase.rpc("file_vat_return", { p_company: ctx.companyId, p_from: from, p_to: to, p_reference: str(fd, "reference") });
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/reports/vat");
  done(back, "VAT return recorded. What you owe SARS now sits in VAT control; pay it from Bank or a journal.");
}

export async function undoVatReturn(fd: FormData) {
  const back = str(fd, "back") ?? "/reports/vat";
  const ctx = await getContext();
  if (!ctx.can("ledger.write")) fail(back, "Only owners, admins and accountants can change VAT returns");
  const { error } = await ctx.supabase.rpc("undo_vat_return", { p_id: str(fd, "id"), p_reason: str(fd, "reason") });
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/reports/vat");
  done(back, "VAT return undone");
}
