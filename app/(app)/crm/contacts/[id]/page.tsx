import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Field, Input, Notice, PageHeader, Panel, Select } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ConsentFields } from "@/components/crm/consent-fields";
import { ActivityFeed } from "@/components/crm/activity-feed";
import { LogActivity } from "@/components/crm/log-activity";
import { getContext } from "@/lib/context";
import { memberNames } from "@/lib/members";
import { personName } from "@/lib/format";
import type { Activity, Contact } from "@/lib/types";
import { deleteContact, updateContact } from "../../actions";

export const metadata: Metadata = { title: "Contact" };

type Row = Contact & { crm_accounts: { id: string; name: string } | null };

export default async function ContactPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const notice = await searchParams;
  const ctx = await getContext();
  const { data } = await ctx.supabase.from("crm_contacts").select("*, crm_accounts(id, name)").eq("id", id).eq("company_id", ctx.companyId).maybeSingle();
  if (!data) notFound();
  const c = data as Row;

  const [{ data: accounts }, { data: acts }, names] = await Promise.all([
    ctx.supabase.from("crm_accounts").select("id, name").eq("company_id", ctx.companyId).order("name").limit(1000),
    ctx.supabase.from("crm_activities").select("*").eq("company_id", ctx.companyId).eq("contact_id", id).order("created_at", { ascending: false }),
    memberNames(),
  ]);
  const canWrite = ctx.can("crm.write");
  const back = `/crm/contacts/${id}`;

  return (
    <>
      <PageHeader
        title={personName(c)}
        description={c.crm_accounts ? <Link className="hover:underline" href={`/crm/accounts/${c.crm_accounts.id}`}>{[c.job_title, c.crm_accounts.name].filter(Boolean).join(" at ")}</Link> : c.job_title}
        back={{ href: "/crm/contacts", label: "Contacts" }}
      />
      <Notice params={notice} />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Panel title="Activity" flush className="min-w-0 self-start">
          {canWrite && <LogActivity refs={{ contact_id: c.id, account_id: c.account_id }} back={back} />}
          <ActivityFeed activities={(acts ?? []) as Activity[]} names={names} back={back} canWrite={canWrite} />
        </Panel>
        <div className="flex flex-col gap-6">
          <Panel title="Details">
            <form action={updateContact} className="grid gap-3">
              <input type="hidden" name="id" value={c.id} />
              <fieldset disabled={!canWrite} className="contents">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="First name"><Input name="first_name" defaultValue={c.first_name ?? ""} /></Field>
                  <Field label="Last name"><Input name="last_name" defaultValue={c.last_name ?? ""} /></Field>
                </div>
                <Field label="Account">
                  <Select name="account_id" defaultValue={c.account_id ?? ""}>
                    <option value="">None</option>
                    {((accounts ?? []) as { id: string; name: string }[]).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </Select>
                </Field>
                <Field label="Job title"><Input name="job_title" defaultValue={c.job_title ?? ""} /></Field>
                <Field label="Email"><Input name="email" type="email" defaultValue={c.email ?? ""} /></Field>
                <Field label="Phone"><Input name="phone" type="tel" defaultValue={c.phone ?? ""} /></Field>
                <Field label="WhatsApp"><Input name="whatsapp" type="tel" defaultValue={c.whatsapp ?? ""} /></Field>
                <ConsentFields basis={c.consent_basis} source={c.consent_source} law={ctx.rules.privacyLawShort} />
                {canWrite && <div><SubmitButton size="sm">Save changes</SubmitButton></div>}
              </fieldset>
            </form>
          </Panel>
          {ctx.can("crm.delete") && (
            <Panel title="Delete">
              <p className="mb-3 text-ink-soft">Use this for {ctx.rules.privacyLawShort === "POPIA" ? "POPIA" : "data protection"} deletion requests. The audit log keeps a record that it happened.</p>
              <form action={deleteContact}>
                <input type="hidden" name="id" value={c.id} />
                <SubmitButton tone="danger" size="sm" confirm="Delete this contact permanently?">Delete contact</SubmitButton>
              </form>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
