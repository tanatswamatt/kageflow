"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fail, str } from "@/lib/forms";

function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

export async function signIn(fd: FormData) {
  const email = str(fd, "email");
  const password = str(fd, "password");
  const next = safeNext(str(fd, "next"));
  if (!email || !password) fail("/login", "Enter your email and password");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) fail("/login", error.message === "Invalid login credentials" ? "Email or password is incorrect" : error.message);
  redirect(next);
}

export async function signUp(fd: FormData) {
  const fullName = str(fd, "full_name");
  const email = str(fd, "email");
  const password = str(fd, "password");
  if (!fullName || !email || !password) fail("/login?mode=signup", "Fill in your name, email and password");
  if (password.length < 8) fail("/login?mode=signup", "Use at least 8 characters for your password");

  const origin = (await headers()).get("origin") ?? "http://localhost:3000";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName }, emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) fail("/login?mode=signup", error.message);
  if (data.session) redirect("/onboarding");
  redirect(`/login?ok=${encodeURIComponent("Check your inbox to confirm your email, then sign in")}`);
}

export async function requestReset(fd: FormData) {
  const email = str(fd, "email");
  if (!email) fail("/login?mode=forgot", "Enter your email");
  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=/reset-password` });
  if (error && !error.message.toLowerCase().includes("rate")) fail("/login?mode=forgot", error.message);
  if (error) fail("/login?mode=forgot", "Too many emails sent. Wait a few minutes and try again");
  // Same message whether or not the email exists, so accounts can't be discovered
  redirect(`/login?ok=${encodeURIComponent("If that email has an account, a reset link is on its way. Check spam too.")}`);
}

export async function setNewPassword(fd: FormData) {
  const password = str(fd, "password");
  const confirm = str(fd, "confirm");
  if (!password || password.length < 8) fail("/reset-password", "Use at least 8 characters");
  if (password !== confirm) fail("/reset-password", "The two passwords don't match");
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) fail("/reset-password", error.message);
  redirect(`/reset-password?done=1&ok=${encodeURIComponent("Password changed. You are signed in.")}`);
}
