import "server-only";
import type { AppContext } from "./context";
import { cleanError, fail, str } from "./forms";

/**
 * The account a form chose: an existing one (account_id), or a new one typed in with AccountPicker.
 * A new one whose phone or email is already on file reuses that account instead of making a duplicate.
 */
export async function resolveAccount(ctx: AppContext, fd: FormData, back: string, kind: "customer" | "supplier" = "customer"): Promise<string | null> {
  if (str(fd, "new_account") !== "1") return str(fd, "account_id");
  const name = str(fd, "new_account_name");
  if (!name) fail(back, `Enter the new ${kind}'s name`);
  if (!ctx.can("crm.write") && !ctx.can("purchases.write")) fail(back, `Your role can't add ${kind}s`);
  const email = str(fd, "new_account_email")?.toLowerCase() ?? null;
  const phone = str(fd, "new_account_phone");

  if (email || phone) {
    const { data } = await ctx.supabase.rpc("match_accounts", { p_company: ctx.companyId, p_rows: [{ i: 0, name, email: email ?? "", phone: phone ?? "", vat_no: "" }] });
    const m = ((data ?? []) as { account_id: string; matched_on: string }[]).find((x) => !/name/i.test(x.matched_on));
    if (m) {
      // fill what the existing record is missing
      const { data: cur } = await ctx.supabase.from("crm_accounts").select("email, phone").eq("id", m.account_id).maybeSingle();
      const c = cur as { email: string | null; phone: string | null } | null;
      const patch: Record<string, string> = {};
      if (c && !c.email && email) patch.email = email;
      if (c && !c.phone && phone) patch.phone = phone;
      if (Object.keys(patch).length) await ctx.supabase.from("crm_accounts").update(patch).eq("id", m.account_id);
      return m.account_id;
    }
  }
  const { data, error } = await ctx.supabase.from("crm_accounts")
    .insert({ company_id: ctx.companyId, name, kind, email, phone, owner_id: ctx.user.id })
    .select("id").single();
  if (error) fail(back, cleanError(error.message));
  return (data as { id: string }).id;
}
