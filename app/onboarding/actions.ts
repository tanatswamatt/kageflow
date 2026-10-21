"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { COMPANY_COOKIE } from "@/lib/context";
import { cleanError, fail, str } from "@/lib/forms";

export async function createCompany(fd: FormData) {
  const name = str(fd, "name");
  if (!name || name.length < 2) fail("/onboarding", "Enter your company's trading name");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_company", {
    p_name: name,
    p_legal_name: str(fd, "legal_name"),
    p_registration_no: str(fd, "registration_no"),
    p_vat_no: str(fd, "vat_no"),
  });
  if (error) fail("/onboarding", cleanError(error.message));

  (await cookies()).set(COMPANY_COOKIE, data as string, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  redirect("/dashboard");
}
