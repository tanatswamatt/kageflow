"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { COMPANY_COOKIE } from "@/lib/context";
import { str } from "@/lib/forms";

const back = (token: string, key: "error" | "ok", msg: string) => redirect(`/join/${token}?${key}=${encodeURIComponent(msg)}`);
const clean = (m: string) => m.replace(/^.*?:\s*/, "").slice(0, 200);

async function joined(companyId: string) {
  (await cookies()).set(COMPANY_COOKIE, companyId, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  redirect("/dashboard");
}

/** Signed-in person accepts the invitation in the link */
export async function acceptInvite(fd: FormData) {
  const token = str(fd, "token") ?? "";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_invitation", { p_token: token });
  if (error) back(token, "error", clean(error.message));
  await joined(data as string);
}

/** Accepts an invitation listed on the setup screen */
export async function acceptInviteById(fd: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_invitation_by_id", { p_id: str(fd, "id")! });
  if (error) redirect(`/onboarding?error=${encodeURIComponent(clean(error.message))}`);
  await joined(data as string);
}

/** New person creates their account from the invitation, for the invited email only */
export async function signUpFromInvite(fd: FormData) {
  const token = str(fd, "token") ?? "";
  const fullName = str(fd, "full_name");
  const password = str(fd, "password") ?? "";
  if (!fullName) back(token, "error", "Enter your full name");
  if (password.length < 12) back(token, "error", "Use at least 12 characters for your password");
  const supabase = await createClient();
  const { data: preview } = await supabase.rpc("invitation_preview", { p_token: token });
  const inv = preview as { status: string; email: string } | null;
  if (!inv || inv.status !== "valid") back(token, "error", "This invitation is no longer valid. Ask for a new one");
  const origin = (await headers()).get("origin") ?? "https://app.kageflow.co.za";
  const { data, error } = await supabase.auth.signUp({
    email: inv!.email,
    password,
    options: { data: { full_name: fullName }, emailRedirectTo: `${origin}/auth/callback?next=/onboarding` },
  });
  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes("password")) back(token, "error", "Choose a stronger password: at least 12 characters, not one that has appeared in a data breach");
    if (m.includes("already")) back(token, "error", "You already have a Kageflow account. Sign in to accept the invitation");
    back(token, "error", "We couldn't create the account. Try again in a few minutes");
  }
  if (data.session) {
    const { data: companyId, error: ae } = await supabase.rpc("accept_invitation", { p_token: token });
    if (ae) back(token, "error", clean(ae.message));
    await joined(companyId as string);
  }
  back(token, "ok", `Almost there. We've sent a confirmation email to ${inv!.email}. Click the link in it and you'll be able to join.`);
}

export async function signOutToJoin(fd: FormData) {
  const token = str(fd, "token") ?? "";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(`/join/${token}`);
}
