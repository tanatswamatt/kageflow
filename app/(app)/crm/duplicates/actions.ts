"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { cleanError, done, fail, str } from "@/lib/forms";

export async function mergeCustomers(fd: FormData) {
  const back = "/crm/duplicates";
  const ctx = await getContext();
  if (!ctx.can("company.manage")) fail(back, "Only owners and admins can merge customers");
  const keep = str(fd, "keep");
  const ids = fd.getAll("ids").filter((v): v is string => typeof v === "string");
  if (!keep || !ids.includes(keep)) fail(back, "Choose which record to keep");
  let moved = 0;
  for (const drop of ids.filter((i) => i !== keep)) {
    const { data, error } = await ctx.supabase.rpc("merge_accounts", { p_keep: keep, p_drop: drop });
    if (error) fail(back, cleanError(error.message));
    moved += Number((data as { moved: number }).moved ?? 0);
  }
  revalidatePath("/crm/accounts");
  done(back, `Merged. ${moved} linked records now sit on one customer.`);
}
