import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { Field, Input, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { setNewPassword } from "@/app/login/actions";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; done?: string }> }) {
  const params = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8"><Logo /></div>
        <h1 className="text-[22px] font-semibold">Choose a new password</h1>
        <p className="mt-1 mb-6 text-ink-soft">You&apos;ll stay signed in on this device.</p>
        <Notice params={params} />
        {params.done ? (
          <Link href="/dashboard" className="font-medium text-shadow-700 hover:underline">Go to your dashboard</Link>
        ) : (
        <form action={setNewPassword} className="flex flex-col gap-4">
          <Field label="New password" hint="At least 8 characters">
            <Input name="password" type="password" autoComplete="new-password" required minLength={8} />
          </Field>
          <Field label="Repeat new password">
            <Input name="confirm" type="password" autoComplete="new-password" required minLength={8} />
          </Field>
          <SubmitButton pendingText="Saving…" className="mt-2 w-full">Save password</SubmitButton>
        </form>
        )}
      </div>
    </main>
  );
}
