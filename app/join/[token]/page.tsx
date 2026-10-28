import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { Field, Input, Notice, buttonClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { createClient } from "@/lib/supabase/server";
import { label } from "@/lib/format";
import { acceptInvite, signOutToJoin, signUpFromInvite } from "../actions";

export const metadata: Metadata = { title: "Join your team", robots: { index: false, follow: false } };

type Preview = { status: "valid" | "invalid" | "expired" | "accepted" | "revoked"; company?: string; email?: string; role?: string; inviter?: string; has_account?: boolean };

const DEAD: Record<string, string> = {
  invalid: "This invitation link isn't valid. Check you copied the whole link, or ask for a new invitation.",
  expired: "This invitation has expired. Ask the person who invited you to send it again.",
  accepted: "This invitation has already been used. Sign in to open Kageflow.",
  revoked: "This invitation was cancelled. Ask the person who invited you for a new one.",
};

export default async function JoinPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: previewData }, { data: auth }] = await Promise.all([supabase.rpc("invitation_preview", { p_token: token }), supabase.auth.getUser()]);
  const inv = (previewData ?? { status: "invalid" }) as Preview;
  const me = auth.user;
  const sameEmail = !!me && me.email?.toLowerCase() === inv.email;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper px-6 py-12">
      <div className="w-full max-w-md">
        <Logo />
        {inv.status !== "valid" ? (
          <>
            <h1 className="mt-8 text-[22px] font-semibold">Invitation not available</h1>
            <p className="mt-2 text-ink-soft">{DEAD[inv.status]}</p>
            <Link href="/login" className={`${buttonClass("secondary")} mt-6`}>Go to sign in</Link>
          </>
        ) : (
          <>
            <h1 className="mt-8 text-[22px] font-semibold">Join {inv.company}</h1>
            <p className="mt-1 mb-6 text-ink-soft">
              {inv.inviter ?? "Your team"} invited <strong className="font-medium text-ink">{inv.email}</strong> to join as {label(inv.role ?? "sales").toLowerCase()}.
            </p>
            <Notice params={sp} />

            {me && sameEmail && (
              <form action={acceptInvite} className="rounded-[var(--radius-panel)] border border-line bg-surface p-6">
                <input type="hidden" name="token" value={token} />
                <p className="mb-4 text-[14px] text-ink-soft">You&apos;re signed in as {me.email}.</p>
                <SubmitButton pendingText="Joining…" className="w-full">Join {inv.company}</SubmitButton>
              </form>
            )}

            {me && !sameEmail && (
              <form action={signOutToJoin} className="rounded-[var(--radius-panel)] border border-line bg-surface p-6">
                <input type="hidden" name="token" value={token} />
                <p className="mb-4 text-[14px]">You&apos;re signed in as <strong className="font-medium">{me.email}</strong>, but this invitation is for <strong className="font-medium">{inv.email}</strong>.</p>
                <SubmitButton tone="secondary" className="w-full">Sign out and continue as {inv.email}</SubmitButton>
              </form>
            )}

            {!me && inv.has_account && (
              <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-6">
                <p className="mb-4 text-[14px] text-ink-soft">{inv.email} already has a Kageflow account. Sign in with it to accept.</p>
                <Link href={`/login?next=${encodeURIComponent(`/join/${token}`)}`} className={`${buttonClass("primary")} w-full`}>Sign in to accept</Link>
              </div>
            )}

            {!me && !inv.has_account && !sp.ok && (
              <form action={signUpFromInvite} className="flex flex-col gap-4 rounded-[var(--radius-panel)] border border-line bg-surface p-6">
                <input type="hidden" name="token" value={token} />
                <Field label="Email"><Input value={inv.email} readOnly disabled /></Field>
                <Field label="Full name"><Input name="full_name" autoComplete="name" required /></Field>
                <Field label="Choose a password" hint="At least 12 characters. A short sentence works well.">
                  <Input name="password" type="password" autoComplete="new-password" required minLength={12} />
                </Field>
                <SubmitButton pendingText="Creating your account…">Create account and join</SubmitButton>
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
