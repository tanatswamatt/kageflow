import type { Metadata } from "next";
import { Notice, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { LeadFields } from "@/components/crm/lead-fields";
import { getContext } from "@/lib/context";
import { getMembers } from "@/lib/members";
import { createLead } from "../../actions";

export const metadata: Metadata = { title: "New lead" };

export default async function NewLeadPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const members = await getMembers();
  return (
    <>
      <PageHeader title="New lead" back={{ href: "/crm/leads", label: "Leads" }} />
      <Notice params={params} />
      <Panel className="max-w-3xl">
        <form action={createLead} className="flex flex-col gap-6">
          <LeadFields members={members} defaultOwner={ctx.user.id} currency={ctx.company.base_currency} />
          <div><SubmitButton>Save lead</SubmitButton></div>
        </form>
      </Panel>
    </>
  );
}
