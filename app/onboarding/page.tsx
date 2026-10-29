import type { Metadata } from "next";
import { Logo } from "@/components/logo";
import { Notice } from "@/components/ui";
import { CompanyForm } from "@/components/onboarding/company-form";
import { SubmitButton } from "@/components/submit-button";
import { getUser } from "@/lib/context";
import { label } from "@/lib/format";
import { acceptInviteById } from "../join/actions";
import { createCompany } from "./actions";

export const metadata: Metadata = { title: "Set up your company" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { supabase } = await getUser();
  const params = await searchParams;
  const { data: inviteData } = await supabase.rpc("my_invitations");
  const invites = (inviteData ?? []) as { id: string; company: string; role: string; inviter: string | null }[];
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg">
        <Logo />
        {invites.length > 0 && (
          <section className="mt-8">
            <h1 className="text-[22px] font-semibold">You&apos;ve been invited</h1>
            <p className="mt-1 mb-4 text-ink-soft">Join your dealership&apos;s team. Don&apos;t create a new company below if you work there.</p>
            <ul className="flex flex-col gap-3">
              {invites.map((i) => (
                <li key={i.id}>
                  <form action={acceptInviteById} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-panel)] border border-jade-700/30 bg-jade-50 p-4">
                    <input type="hidden" name="id" value={i.id} />
                    <div>
                      <div className="font-semibold">{i.company}</div>
                      <div className="text-[13px] text-ink-soft">As {label(i.role).toLowerCase()}{i.inviter ? `, invited by ${i.inviter}` : ""}</div>
                    </div>
                    <SubmitButton pendingText="Joining…">Join {i.company}</SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        )}
        <h1 className={`${invites.length ? "mt-10 text-[18px]" : "mt-8 text-[22px]"} font-semibold`}>{invites.length ? "Or set up a new company" : "Set up your company"}</h1>
        <p className="mt-1 mb-6 text-ink-soft">
          We&apos;ll set up a chart of accounts, VAT and a sales pipeline for your country. You can change the accounts and pipeline later.
        </p>
        <Notice params={params} />
        <CompanyForm action={createCompany} />
      </div>
    </main>
  );
}
