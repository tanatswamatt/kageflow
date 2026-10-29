"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { COMPANY_COOKIE } from "@/lib/context";
import { cleanError, fail, str } from "@/lib/forms";
import { notifyAdmin } from "@/lib/notify";

export async function createCompany(fd: FormData) {
  const name = str(fd, "name");
  if (!name || name.length < 2) fail("/onboarding", "Enter your company's trading name");

  const country = str(fd, "country");
  if (country !== "ZA" && country !== "ZW") fail("/onboarding", "Choose the country your dealership is registered in");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_company", {
    p_name: name,
    p_legal_name: str(fd, "legal_name"),
    p_registration_no: str(fd, "registration_no"),
    p_vat_no: str(fd, "vat_no"),
    p_country: country,
    p_base_currency: str(fd, "base_currency"),
  });
  if (error) fail("/onboarding", cleanError(error.message));

  const { data: auth } = await supabase.auth.getUser();
  await notifyAdmin(`New dealership on Kageflow: ${name}`, [
    `${name} just signed up to Kageflow.`,
    `Signed up by: ${(auth.user?.user_metadata?.full_name as string | undefined) ?? "unknown"} (${auth.user?.email ?? "no email"})`,
    `Country: ${country === "ZW" ? "Zimbabwe" : "South Africa"}, books in ${str(fd, "base_currency") ?? (country === "ZW" ? "USD" : "ZAR")}`,
    `VAT number: ${str(fd, "vat_no") ?? "not given"}`,
    "See all dealerships: https://app.kageflow.co.za/admin",
  ]);

  (await cookies()).set(COMPANY_COOKIE, data as string, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  redirect("/dashboard");
}
