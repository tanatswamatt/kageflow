import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";

const TYPES: EmailOtpType[] = ["signup", "email", "recovery", "invite", "magiclink", "email_change"];

/**
 * Links in Kageflow's emails land here: /auth/confirm?token_hash=...&type=signup&next=/onboarding
 * Unlike the code exchange in /auth/callback, this works when the email is opened on a different
 * phone or computer from the one the person signed up on.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const fallback = type === "recovery" ? "/reset-password" : "/onboarding";
  const next = safeNext(searchParams.get("next"), fallback);

  if (tokenHash && type && TYPES.includes(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  const msg = type === "recovery"
    ? "That reset link has expired or was already used. Request a new one."
    : "That link has expired or was already used. If you already confirmed your email, just sign in.";
  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(msg)}`);
}
