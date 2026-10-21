import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { can, type Permission } from "./permissions";
import type { Company, Role } from "./types";

export const COMPANY_COOKIE = "kf_company";

type MembershipRow = { company_id: string; role: Role; companies: Company | null };

export const getUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  return { supabase, user: data.user };
});

/** Active company for this request. Redirects to onboarding if the user has none. */
export const getContext = cache(async () => {
  const { supabase, user } = await getUser();
  const { data, error } = await supabase
    .from("company_members")
    .select("company_id, role, companies(id, name, legal_name, registration_no, vat_no, base_currency, country, address, phone, email, bank_details, invoice_footer, default_payment_days)")
    .eq("user_id", user.id)
    .order("created_at");
  if (error) throw new Error(error.message);

  const memberships = ((data ?? []) as unknown as MembershipRow[]).filter((m) => m.companies);
  if (memberships.length === 0) redirect("/onboarding");

  const wanted = (await cookies()).get(COMPANY_COOKIE)?.value;
  const active = memberships.find((m) => m.company_id === wanted) ?? memberships[0]!;

  return {
    supabase,
    user,
    companyId: active.company_id,
    company: active.companies as Company,
    role: active.role,
    companies: memberships.map((m) => ({ id: m.company_id, name: m.companies!.name, role: m.role })),
    can: (p: Permission) => can(active.role, p),
  };
});

export type AppContext = Awaited<ReturnType<typeof getContext>>;
