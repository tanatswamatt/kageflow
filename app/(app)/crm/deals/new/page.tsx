import type { Metadata } from "next";
import { Field, Input, Notice, PageHeader, Panel, Select } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { OwnerSelect } from "@/components/crm/owner-select";
import { getContext } from "@/lib/context";
import { CURRENCIES } from "@/lib/types";
import { getMembers } from "@/lib/members";
import { personName } from "@/lib/format";
import type { Stage } from "@/lib/types";
import { createDeal } from "../../actions";

export const metadata: Metadata = { title: "New deal" };

type ContactOption = { id: string; first_name: string | null; last_name: string | null; account_id: string | null };

export default async function NewDealPage({ searchParams }: { searchParams: Promise<{ account?: string; error?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const [{ data: accounts }, { data: contacts }, { data: stages }, members] = await Promise.all([
    ctx.supabase.from("crm_accounts").select("id, name").eq("company_id", ctx.companyId).order("name").limit(1000),
    ctx.supabase.from("crm_contacts").select("id, first_name, last_name, account_id").eq("company_id", ctx.companyId).order("first_name").limit(1000),
    ctx.supabase.from("crm_pipeline_stages").select("*").eq("company_id", ctx.companyId).eq("is_won", false).eq("is_lost", false).order("position"),
    getMembers(),
  ]);
  const accountList = (accounts ?? []) as { id: string; name: string }[];
  const accountName = new Map(accountList.map((a) => [a.id, a.name]));
  const back = `/crm/deals/new${params.account ? `?account=${params.account}` : ""}`;

  return (
    <>
      <PageHeader title="New deal" back={{ href: "/crm/deals", label: "Deals" }} />
      <Notice params={params} />
      <Panel className="max-w-3xl">
        {accountList.length === 0 ? (
          <p className="text-ink-soft">Create an account first. Deals always belong to an account.</p>
        ) : (
          <form action={createDeal} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="back" value={back} />
            <Field label="Deal name" className="sm:col-span-2">
              <Input name="name" required placeholder="3 x Land Cruiser 79 for Nairobi" />
            </Field>
            <Field label="Account">
              <Select name="account_id" defaultValue={params.account ?? ""} required>
                <option value="" disabled>Choose an account</option>
                {accountList.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </Field>
            <Field label="Main contact">
              <Select name="contact_id" defaultValue="">
                <option value="">None</option>
                {((contacts ?? []) as ContactOption[]).map((c) => (
                  <option key={c.id} value={c.id}>
                    {personName(c)}{c.account_id ? ` (${accountName.get(c.account_id) ?? ""})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Stage">
              <Select name="stage_id" required>
                {((stages ?? []) as Stage[]).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Expected close"><Input name="expected_close" type="date" /></Field>
            <Field label="Value"><Input name="value" inputMode="decimal" placeholder="0.00" /></Field>
            <Field label="Currency">
              <Select name="currency" defaultValue={ctx.company.base_currency}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
            <OwnerSelect members={members} value={ctx.user.id} />
            <div className="sm:col-span-2"><SubmitButton>Create deal</SubmitButton></div>
          </form>
        )}
      </Panel>
    </>
  );
}
