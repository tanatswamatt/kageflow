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
        <Logo inverted />
        <div className="max-w-md">
          <p className="text-[28px] font-semibold leading-snug text-white">
            From first enquiry to posted journal, in one system.
          </p>
          <p className="mt-4 text-shadow-300">
            Leads, deals, stock and the books for South African businesses. Every number traces back to the record behind it.
          </p>
        </div>
        <p className="text-[13px] text-shadow-300">A Pretan Technologies product</p>
        <svg className="pointer-events-none absolute -right-24 -bottom-24 opacity-[0.07]" width="520" height="520" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 18C4 9 10 4 20 4c0 10-5 16-14 16H4z" fill="#ffffff" />
        </svg>
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
            <Field label="Password" hint={signup ? "At least 8 characters" : undefined}>
              <Input name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} required minLength={signup ? 8 : undefined} />
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
