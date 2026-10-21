import type { Metadata } from "next";
import { Notice, PageHeader, Panel } from "@/components/ui";
import { JournalForm } from "@/components/accounting/journal-form";
import { getContext } from "@/lib/context";
import { today } from "@/lib/format";
import { saveJournal } from "../../actions";

export const metadata: Metadata = { title: "New journal" };

export default async function NewJournalPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const { data } = await ctx.supabase.from("accounts").select("id, code, name").eq("company_id", ctx.companyId).eq("is_active", true).order("code");
  return (
    <>
      <PageHeader
        title="New journal"
        description="Manual journals are for adjustments and opening balances. Debits must equal credits before you can post."
        back={{ href: "/accounting/journals", label: "Journals" }}
      />
      <Notice params={params} />
      {!ctx.can("ledger.write") ? (
        <Panel><p className="text-ink-soft">Only owners, admins and accountants can write journals.</p></Panel>
      ) : (
        <Panel>
          <JournalForm accounts={(data ?? []) as { id: string; code: string; name: string }[]} today={today()} currency={ctx.company.base_currency} action={saveJournal} />
        </Panel>
      )}
    </>
  );
}
