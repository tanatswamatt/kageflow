import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { Field, Input, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requestReset, signIn, signUp } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; next?: string; error?: string; ok?: string }>;
}) {
  const params = await searchParams;
  const signup = params.mode === "signup";
  const forgot = params.mode === "forgot";

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1fr_minmax(420px,520px)]">
      <section className="relative hidden overflow-hidden bg-shadow-900 p-12 text-shadow-100 lg:flex lg:flex-col lg:justify-between">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/login-bg.jpg" alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full object-cover object-right" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-shadow-900/95 via-shadow-900/80 to-shadow-900/40" aria-hidden="true" />
        <div className="relative"><Logo inverted /></div>
        <div className="relative max-w-lg">
          <p className="text-[30px] font-semibold leading-snug text-white">
            Know what every car on your lot is really making you.
          </p>
          <p className="mt-4 text-[16px] leading-relaxed text-shadow-100">
            Kageflow runs your dealership, from the first WhatsApp enquiry to the signed deal, with stock, costs and VAT books all connected. Built for Southern African car dealers.
          </p>
        </div>
        <p className="relative text-[13px] text-shadow-300">A Pretan Technologies product</p>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          {forgot ? (
            <>
              <h1 className="text-[22px] font-semibold">Reset your password</h1>
              <p className="mt-1 mb-6 text-ink-soft">We&apos;ll email you a link to choose a new one.</p>
              <Notice params={params} />
              <form action={requestReset} className="flex flex-col gap-4">
                <Field label="Email">
                  <Input name="email" type="email" autoComplete="email" required />
                </Field>
                <SubmitButton pendingText="Sending…" className="mt-2 w-full">Send reset link</SubmitButton>
              </form>
              <p className="mt-6 text-center text-ink-soft">
                <Link className="font-medium text-shadow-700 hover:underline" href="/login">Back to sign in</Link>
              </p>
            </>
          ) : (
            <>
          <h1 className="text-[22px] font-semibold">{signup ? "Create your account" : "Sign in to Kageflow"}</h1>
          <p className="mt-1 mb-6 text-ink-soft">
            {signup ? "You'll set up your company next." : "Use the email you registered with."}
          </p>
          <Notice params={params} />
          <form action={signup ? signUp : signIn} className="flex flex-col gap-4">
            {params.next && <input type="hidden" name="next" value={params.next} />}
            {signup && (
              <Field label="Full name">
                <Input name="full_name" autoComplete="name" required />
              </Field>
            )}
            <Field label="Email">
              <Input name="email" type="email" autoComplete="email" required />
            </Field>
            <Field label="Password" hint={signup ? "At least 12 characters. A short sentence works well." : undefined}>
              <Input name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} required minLength={signup ? 12 : undefined} />
            </Field>
            {!signup && (
              <Link href="/login?mode=forgot" className="-mt-2 self-end text-[13px] font-medium text-shadow-700 hover:underline">
                Forgot password?
              </Link>
            )}
            <SubmitButton pendingText={signup ? "Creating account…" : "Signing in…"} className="mt-2 w-full">
              {signup ? "Create account" : "Sign in"}
            </SubmitButton>
          </form>
          <p className="mt-6 text-center text-ink-soft">
            {signup ? (
              <>Already have an account? <Link className="font-medium text-shadow-700 hover:underline" href="/login">Sign in</Link></>
            ) : (
              <>New to Kageflow? <Link className="font-medium text-shadow-700 hover:underline" href="/login?mode=signup">Create an account</Link></>
            )}
          </p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
