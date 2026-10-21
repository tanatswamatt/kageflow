import type { Metadata } from "next";
import { Notice, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { AccountFields } from "@/components/crm/account-fields";
import { getContext } from "@/lib/context";
import { getMembers } from "@/lib/members";
import { createAccount } from "../../actions";

export const metadata: Metadata = { title: "New account" };

export default async function NewAccountPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const members = await getMembers();
  return (
    <>
      <PageHeader title="New account" back={{ href: "/crm/accounts", label: "Accounts" }} />
      <Notice params={params} />
      <Panel className="max-w-3xl">
        <form action={createAccount} className="flex flex-col gap-6">
          <AccountFields members={members} defaultOwner={ctx.user.id} />
          <div><SubmitButton>Create account</SubmitButton></div>
        </form>
      </Panel>
    </>
  );
}
