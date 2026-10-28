"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fail, str } from "@/lib/forms";
import { safeNext } from "@/lib/safe-next";


export async function signIn(fd: FormData) {
  const email = str(fd, "email");
  const password = str(fd, "password");
  const next = safeNext(str(fd, "next"));
  if (!email || !password) fail("/login", "Enter your email and password");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const m = error.message.toLowerCase();
    fail("/login", m.includes("rate") || m.includes("too many") ? "Too many attempts. Wait a few minutes and try again" : m.includes("not confirmed") ? "Confirm your email first: check your inbox for the link" : "Email or password is incorrect");
  }
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
  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes("password")) fail("/login?mode=signup", "Choose a stronger password: at least 8 characters, not one that has appeared in a data breach");
    if (m.includes("rate") || m.includes("too many")) fail("/login?mode=signup", "Too many attempts. Wait a few minutes and try again");
    if (!m.includes("already")) fail("/login?mode=signup", "We couldn't create the account. Check the email address and try again");
    // an existing email gets the same answer as a new one, so accounts can't be discovered
  }
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
