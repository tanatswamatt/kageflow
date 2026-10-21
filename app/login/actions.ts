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
