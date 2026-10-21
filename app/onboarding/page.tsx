import type { Metadata } from "next";
import { Logo } from "@/components/logo";
import { Field, Input, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { getUser } from "@/lib/context";
import { createCompany } from "./actions";

export const metadata: Metadata = { title: "Set up your company" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await getUser();
  const params = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg">
        <Logo />
        <h1 className="mt-8 text-[22px] font-semibold">Set up your company</h1>
        <p className="mt-1 mb-6 text-ink-soft">
          We&apos;ll create a South African chart of accounts and a sales pipeline for you. You can change both later.
        </p>
        <Notice params={params} />
        <form action={createCompany} className="grid gap-4 rounded-[var(--radius-panel)] border border-line bg-surface p-6 sm:grid-cols-2">
          <Field label="Trading name" className="sm:col-span-2">
            <Input name="name" required minLength={2} placeholder="Mzansi Motors" />
          </Field>
          <Field label="Registered name" className="sm:col-span-2">
            <Input name="legal_name" placeholder="Mzansi Motors (Pty) Ltd" />
          </Field>
          <Field label="CIPC registration number">
            <Input name="registration_no" placeholder="2024/123456/07" />
          </Field>
          <Field label="VAT number" hint="Leave blank if not VAT registered">
            <Input name="vat_no" inputMode="numeric" />
          </Field>
          <div className="sm:col-span-2">
            <SubmitButton pendingText="Creating company…">Create company</SubmitButton>
          </div>
        </form>
      </div>
    </main>
  );
}
