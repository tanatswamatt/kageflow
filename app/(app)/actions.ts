"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COMPANY_COOKIE, getContext } from "@/lib/context";
import { str } from "@/lib/forms";

export async function switchCompany(fd: FormData) {
  const id = str(fd, "company_id");
  const ctx = await getContext();
  if (id && ctx.companies.some((c) => c.id === id)) {
    (await cookies()).set(COMPANY_COOKIE, id, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  }
  redirect("/dashboard");
}
